import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket as NodeWebSocket } from "ws";
import { RoomClient, type RoomState } from "../src/realtime";
import { Simulation } from "../src/simulation";
import { focusElapsedMs } from "../src/focus-session";
import { ROOM_CAPACITY, getFocusSeat } from "../src/layout";
import {
  SPAWN,
  arrivalActor,
  createActor,
  restSpot,
  seatExit,
  type Actor,
} from "../src/world";
import { startRoom, reservation } from "./room-harness";

const seated = (seatId: number, base: Pick<Actor, "name" | "color">): Actor => {
  const seat = getFocusSeat(seatId)!;
  return {
    island: "focus",
    x: seat.x,
    z: seat.z,
    yaw: seat.yaw,
    action: "focus",
    seatId,
    name: base.name,
    color: base.color,
  };
};
function until(
  client: RoomClient,
  predicate: (s: RoomState) => boolean,
  ms = 3000,
) {
  if (predicate(client.getState())) return Promise.resolve(client.getState());
  return new Promise<RoomState>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error("방 상태 대기 시간 초과"));
    }, ms);
    const off = client.subscribe(() => {
      if (!predicate(client.getState())) return;
      clearTimeout(timer);
      off();
      resolve(client.getState());
    });
  });
}

test("실제 로컬 방: 여행·착석·휴식·이어가기·종료가 서버 응답으로 내 고양이와 세션을 맞춘다", async () => {
  let clock = 1_000_000;
  const room = await startRoom({ now: () => clock });
  const sim = new Simulation();
  sim.actor.name = "웹 고양이";
  sim.actor.color = "gray";
  const client = new RoomClient(sim, {
    url: `ws://${room.host}/island-room`,
    createSocket: (url) =>
      new NodeWebSocket(url, {
        origin: `http://${room.host}`,
      }) as unknown as WebSocket,
    moveIntervalMs: 20,
  });
  try {
    client.start();
    await until(client, (s) => s.status === "online");
    const observer = await room.connect(),
      homebody = await room.connect();
    await observer.command("travel", { island: "focus" });
    assert.equal(
      await client.claimSeat(0),
      false,
      "일반 섬에서는 의자를 고를 수 없다",
    );
    assert.match(client.getState().seatError!, /낚시섬/);
    sim.keys.add("w");
    sim.path = [{ x: 3, z: 3 }];
    assert.equal(await client.travel("focus"), true);
    assert.deepEqual(
      sim.actor,
      arrivalActor("focus", { name: "웹 고양이", color: "gray" }),
    );
    assert.equal(sim.keys.size, 0, "여행하면 입력을 초기화한다");
    assert.equal(sim.path.length, 0);
    assert.equal(await client.claimSeat(1, "x".repeat(41)), false);
    // 응답 전 두 번째 명령은 busy로 막는다.
    const claim = client.claimSeat(2, "  코딩  ");
    assert.equal(client.getState().busy, true);
    assert.equal(client.getState().pendingSeatId, 2);
    assert.equal(await client.travel("home"), false);
    assert.match(client.getState().seatError!, /앞선 요청/);
    assert.equal(await claim, true);
    let state = client.getState();
    assert.equal(state.busy, false);
    assert.equal(state.pendingSeatId, null);
    assert.deepEqual(
      { ...state.session, startedAt: null },
      {
        seatId: 2,
        subject: "코딩",
        status: "focusing",
        elapsedMs: 0,
        startedAt: null,
      },
    );
    assert.ok(
      Math.abs(state.session!.startedAt! - Date.now()) < 1000,
      "기기 시각으로 옮긴다",
    );
    assert.deepEqual(sim.actor, seated(2, sim.actor));
    assert.deepEqual(
      state.reservations.map((r) => [r.seatId, r.name, r.status]),
      [[2, "웹 고양이", "focusing"]],
    );
    assert.equal(
      await client.travel("home"),
      false,
      "집중 중에는 섬을 옮기지 않는다",
    );
    const seen = await observer.next(
      (m) => m.type === "snapshot" && reservation(m, 2)?.name === "웹 고양이",
    );
    assert.equal(
      seen.residents.find((p: any) => p.name === "웹 고양이").seatId,
      2,
    );
    state = await until(client, (s) => s.residents.length === 2);
    assert.deepEqual(
      state.residents.map((p) => [p.id, p.island]).sort(),
      [
        [homebody.id, "home"],
        [observer.id, "focus"],
      ].sort(),
      "두 섬 주민을 모두 주고 나는 뺀다",
    );
    clock += 5000;
    assert.equal(await client.pauseFocus(), true);
    state = client.getState();
    assert.deepEqual(
      { ...state.session },
      {
        seatId: 2,
        subject: "코딩",
        status: "paused",
        elapsedMs: 5000,
        startedAt: null,
      },
    );
    assert.equal(
      focusElapsedMs(state.session, Date.now() + 1e7),
      5000,
      "휴식 중에는 멈춘다",
    );
    const spot = restSpot(2);
    assert.deepEqual(sim.actor, {
      ...sim.actor,
      island: "home",
      ...spot,
      action: "sit",
    });
    assert.equal(sim.actor.seatId, undefined);
    assert.equal(state.reservations[0].status, "paused");
    assert.equal(
      (await observer.command("claim-seat", { seatId: 2 })).ok,
      false,
    );
    clock += 60_000;
    assert.equal(await client.resumeFocus(), true);
    assert.equal(client.getState().session!.elapsedMs, 5000);
    assert.equal(client.getState().session!.status, "focusing");
    assert.deepEqual(sim.actor, seated(2, sim.actor));
    clock += 1000;
    const result = await client.finishFocus();
    assert.equal(result!.subject, "코딩");
    assert.equal(result!.elapsedMs, 6000, "쉰 60초는 빼고 집중한 6초만");
    state = client.getState();
    assert.equal(state.session, null);
    assert.deepEqual(state.reservations, []);
    assert.deepEqual(
      {
        island: sim.actor.island,
        x: sim.actor.x,
        z: sim.actor.z,
        action: sim.actor.action,
      },
      { island: "focus", ...seatExit(2), action: "idle" },
    );
    assert.equal(await client.finishFocus(), null);
    // 비상 취소: 응답 전에 취소하면 늦은 착석 응답은 버리고 서버 예약도 지운다.
    const late = client.claimSeat(7);
    client.leaveSeat();
    assert.equal(await late, false);
    assert.equal(client.getState().session, null);
    assert.equal(
      client.getState().busy,
      true,
      "취소 응답까지 다른 명령을 막는다",
    );
    await until(client, (s) => !s.busy);
    assert.equal(client.getState().session, null);
    assert.notEqual(sim.actor.action, "focus");
    const after = await observer.settled();
    assert.equal(reservation(after, 7), undefined);
    assert.equal(
      (await observer.command("claim-seat", { seatId: 7 })).ok,
      true,
    );
    assert.equal(await client.travel("home"), true);
    assert.deepEqual(
      { x: sim.actor.x, z: sim.actor.z, island: sim.actor.island },
      { ...SPAWN, island: "home" },
    );
  } finally {
    client.stop();
    await room.stop();
  }
});

// 결정적인 경합 검사용 가짜 소켓. 브라우저 WebSocket과 같은 속성만 흉내 낸다.
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error("닫힌 소켓");
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({});
  }
  open(id = "me", serverNow = 0) {
    this.readyState = 1;
    this.onopen?.({});
    this.deliver({
      type: "welcome",
      id,
      actor: createActor(),
      session: null,
      serverNow,
    });
  }
  deliver(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  last(type: string) {
    return this.sent.filter((m) => m.type === type).at(-1);
  }
  /** 마지막 type 명령에 성공 응답. */
  ack(type: string, body: Record<string, unknown>, serverNow = 0) {
    const request = this.last(type);
    this.deliver({
      type: "command-result",
      command: type,
      requestId: request.requestId,
      ok: true,
      serverNow,
      ...body,
    });
    return request;
  }
}
function fakeClient(t: { mock: any }, clock: { now: number }) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  FakeSocket.all = [];
  const sim = new Simulation();
  sim.actor.name = "나";
  const client = new RoomClient(sim, {
    url: "ws://local/island-room",
    createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
    now: () => clock.now,
  });
  client.start();
  const socket = FakeSocket.all[0];
  socket.open("me", clock.now);
  return { sim, client, socket };
}
const focusSession = (seatId: number, startedAt: number, subject = "") => ({
  seatId,
  subject,
  status: "focusing",
  elapsedMs: 0,
  startedAt,
});
async function seat(
  socket: FakeSocket,
  client: RoomClient,
  sim: Simulation,
  seatId: number,
  startedAt = 0,
) {
  const travel = client.travel("focus");
  socket.ack("travel", {
    actor: arrivalActor("focus", sim.actor),
    session: null,
  });
  assert.equal(await travel, true);
  const claim = client.claimSeat(seatId);
  socket.ack(
    "claim-seat",
    {
      actor: seated(seatId, sim.actor),
      session: focusSession(seatId, startedAt),
    },
    startedAt,
  );
  assert.equal(await claim, true);
}

test("응답이 늦으면 명령을 실패로 끝내고 연결을 끊었다가 새 연결은 일반 섬 처음 상태로 시작한다", async (t) => {
  const clock = { now: 0 };
  const { sim, client, socket } = fakeClient(t, clock);
  try {
    await seat(socket, client, sim, 1);
    const pause = client.pauseFocus();
    assert.equal(client.getState().busy, true);
    t.mock.timers.tick(4999);
    assert.equal(client.getState().busy, true);
    t.mock.timers.tick(1);
    assert.equal(await pause, false);
    assert.equal(
      socket.readyState,
      3,
      "응답을 잃으면 연결을 끊어 서버 예약도 풀게 한다",
    );
    let state = client.getState();
    assert.equal(state.status, "offline");
    assert.equal(state.session, null);
    assert.deepEqual(state.reservations, []);
    assert.match(state.seatError!, /연결이 끊어져 집중을 멈추고/);
    assert.deepEqual(sim.actor, arrivalActor("home", sim.actor));
    // 끊긴 연결의 늦은 응답은 아무것도 바꾸지 않는다.
    socket.onmessage?.({
      data: JSON.stringify({
        type: "command-result",
        command: "pause-focus",
        requestId: socket.last("pause-focus").requestId,
        ok: true,
      }),
    });
    assert.equal(client.getState().session, null);
    t.mock.timers.tick(3000);
    assert.equal(FakeSocket.all.length, 2);
    sim.actor.x = 5;
    FakeSocket.all[1].open("me-2", clock.now);
    state = client.getState();
    assert.equal(state.status, "online");
    assert.equal(state.session, null);
    assert.deepEqual(
      { x: sim.actor.x, z: sim.actor.z, island: sim.actor.island },
      { ...SPAWN, island: "home" },
    );
    assert.match(
      state.seatError!,
      /연결이 끊어져/,
      "새 연결 뒤에도 중단 안내를 남긴다",
    );
  } finally {
    client.stop();
  }
});

test("비상 취소 뒤 늦은 착석 응답·스냅샷이 취소한 집중을 되살리지 않는다", async (t) => {
  const clock = { now: 0 };
  const { sim, client, socket } = fakeClient(t, clock);
  try {
    const travel = client.travel("focus");
    socket.ack("travel", {
      actor: arrivalActor("focus", sim.actor),
      session: null,
    });
    await travel;
    const claim = client.claimSeat(3, "수학");
    const request = socket.last("claim-seat");
    client.leaveSeat();
    assert.equal(await claim, false);
    const cancel = socket.last("cancel-focus");
    assert.ok(cancel && cancel.requestId !== request.requestId);
    assert.equal(client.getState().busy, true);
    // 서버는 착석을 먼저 처리했으므로 늦은 성공 응답과 그 시점의 스냅샷이 온다.
    socket.deliver({
      type: "command-result",
      command: "claim-seat",
      requestId: request.requestId,
      ok: true,
      actor: seated(3, sim.actor),
      session: focusSession(3, 0, "수학"),
      serverNow: 0,
    });
    socket.deliver({
      type: "snapshot",
      residents: [{ ...seated(3, sim.actor), id: "me" }],
      reservations: [
        { seatId: 3, residentId: "me", name: "나", status: "focusing" },
      ],
    });
    let state = client.getState();
    assert.equal(state.session, null);
    assert.deepEqual(state.reservations, []);
    assert.notEqual(sim.actor.action, "focus");
    // 취소 응답의 서버 위치는 같은 섬이면 내 자유 이동을 덮지 않는다.
    sim.actor.x += 0.3;
    const x = sim.actor.x;
    socket.ack("cancel-focus", {
      actor: { ...arrivalActor("focus", sim.actor), ...seatExit(3) },
      session: null,
    });
    state = client.getState();
    assert.equal(state.busy, false);
    assert.equal(sim.actor.x, x);
    // 같은 종류 명령이라도 requestId가 다른 응답은 지금 명령의 응답이 아니다.
    const next = client.claimSeat(5);
    socket.deliver({
      type: "command-result",
      command: "claim-seat",
      requestId: request.requestId,
      ok: true,
      actor: seated(3, sim.actor),
      session: focusSession(3, 0, "수학"),
      serverNow: 0,
    });
    assert.equal(client.getState().busy, true);
    assert.equal(client.getState().session, null);
    socket.ack("claim-seat", {
      actor: seated(5, sim.actor),
      session: focusSession(5, 0),
    });
    assert.equal(await next, true);
    assert.equal(client.getState().session!.seatId, 5);
    assert.equal(sim.actor.seatId, 5);
    const finish = client.finishFocus();
    socket.ack("finish-focus", {
      actor: { ...arrivalActor("focus", sim.actor), ...seatExit(5) },
      session: null,
      result: { subject: "", elapsedMs: 0, finishedAt: 0 },
    });
    assert.deepEqual(await finish, {
      subject: "",
      elapsedMs: 0,
      finishedAt: 0,
    });
    // 섬 이동 중 취소해 섬이 어긋났다면 서버 섬으로 맞춘다.
    const back = client.travel("home");
    client.leaveSeat();
    assert.equal(await back, false);
    socket.ack("cancel-focus", {
      actor: arrivalActor("home", sim.actor),
      session: null,
    });
    assert.equal(sim.actor.island, "home");
    assert.equal(client.getState().busy, false);
    // 취소 응답이 오지 않으면 연결을 다시 시작한다.
    client.leaveSeat();
    t.mock.timers.tick(5000);
    assert.equal(socket.readyState, 3);
  } finally {
    client.stop();
  }
});

test("연결이 끊기면 기다리던 명령·세션·예약·주민을 비우고 일반 섬으로 돌아온다", async (t) => {
  const clock = { now: 0 };
  const { sim, client, socket } = fakeClient(t, clock);
  try {
    await seat(socket, client, sim, 4);
    socket.deliver({
      type: "snapshot",
      residents: [
        {
          ...arrivalActor("home", { name: "이웃", color: "white" }),
          id: "other",
        },
      ],
      reservations: [
        { seatId: 9, residentId: "other", name: "이웃", status: "paused" },
      ],
    });
    assert.equal(client.getState().reservations.length, 2);
    const finish = client.finishFocus();
    sim.keys.add("a");
    socket.close();
    assert.equal(await finish, null);
    const state = client.getState();
    assert.equal(state.status, "offline");
    assert.equal(state.busy, false);
    assert.equal(state.session, null);
    assert.deepEqual(state.reservations, []);
    assert.deepEqual(state.residents, []);
    assert.match(state.seatError!, /자리를 비웠어요/);
    assert.deepEqual(sim.actor, arrivalActor("home", sim.actor));
    assert.equal(sim.keys.size, 0);
    assert.equal(await client.claimSeat(0), false);
    assert.equal(await client.travel("focus"), false);
    assert.match(client.getState().seatError!, /연결된 뒤/);
  } finally {
    client.stop();
  }
});

test("스냅샷은 나를 뺀 두 섬 주민을 59명까지 주고, 예약은 검증한 뒤 내 세션 자리를 덧씌운다", async (t) => {
  const clock = { now: 0 };
  const { sim, client, socket } = fakeClient(t, clock);
  try {
    await seat(socket, client, sim, 0);
    const residents: unknown[] = [
      { ...seated(0, sim.actor), id: "me" },
      {
        ...arrivalActor("home", { name: "섬 주민", color: "brown" }),
        id: "dup",
      },
      {
        ...arrivalActor("focus", { name: "섬 주민", color: "brown" }),
        id: "dup",
      },
      {
        ...arrivalActor("home", { name: "잘못", color: "cream" }),
        color: "red",
        id: "bad-color",
      },
      { ...seated(1, sim.actor), island: "home", id: "bad-island" },
      { ...arrivalActor("home", sim.actor), id: 7 },
      null,
    ];
    for (let i = 0; i < ROOM_CAPACITY + 10; i++)
      residents.push({
        ...arrivalActor(i % 2 ? "home" : "focus", {
          name: `주민${i}`,
          color: "cream",
        }),
        id: `p${i}`,
      });
    socket.deliver({
      type: "snapshot",
      residents,
      reservations: [
        { seatId: 0, residentId: "me", name: "옛 이름", status: "paused" },
        { seatId: 0, residentId: "other", name: "겹침", status: "focusing" },
        { seatId: 5, residentId: "a", name: "다섯", status: "paused" },
        { seatId: 5, residentId: "b", name: "중복", status: "focusing" },
        { seatId: 30, residentId: "c", name: "없는 자리", status: "focusing" },
        { seatId: 6, residentId: "d", name: "", status: "focusing" },
        { seatId: 7, residentId: "e", name: "상태", status: "sleeping" },
        { seatId: 8, residentId: "f", name: "여덟", status: "focusing" },
      ],
    });
    const state = client.getState();
    assert.equal(state.residents.length, ROOM_CAPACITY - 1);
    assert.ok(!state.residents.some((p) => p.id === "me"));
    assert.equal(
      new Set(state.residents.map((p) => p.id)).size,
      state.residents.length,
    );
    assert.ok(
      !state.residents.some((p) => ["bad-color", "bad-island"].includes(p.id)),
    );
    assert.deepEqual(
      new Set(state.residents.map((p) => p.island)),
      new Set(["home", "focus"]),
    );
    assert.deepEqual(state.reservations, [
      { seatId: 0, residentId: "me", name: "나", status: "focusing" },
      { seatId: 5, residentId: "a", name: "다섯", status: "paused" },
      { seatId: 8, residentId: "f", name: "여덟", status: "focusing" },
    ]);
  } finally {
    client.stop();
  }
});

test("명령과 맞지 않는 성공 응답은 반영하지 않고 연결을 다시 시작한다", async (t) => {
  const clock = { now: 0 };
  const { sim, client, socket } = fakeClient(t, clock);
  try {
    const travel = client.travel("focus");
    socket.ack("travel", {
      actor: arrivalActor("focus", sim.actor),
      session: null,
    });
    await travel;
    const before = { ...sim.actor };
    const claim = client.claimSeat(4);
    socket.ack("claim-seat", {
      actor: seated(5, sim.actor),
      session: focusSession(4, 0),
    });
    assert.equal(await claim, false);
    assert.equal(socket.readyState, 3);
    assert.equal(client.getState().session, null);
    // 끊긴 뒤에는 일반 섬으로 돌아가며 엉뚱한 의자에 앉지 않는다.
    assert.notDeepEqual(sim.actor, seated(5, before));
    assert.equal(sim.actor.island, "home");
  } finally {
    client.stop();
  }
});

test("서버와 기기 시각이 달라도 집중 시간은 서버가 정한 구간 길이를 따른다", async (t) => {
  const clock = { now: 50_000 };
  const { sim, client, socket } = fakeClient(t, clock);
  try {
    const serverNow = clock.now + 3_600_000;
    const travel = client.travel("focus");
    socket.ack(
      "travel",
      { actor: arrivalActor("focus", sim.actor), session: null },
      serverNow,
    );
    await travel;
    const claim = client.claimSeat(6);
    socket.ack(
      "claim-seat",
      {
        actor: seated(6, sim.actor),
        session: focusSession(6, serverNow - 2000),
      },
      serverNow,
    );
    await claim;
    const session = client.getState().session!;
    assert.equal(session.startedAt, clock.now - 2000);
    assert.equal(focusElapsedMs(session, clock.now + 3000), 5000);
    // 잘못된 세션 값은 받지 않는다.
    const pause = client.pauseFocus();
    socket.ack("pause-focus", {
      actor: {
        ...restSpot(6),
        island: "home",
        action: "sit",
        name: "나",
        color: "cream",
      },
      session: { ...session, status: "paused", startedAt: 1, elapsedMs: -1 },
    });
    assert.equal(await pause, false);
    assert.equal(socket.readyState, 3);
  } finally {
    client.stop();
  }
});

test("멈추면 기다리던 명령을 실패로 끝내고 다시 연결하지 않는다", async (t) => {
  const clock = { now: 0 };
  const { client, socket } = fakeClient(t, clock);
  const travel = client.travel("focus");
  client.stop();
  assert.equal(await travel, false);
  assert.equal(socket.readyState, 3);
  t.mock.timers.tick(10_000);
  assert.equal(FakeSocket.all.length, 1);
  assert.equal(client.getState().status, "offline");
});

test("같은 위치는 다시 보내지 않고 이동·꾸미기 변경과 heartbeat만 보낸다", (t) => {
  const clock = { now: 1000000 };
  const { sim, client, socket } = fakeClient(t, clock);
  t.mock.timers.tick(100);
  assert.equal(socket.sent.filter((m) => m.type === "move").length, 1);
  t.mock.timers.tick(1000);
  assert.equal(socket.sent.filter((m) => m.type === "move").length, 1);
  sim.actor.x += 1;
  t.mock.timers.tick(100);
  assert.equal(socket.sent.filter((m) => m.type === "move").length, 2);
  sim.actor.name = "다른 이름";
  t.mock.timers.tick(100);
  assert.equal(socket.last("move").actor.name, "다른 이름");
  const count = socket.sent.length;
  clock.now += 30000;
  t.mock.timers.tick(100);
  assert.equal(socket.sent.length, count + 1);
  assert.equal(socket.sent.at(-1).type, "ping");
  client.stop();
});
