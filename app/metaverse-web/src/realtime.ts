import { useEffect, useMemo, useSyncExternalStore } from "react";
import { CAPACITY, ROOM_CAPACITY, getFocusSeat } from "./layout";
import type {
  FocusResult,
  FocusSession,
  IslandId,
  SeatReservation,
} from "./focus-session";
import type { Simulation } from "./simulation";
import {
  isIsland,
  normalizeSubject,
  sanitizeActor,
  SUBJECT_MAX,
  validActor,
  validName,
  type Actor,
  type Resident,
} from "./world";

export type RoomStatus = "connecting" | "online" | "offline";
export type RoomState = {
  status: RoomStatus;
  /** 나를 뺀 두 섬의 주민. 장면·UI가 island로 나눠 그린다. */
  residents: Resident[];
  /** 집중·휴식 중인 좌석 예약. 내 예약은 내 세션으로 덧씌운다. */
  reservations: SeatReservation[];
  /** 서버가 확정한 내 집중. startedAt은 이 기기의 시계로 옮긴 값이다. */
  session: FocusSession | null;
  pendingSeatId: number | null;
  busy: boolean;
  seatError: string | null;
};
export type RoomCommands = {
  claimSeat(seatId: number, subject?: string): Promise<boolean>;
  travel(island: IslandId): Promise<boolean>;
  pauseFocus(): Promise<boolean>;
  resumeFocus(): Promise<boolean>;
  finishFocus(): Promise<FocusResult | null>;
  leaveSeat(): void;
};
export type RoomApi = RoomState & RoomCommands;
export type RoomClientOptions = {
  url?: string | (() => string);
  createSocket?: (url: string) => WebSocket;
  now?: () => number;
  timeoutMs?: number;
  retryMs?: number;
  moveIntervalMs?: number;
};
type Command =
  | "claim-seat"
  | "travel"
  | "pause-focus"
  | "resume-focus"
  | "finish-focus"
  | "cancel-focus";
type Ack = {
  actor: Actor;
  session: FocusSession | null;
  result: FocusResult | null;
};
type Pending = {
  requestId: string;
  command: Command;
  seatId?: number;
  island?: IslandId;
  timer: ReturnType<typeof setTimeout>;
  resolve: (ack: Ack | null) => void;
};
const OPEN = 1;
const MESSAGES = {
  offline: "연결된 뒤 다시 시도해 주세요.",
  busy: "앞선 요청을 기다려 주세요.",
  timeout: "응답이 늦어 연결을 다시 시작해요.",
  invalid: "응답을 확인하지 못해 연결을 다시 시작해요.",
  sendFailed: "요청을 보내지 못했어요.",
  lostFocus:
    "연결이 끊어져 집중을 멈추고 자리를 비웠어요. 우리 섬에서 다시 시작해요.",
  lostIsland: "연결이 끊어져 우리 섬으로 돌아왔어요.",
} as const;
const defaultUrl = () =>
  import.meta.env?.VITE_ROOM_URL ||
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/island-room`;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const validSeatId = (value: unknown): value is number =>
  Number.isInteger(value) && getFocusSeat(value as number) !== undefined;
const validSubject = (value: unknown): value is string =>
  typeof value === "string" && value.length <= SUBJECT_MAX;

// 서버 응답과 연결 상태를 묶는 로컬 방 클라이언트. React 없이 검사할 수 있다.
export class RoomClient implements RoomCommands {
  private state: RoomState = {
    status: "connecting",
    residents: [],
    reservations: [],
    session: null,
    pendingSeatId: null,
    busy: false,
    seatError: null,
  };
  private listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private id = "";
  private offset = 0;
  private others: SeatReservation[] = [];
  private pending: Pending | null = null;
  private sequence = 0;
  private running = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private lastSent = "";
  private lastPing = 0;
  private moves: ReturnType<typeof setInterval> | undefined;
  private readonly now: () => number;
  constructor(
    private readonly sim: Simulation,
    private readonly options: RoomClientOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getState = () => this.state;
  start() {
    if (this.running) return;
    this.running = true;
    this.connect();
  }
  stop() {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this.retry);
    const socket = this.socket;
    this.detach();
    socket?.close();
    this.clearRoom();
    this.update({ status: "offline", residents: [] });
  }
  claimSeat = async (seatId: number, subject = ""): Promise<boolean> => {
    const session = this.state.session;
    const text = normalizeSubject(subject);
    if (!validSeatId(seatId))
      return this.reject("올바른 의자를 선택해 주세요.");
    if (this.sim.actor.island !== "focus")
      return this.reject("낚시섬에서 의자를 고를 수 있어요.");
    if (session?.status === "paused")
      return this.reject("휴식 중에는 집중을 이어가기만 할 수 있어요.");
    if (!session && text === null)
      return this.reject("할 일은 40자까지 적을 수 있어요.");
    return !!(await this.request(
      "claim-seat",
      { seatId, subject: text ?? "" },
      { seatId },
    ));
  };
  travel = async (island: IslandId): Promise<boolean> => {
    if (!isIsland(island)) return this.reject("갈 수 없는 섬이에요.");
    if (this.state.session)
      return this.reject("집중을 마친 뒤 섬을 옮길 수 있어요.");
    return !!(await this.request("travel", { island }, { island }));
  };
  pauseFocus = async (): Promise<boolean> => {
    if (this.state.session?.status !== "focusing")
      return this.reject("집중 중일 때만 쉴 수 있어요.");
    return !!(await this.request("pause-focus"));
  };
  resumeFocus = async (): Promise<boolean> => {
    if (this.state.session?.status !== "paused")
      return this.reject("쉬는 중일 때만 이어갈 수 있어요.");
    return !!(await this.request("resume-focus"));
  };
  finishFocus = async (): Promise<FocusResult | null> => {
    if (!this.state.session) {
      this.reject("진행 중인 집중이 없어요.");
      return null;
    }
    return (await this.request("finish-focus"))?.result ?? null;
  };
  /**
   * 비상 취소. 기다리던 명령을 실패로 끝내고 내 세션·예약을 바로 지운 뒤 서버 예약도
   * 해제한다. 취소 전에 보낸 명령의 늦은 응답은 requestId가 달라 다시 반영되지 않는다.
   */
  leaveSeat = () => {
    this.settle(null);
    this.sim.leaveSeat();
    this.setSession(null);
    const socket = this.socket;
    if (socket && this.id && socket.readyState === OPEN) {
      const requestId = this.nextId();
      this.pending = {
        requestId,
        command: "cancel-focus",
        timer: this.watchdog(requestId, socket),
        resolve: () => {},
      };
      this.send(socket, { type: "cancel-focus", requestId });
    }
    this.update({
      busy: this.pending !== null,
      pendingSeatId: null,
      seatError: null,
    });
  };
  private reject(error: string) {
    this.update({ seatError: error });
    return false;
  }
  private nextId() {
    return `${++this.sequence}`;
  }
  private watchdog(requestId: string, socket: WebSocket) {
    // 응답을 잃으면 연결을 끊는다. 서버는 닫힌 연결의 좌석·휴식 예약을 해제한다.
    return setTimeout(() => {
      if (this.pending?.requestId !== requestId) return;
      this.settle(null, MESSAGES.timeout);
      socket.close();
    }, this.options.timeoutMs ?? 5000);
  }
  private send(socket: WebSocket, payload: unknown) {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      this.settle(null, MESSAGES.sendFailed);
      socket.close();
    }
  }
  private request(
    command: Command,
    payload: Record<string, unknown> = {},
    expect: { seatId?: number; island?: IslandId } = {},
  ): Promise<Ack | null> {
    const socket = this.socket;
    if (!socket || !this.id || socket.readyState !== OPEN) {
      this.reject(MESSAGES.offline);
      return Promise.resolve(null);
    }
    if (this.pending) {
      this.reject(MESSAGES.busy);
      return Promise.resolve(null);
    }
    const requestId = this.nextId();
    return new Promise((resolve) => {
      this.pending = {
        requestId,
        command,
        ...expect,
        timer: this.watchdog(requestId, socket),
        resolve,
      };
      this.update({
        busy: true,
        pendingSeatId: command === "claim-seat" ? expect.seatId! : null,
        seatError: null,
      });
      this.send(socket, { type: command, requestId, ...payload });
    });
  }
  private settle(ack: Ack | null, error: string | null = null) {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    this.update({ busy: false, pendingSeatId: null, seatError: error });
    pending.resolve(ack);
  }
  private setSession(session: FocusSession | null) {
    this.update({ session, reservations: this.compose(session) });
  }
  private compose(session: FocusSession | null): SeatReservation[] {
    const mine: SeatReservation[] = session
      ? [
          {
            seatId: session.seatId,
            residentId: this.id,
            name: this.sim.actor.name,
            status: session.status,
          },
        ]
      : [];
    return [
      ...this.others.filter((r) => r.seatId !== session?.seatId),
      ...mine,
    ].sort((a, b) => a.seatId - b.seatId);
  }
  private update(patch: Partial<RoomState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
  private detach() {
    clearInterval(this.moves);
    const socket = this.socket;
    this.socket = null;
    this.id = "";
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
    }
  }
  private connect() {
    if (!this.running) return;
    this.update({ status: "connecting" });
    const url =
      typeof this.options.url === "function"
        ? this.options.url()
        : (this.options.url ?? defaultUrl());
    let socket: WebSocket;
    try {
      socket = this.options.createSocket
        ? this.options.createSocket(url)
        : new WebSocket(url);
    } catch {
      this.closed();
      return;
    }
    this.socket = socket;
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      try {
        this.receive(socket, JSON.parse(String(event.data)));
      } catch {
        /* 유효하지 않은 응답은 적용하지 않는다. */
      }
    };
    socket.onclose = () => {
      if (this.socket === socket) this.closed();
    };
    socket.onerror = () => socket.close();
  }
  /** 기다리던 명령·내 세션·예약을 지우고, 섬 밖에 있었다면 일반 섬으로 돌린다. */
  private clearRoom() {
    const hadSession = this.state.session !== null;
    const away =
      this.sim.actor.island !== "home" || this.sim.actor.action === "focus";
    this.settle(null, MESSAGES.offline);
    this.others = [];
    this.setSession(null);
    if (hadSession || away) this.sim.resetToHome();
    return { hadSession, away };
  }
  private closed() {
    this.detach();
    // 서버는 닫힌 연결의 예약을 지운다. 내 화면도 이전 좌석·섬을 남기지 않는다.
    const { hadSession, away } = this.clearRoom();
    this.update({
      status: "offline",
      residents: [],
      seatError: hadSession
        ? MESSAGES.lostFocus
        : away
          ? MESSAGES.lostIsland
          : this.state.seatError,
    });
    if (this.running)
      this.retry = setTimeout(
        () => this.connect(),
        this.options.retryMs ?? 3000,
      );
  }
  private receive(socket: WebSocket, message: any) {
    if (!message || typeof message !== "object") return;
    if (message.type === "welcome") {
      if (
        typeof message.id !== "string" ||
        !message.id ||
        message.id.length > 64
      )
        return;
      this.id = message.id;
      this.offset = finite(message.serverNow)
        ? this.now() - message.serverNow
        : 0;
      this.settle(null);
      this.others = [];
      // 새 연결은 늘 일반 섬 시작점에서 세션 없이 시작한다.
      this.sim.resetToHome();
      this.setSession(null);
      this.update({ status: "online", residents: [] });
      clearInterval(this.moves);
      this.lastSent = "";
      this.lastPing = 0;
      this.moves = setInterval(() => {
        if (this.socket !== socket || socket.readyState !== OPEN) return;
        try {
          const payload = JSON.stringify({
            type: "move",
            actor: sanitizeActor(this.sim.actor),
          });
          if (payload !== this.lastSent) {
            socket.send(payload);
            this.lastSent = payload;
          }
          if (this.now() - this.lastPing >= 30000) {
            socket.send('{"type":"ping"}');
            this.lastPing = this.now();
          }
        } catch {
          /* 다음 간격에 다시 보낸다. */
        }
      }, this.options.moveIntervalMs ?? 100);
      return;
    }
    if (!this.id) return;
    if (message.type === "command-result") this.acknowledge(socket, message);
    else if (message.type === "snapshot") this.snapshot(message);
  }
  private acknowledge(socket: WebSocket, message: any) {
    const pending = this.pending;
    // 취소했거나 이미 끝난 명령의 늦은 응답은 버린다.
    if (
      !pending ||
      message.requestId !== pending.requestId ||
      message.command !== pending.command
    )
      return;
    if (message.ok !== true) {
      this.settle(
        null,
        typeof message.reason === "string" && message.reason.length <= 120
          ? message.reason
          : "요청을 처리하지 못했어요.",
      );
      return;
    }
    const offset = finite(message.serverNow)
      ? this.now() - message.serverNow
      : this.offset;
    const session = this.parseSession(message.session, offset);
    const result =
      pending.command === "finish-focus"
        ? this.parseResult(message.result, offset)
        : null;
    const actor = message.actor;
    if (
      session === undefined ||
      result === undefined ||
      !validActor(actor) ||
      !this.consistent(pending, actor, session, result)
    ) {
      this.settle(null, MESSAGES.invalid);
      socket.close();
      return;
    }
    // 취소 응답은 섬이 어긋났을 때만 위치를 맞춘다. 같은 섬에서는 내 자유 이동이 우선이다.
    if (
      pending.command !== "cancel-focus" ||
      this.sim.actor.island !== actor.island ||
      this.sim.actor.action === "focus"
    )
      this.sim.applyAuthoritativeActor(actor);
    this.offset = offset;
    this.setSession(session);
    this.settle({ actor, session, result });
  }
  private consistent(
    pending: Pending,
    actor: Actor,
    session: FocusSession | null,
    result: FocusResult | null,
  ) {
    switch (pending.command) {
      case "claim-seat":
        return (
          session?.status === "focusing" &&
          session.seatId === pending.seatId &&
          actor.action === "focus" &&
          actor.seatId === pending.seatId
        );
      case "travel":
        return (
          !session &&
          actor.island === pending.island &&
          actor.action !== "focus"
        );
      case "pause-focus":
        return (
          session?.status === "paused" &&
          actor.island === "home" &&
          actor.action === "sit"
        );
      case "resume-focus":
        return (
          session?.status === "focusing" &&
          actor.action === "focus" &&
          actor.seatId === session.seatId
        );
      case "finish-focus":
        return !session && !!result && actor.action !== "focus";
      case "cancel-focus":
        return !session && actor.action !== "focus";
    }
  }
  /** undefined = 잘못된 값. 서버 시각은 이 기기 시각으로 옮긴다. */
  private parseSession(
    value: any,
    offset: number,
  ): FocusSession | null | undefined {
    if (value === null) return null;
    if (!value || typeof value !== "object") return undefined;
    const { seatId, subject, status, elapsedMs, startedAt } = value;
    if (
      !validSeatId(seatId) ||
      !validSubject(subject) ||
      !finite(elapsedMs) ||
      elapsedMs < 0 ||
      !(
        (status === "focusing" && finite(startedAt)) ||
        (status === "paused" && startedAt === null)
      )
    )
      return undefined;
    return {
      seatId,
      subject,
      status,
      elapsedMs,
      startedAt: status === "focusing" ? startedAt + offset : null,
    };
  }
  private parseResult(value: any, offset: number): FocusResult | undefined {
    if (
      !value ||
      !validSubject(value.subject) ||
      !finite(value.elapsedMs) ||
      value.elapsedMs < 0 ||
      !finite(value.finishedAt)
    )
      return undefined;
    return {
      subject: value.subject,
      elapsedMs: value.elapsedMs,
      finishedAt: value.finishedAt + offset,
    };
  }
  private snapshot(message: any) {
    if (!Array.isArray(message.residents)) return;
    const seen = new Set<string>([this.id]);
    const residents: Resident[] = [];
    for (const p of message.residents) {
      if (residents.length >= ROOM_CAPACITY - 1) break;
      const id = p?.id;
      if (typeof id !== "string" || seen.has(id) || !validActor(p)) continue;
      seen.add(id);
      residents.push({ ...sanitizeActor(p), id });
    }
    const seats = new Set<number>();
    const others: SeatReservation[] = [];
    for (const r of Array.isArray(message.reservations)
      ? message.reservations
      : []) {
      if (others.length >= CAPACITY) break;
      if (
        !r ||
        !validSeatId(r.seatId) ||
        seats.has(r.seatId) ||
        typeof r.residentId !== "string" ||
        r.residentId === this.id ||
        !validName(r.name) ||
        (r.status !== "focusing" && r.status !== "paused")
      )
        continue;
      seats.add(r.seatId);
      others.push({
        seatId: r.seatId,
        residentId: r.residentId,
        name: r.name.trim(),
        status: r.status,
      });
    }
    this.others = others;
    this.update({ residents, reservations: this.compose(this.state.session) });
  }
}

export function useRoom(sim: Simulation, options?: RoomClientOptions): RoomApi {
  // options는 첫 렌더 값만 쓴다.
  const client = useMemo(() => new RoomClient(sim, options), [sim]);
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  const state = useSyncExternalStore(
    client.subscribe,
    client.getState,
    client.getState,
  );
  return useMemo(
    () => ({
      ...state,
      claimSeat: client.claimSeat,
      travel: client.travel,
      pauseFocus: client.pauseFocus,
      resumeFocus: client.resumeFocus,
      finishFocus: client.finishFocus,
      leaveSeat: client.leaveSeat,
    }),
    [state, client],
  );
}
