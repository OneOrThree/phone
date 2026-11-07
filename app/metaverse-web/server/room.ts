import { ROOM_CAPACITY, getFocusSeat } from "../src/layout.ts";
import { randomUUID } from "node:crypto";
import type { HttpServer } from "vite";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type {
  FocusResult,
  FocusSession,
  SeatReservation,
} from "../src/focus-session.ts";
import {
  arrivalActor,
  createActor,
  isIsland,
  normalizeSubject,
  restSpot,
  sanitizeActor,
  seatExit,
  validActor,
  validColor,
  validName,
  type Actor,
} from "../src/world.ts";

// 로컬 검토용 방. 운영 인증·데이터·재화·집중 API와 연결하지 않는다.
// 섬 이동·좌석·집중 시간은 아래 명령으로만 바뀌고, move는 같은 섬의 자유 이동과 겉모습만 바꾼다.
type Peer = {
  id: string;
  actor: Actor;
  session: FocusSession | null;
  lastMove: number;
  alive: boolean;
};
type Command =
  | "claim-seat"
  | "travel"
  | "pause-focus"
  | "resume-focus"
  | "finish-focus"
  | "cancel-focus";
const COMMANDS: readonly Command[] = [
  "claim-seat",
  "travel",
  "pause-focus",
  "resume-focus",
  "finish-focus",
  "cancel-focus",
];
type Outcome =
  { ok: true; result?: FocusResult } | { ok: false; reason: string };
export type RoomOptions = {
  /** 집중 시간 기준 시계. 검사에서 주입한다. */
  now?: () => number;
  heartbeatMs?: number;
  snapshotMs?: number;
  /** 같은 연결의 move 최소 간격(ms). */
  moveMinMs?: number;
};
const validRequestId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64;

export function attachRoom(server: HttpServer, options: RoomOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  const peers = new Map<WebSocket, Peer>();
  let upgrading = 0;
  const holder = (seatId: number, except?: Peer) =>
    [...peers.values()].find(
      (p) => p !== except && p.session?.seatId === seatId,
    );
  const elapsed = (session: FocusSession, at: number) =>
    session.elapsedMs +
    (session.status === "focusing" && session.startedAt !== null
      ? Math.max(0, at - session.startedAt)
      : 0);
  const seatedActor = (peer: Peer, seatId: number): Actor => {
    const seat = getFocusSeat(seatId)!;
    return {
      island: "focus",
      x: seat.x,
      z: seat.z,
      yaw: seat.yaw,
      action: "focus",
      seatId,
      name: peer.actor.name,
      color: peer.actor.color,
    };
  };
  // 집중을 끝내거나 취소할 때 서는 곳. 의자에 있었다면 의자 옆, 휴식 중이었다면 일반 섬 제자리.
  const standUp = (peer: Peer): Actor => {
    const { name, color } = peer.actor;
    if (peer.actor.action === "focus" && peer.actor.seatId !== undefined) {
      const exit = seatExit(peer.actor.seatId);
      return {
        ...exit,
        island: "focus",
        yaw: peer.actor.yaw,
        action: "idle",
        name,
        color,
      };
    }
    return { ...sanitizeActor(peer.actor), action: "idle" };
  };
  function run(peer: Peer, type: Command, message: any): Outcome {
    const at = now();
    const session = peer.session;
    switch (type) {
      case "claim-seat": {
        const seat = Number.isInteger(message.seatId)
          ? getFocusSeat(message.seatId)
          : undefined;
        if (!seat) return { ok: false, reason: "올바른 의자를 선택해 주세요." };
        if (peer.actor.island !== "focus")
          return { ok: false, reason: "낚시섬에서 의자를 고를 수 있어요." };
        if (session?.status === "paused")
          return {
            ok: false,
            reason: "휴식 중에는 집중을 이어가기만 할 수 있어요.",
          };
        const subject = normalizeSubject(message.subject);
        if (!session && subject === null)
          return { ok: false, reason: "할 일은 40자까지 적을 수 있어요." };
        if (holder(seat.id, peer))
          return { ok: false, reason: "이미 다른 주민이 앉은 의자예요." };
        // 자리를 바꿔도 주제·누적 시간·현재 구간 시작 시각은 그대로 이어 간다.
        peer.session = session
          ? { ...session, seatId: seat.id }
          : {
              seatId: seat.id,
              subject: subject!,
              status: "focusing",
              elapsedMs: 0,
              startedAt: at,
            };
        peer.actor = seatedActor(peer, seat.id);
        return { ok: true };
      }
      case "travel": {
        if (!isIsland(message.island))
          return { ok: false, reason: "갈 수 없는 섬이에요." };
        if (session)
          return { ok: false, reason: "집중을 마친 뒤 섬을 옮길 수 있어요." };
        peer.actor = arrivalActor(message.island, peer.actor);
        return { ok: true };
      }
      case "pause-focus": {
        if (session?.status !== "focusing")
          return { ok: false, reason: "집중 중일 때만 쉴 수 있어요." };
        peer.session = {
          ...session,
          status: "paused",
          elapsedMs: elapsed(session, at),
          startedAt: null,
        };
        const spot = restSpot(session.seatId);
        peer.actor = {
          ...spot,
          island: "home",
          action: "sit",
          name: peer.actor.name,
          color: peer.actor.color,
        };
        return { ok: true };
      }
      case "resume-focus": {
        if (session?.status !== "paused")
          return { ok: false, reason: "쉬는 중일 때만 이어갈 수 있어요." };
        // 예약은 휴식 중에도 내 것이라 다른 주민이 앉을 수 없다. 남은 경우만 방어한다.
        if (holder(session.seatId, peer))
          return { ok: false, reason: "이미 다른 주민이 앉은 의자예요." };
        peer.session = { ...session, status: "focusing", startedAt: at };
        peer.actor = seatedActor(peer, session.seatId);
        return { ok: true };
      }
      case "finish-focus": {
        if (!session) return { ok: false, reason: "진행 중인 집중이 없어요." };
        const result: FocusResult = {
          subject: session.subject,
          elapsedMs: elapsed(session, at),
          finishedAt: at,
        };
        peer.actor = standUp(peer);
        peer.session = null;
        return { ok: true, result };
      }
      case "cancel-focus": {
        if (session) peer.actor = standUp(peer);
        peer.session = null;
        return { ok: true };
      }
    }
  }
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.split("?")[0] !== "/island-room") return;
    const origin = req.headers.origin;
    try {
      if (
        !origin ||
        new URL(origin).host !== req.headers.host ||
        peers.size + upgrading >= ROOM_CAPACITY
      ) {
        socket.destroy();
        return;
      }
    } catch {
      socket.destroy();
      return;
    }
    // 동시에 들어온 업그레이드도 정원 60을 넘지 않게 핸드셰이크 중인 연결을 센다.
    upgrading++;
    let counted = true;
    const release = () => {
      if (counted) upgrading--;
      counted = false;
    };
    socket.once("close", release);
    wss.handleUpgrade(req, socket, head, (ws) => {
      release();
      wss.emit("connection", ws);
    });
  });
  const remove = (ws: WebSocket) => {
    peers.delete(ws);
  };
  wss.on("connection", (ws: WebSocket) => {
    const peer: Peer = {
      id: randomUUID(),
      actor: createActor(),
      session: null,
      lastMove: -Infinity,
      alive: true,
    };
    peers.set(ws, peer);
    const reply = (payload: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    };
    reply({
      type: "welcome",
      id: peer.id,
      actor: peer.actor,
      session: null,
      serverNow: now(),
    });
    ws.on("pong", () => {
      peer.alive = true;
    });
    ws.on("message", (raw, isBinary) => {
      try {
        if (isBinary || !peers.has(ws)) return;
        const message = JSON.parse(raw.toString());
        if (!message || typeof message !== "object") return;
        if (COMMANDS.includes(message.type)) {
          if (!validRequestId(message.requestId)) return;
          const outcome = run(peer, message.type, message);
          reply({
            type: "command-result",
            command: message.type,
            requestId: message.requestId,
            ...outcome,
            ...(outcome.ok && { actor: peer.actor, session: peer.session }),
            serverNow: now(),
          });
        } else if (message.type === "move") {
          const at = performance.now();
          if (at - peer.lastMove < (options.moveMinMs ?? 65)) return;
          peer.lastMove = at;
          const next = message.actor;
          if (!next || typeof next !== "object") return;
          // 이름·털색은 어느 상태에서도 바꿀 수 있다. 서버 상태는 덮어쓰지 않는다.
          if (validName(next.name) && validColor(next.color)) {
            peer.actor = {
              ...peer.actor,
              name: next.name.trim(),
              color: next.color,
            };
          }
          // 위치·행동은 같은 섬의 자유 이동만 받는다. 집중 의자·휴식 예약 상태는 명령으로만 바뀐다.
          if (
            peer.actor.action !== "focus" &&
            next.island === peer.actor.island &&
            next.action !== "focus" &&
            next.seatId === undefined &&
            validActor({
              ...next,
              name: peer.actor.name,
              color: peer.actor.color,
            })
          ) {
            peer.actor = sanitizeActor({
              ...next,
              name: peer.actor.name,
              color: peer.actor.color,
            });
          }
        }
      } catch {
        /* 잘못된 메시지는 상태를 바꾸지 않는다. */
      }
    });
    ws.on("close", () => remove(ws));
    ws.on("error", () => {
      remove(ws);
      ws.terminate();
    });
  });
  const snapshot = () => {
    const list = [...peers.values()];
    const reservations: SeatReservation[] = list.flatMap((p) =>
      p.session
        ? [
            {
              seatId: p.session.seatId,
              residentId: p.id,
              name: p.actor.name,
              status: p.session.status,
            },
          ]
        : [],
    );
    return JSON.stringify({
      type: "snapshot",
      residents: list.map((p) => ({ ...p.actor, id: p.id })),
      reservations,
    });
  };
  const snapshots = setInterval(() => {
    if (!peers.size) return;
    const payload = snapshot();
    for (const ws of peers.keys())
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536)
        ws.send(payload);
  }, options.snapshotMs ?? 100);
  // pong이 없으면 연결을 끊고 같은 자리에서 좌석·휴식 예약도 해제한다.
  const heartbeat = setInterval(() => {
    for (const [ws, peer] of peers) {
      if (!peer.alive) {
        remove(ws);
        ws.terminate();
        continue;
      }
      peer.alive = false;
      try {
        ws.ping();
      } catch {
        remove(ws);
        ws.terminate();
      }
    }
  }, options.heartbeatMs ?? 10000);
  const close = () => {
    clearInterval(snapshots);
    clearInterval(heartbeat);
    for (const ws of peers.keys()) ws.terminate();
    peers.clear();
    wss.close();
  };
  server.once("close", close);
  return close;
}
