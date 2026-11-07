import { ROOM_CAPACITY, getFocusSeat } from "../src/layout.ts";
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

export type Peer = {
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

// Node 로컬 방과 Cloudflare 공개 방이 같은 상태 전이·좌석 계약을 쓴다.
export class RoomEngine {
  readonly peers = new Map<string, Peer>();
  constructor(
    private now: () => number = Date.now,
    private moveMinMs = 65,
  ) {}
  join(id: string) {
    if (this.peers.size >= ROOM_CAPACITY) return null;
    const peer: Peer = {
      id,
      actor: createActor(),
      session: null,
      lastMove: 0,
      alive: true,
    };
    this.peers.set(id, peer);
    return peer;
  }
  welcome(peer: Peer) {
    return {
      type: "welcome",
      id: peer.id,
      actor: peer.actor,
      session: peer.session,
      serverNow: this.now(),
    };
  }
  receive(peer: Peer, raw: string) {
    const message = JSON.parse(raw);
    if (!message || typeof message !== "object") return;
    if (COMMANDS.includes(message.type)) {
      if (!validRequestId(message.requestId)) return;
      const outcome = this.run(peer, message.type, message);
      return {
        type: "command-result",
        command: message.type,
        requestId: message.requestId,
        ...outcome,
        ...(outcome.ok && { actor: peer.actor, session: peer.session }),
        serverNow: this.now(),
      };
    }
    if (message.type === "move") {
      const at = Date.now();
      if (at - peer.lastMove < this.moveMinMs) return;
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
  }
  private holder = (seatId: number, except?: Peer) =>
    [...this.peers.values()].find(
      (p) => p !== except && p.session?.seatId === seatId,
    );
  private elapsed = (session: FocusSession, at: number) =>
    session.elapsedMs +
    (session.status === "focusing" && session.startedAt !== null
      ? Math.max(0, at - session.startedAt)
      : 0);
  private seatedActor = (peer: Peer, seatId: number): Actor => {
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
  private standUp = (peer: Peer): Actor => {
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
  private run(peer: Peer, type: Command, message: any): Outcome {
    const at = this.now();
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
        if (this.holder(seat.id, peer))
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
        peer.actor = this.seatedActor(peer, seat.id);
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
          elapsedMs: this.elapsed(session, at),
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
        if (this.holder(session.seatId, peer))
          return { ok: false, reason: "이미 다른 주민이 앉은 의자예요." };
        peer.session = { ...session, status: "focusing", startedAt: at };
        peer.actor = this.seatedActor(peer, session.seatId);
        return { ok: true };
      }
      case "finish-focus": {
        if (!session) return { ok: false, reason: "진행 중인 집중이 없어요." };
        const result: FocusResult = {
          subject: session.subject,
          elapsedMs: this.elapsed(session, at),
          finishedAt: at,
        };
        peer.actor = this.standUp(peer);
        peer.session = null;
        return { ok: true, result };
      }
      case "cancel-focus": {
        if (session) peer.actor = this.standUp(peer);
        peer.session = null;
        return { ok: true };
      }
    }
  }
  snapshot() {
    const list = [...this.peers.values()];
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
    return {
      type: "snapshot",
      residents: list.map((p) => ({ ...p.actor, id: p.id })),
      reservations,
    };
  }
}
