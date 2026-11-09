import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import {
  CAPACITY,
  FOCUS_SEATS,
  ROOM_CAPACITY,
  getFocusSeat,
} from "../src/layout";
import {
  FOCUS_SPAWN,
  SPAWN,
  createActor,
  restSpot,
  seatExit,
  walkable,
  validActor,
} from "../src/world";
import {
  startRoom,
  resident,
  reservation,
  type RoomClientSocket,
} from "./room-harness";

const seatActor = (seatId: number) => {
  const seat = getFocusSeat(seatId)!;
  return {
    ...createActor(),
    island: "focus",
    x: seat.x,
    z: seat.z,
    yaw: seat.yaw,
    action: "focus",
    seatId,
  };
};
async function toFocus(client: RoomClientSocket) {
  const result = await client.command("travel", { island: "focus" });
  assert.equal(result.ok, true);
  return result;
}

test("일반 섬은 의자 명령을 거부하고, 여행은 겉모습만 이어 각 섬 시작점에 도착한다", async () => {
  const room = await startRoom();
  try {
    const a = await room.connect(),
      b = await room.connect();
    assert.deepEqual(a.welcome.actor, createActor());
    assert.equal(a.welcome.session, null);
    const home = await a.command("claim-seat", { seatId: 0 });
    assert.equal(home.ok, false);
    assert.equal(home.actor, undefined);
    a.move({
      ...createActor(),
      name: "첫 고양이",
      color: "black",
      x: 1,
      z: 11,
      action: "wave",
    });
    const waved = resident(await a.settled(), a.id);
    assert.deepEqual(
      {
        name: waved.name,
        color: waved.color,
        x: waved.x,
        action: waved.action,
      },
      { name: "첫 고양이", color: "black", x: 1, action: "wave" },
    );
    const arrived = await toFocus(a);
    assert.deepEqual(arrived.actor, {
      island: "focus",
      ...FOCUS_SPAWN,
      yaw: 0,
      action: "idle",
      color: "black",
      name: "첫 고양이",
    });
    assert.equal(arrived.session, null);
    // 여행 전 섬 좌표로 보낸 늦은 move는 새 섬 상태를 덮지 못한다.
    a.move({
      ...createActor(),
      name: "첫 고양이",
      color: "black",
      x: 2,
      z: 12,
    });
    const snapshot = await b.settled();
    assert.equal(resident(snapshot, a.id).island, "focus");
    assert.equal(resident(snapshot, a.id).x, FOCUS_SPAWN.x);
    assert.equal(resident(snapshot, b.id).island, "home");
    assert.equal((await a.command("travel", { island: "moon" })).ok, false);
    const back = await a.command("travel", { island: "home" });
    assert.deepEqual(
      { ...back.actor },
      { ...createActor(), name: "첫 고양이", color: "black" },
    );
    assert.deepEqual({ x: back.actor.x, z: back.actor.z }, SPAWN);
  } finally {
    await room.stop();
  }
});

test("move로 섬·집중·자리·시간을 위조하지 못하고 이름·털색만 바꾼다", async () => {
  let clock = 1000;
  const room = await startRoom({ now: () => clock });
  try {
    const a = await room.connect(),
      b = await room.connect();
    // 일반 섬에서 낚시섬 좌표·좌석 자세를 보내도 섬이 바뀌지 않는다.
    a.move({ ...createActor(), island: "focus", ...FOCUS_SPAWN });
    a.move(seatActor(4));
    let snapshot = await b.settled();
    assert.equal(resident(snapshot, a.id).island, "home");
    assert.equal(resident(snapshot, a.id).action, "idle");
    assert.equal(snapshot.reservations.length, 0);
    await toFocus(a);
    const claimed = await a.command("claim-seat", {
      seatId: 2,
      subject: "영어",
    });
    assert.equal(claimed.ok, true);
    clock = 9000;
    for (const forged of [
      { ...seatActor(20), name: "새 이름", color: "gray" },
      {
        ...createActor(),
        island: "focus",
        ...seatExit(2),
        name: "새 이름",
        color: "gray",
      },
      { ...createActor(), island: "home", name: "새 이름", color: "gray" },
      {
        ...seatActor(2),
        name: "새 이름",
        color: "gray",
        session: { elapsedMs: 1e9 },
        startedAt: 0,
      },
    ])
      a.move(forged);
    snapshot = await b.settled();
    const focused = resident(snapshot, a.id);
    assert.deepEqual(focused, {
      ...claimed.actor,
      name: "새 이름",
      color: "gray",
      id: a.id,
    });
    assert.deepEqual(reservation(snapshot, 2), {
      seatId: 2,
      residentId: a.id,
      name: "새 이름",
      status: "focusing",
    });
    // 같은 자리 재선택은 서버 세션을 그대로 돌려준다.
    const same = await a.command("claim-seat", {
      seatId: 2,
      subject: "바꾸기",
    });
    assert.deepEqual(same.session, claimed.session);
    // 이름·털색도 규칙을 어기면 받지 않는다.
    a.move({ ...seatActor(2), name: "x".repeat(17), color: "red" });
    snapshot = await b.settled();
    assert.equal(resident(snapshot, a.id).name, "새 이름");
    assert.equal(resident(snapshot, a.id).color, "gray");
  } finally {
    await room.stop();
  }
});

test("낚시섬 30석은 동시 요청에도 배타적이고 다른 섬 주민과 함께 60명까지 받는다", async () => {
  const room = await startRoom();
  try {
    const clients: RoomClientSocket[] = [];
    for (let i = 0; i < ROOM_CAPACITY; i++) clients.push(await room.connect());
    const fishers = clients.slice(0, CAPACITY + 1);
    await Promise.all(fishers.map(toFocus));
    // 31명이 0번 의자를 동시에 고르면 한 명만 앉는다.
    const race = await Promise.all(
      fishers.map((c) => c.command("claim-seat", { seatId: 0 })),
    );
    assert.equal(race.filter((r) => r.ok).length, 1);
    const winner = fishers[race.findIndex((r) => r.ok)];
    const rest = fishers.filter((c) => c !== winner);
    const results = await Promise.all(
      rest.map((c, i) =>
        c.command("claim-seat", { seatId: (i % (CAPACITY - 1)) + 1 }),
      ),
    );
    // 29석이 남았으니 30명 중 29명만 앉는다.
    assert.equal(results.filter((r) => r.ok).length, CAPACITY - 1);
    const left = rest.find((_, i) => !results[i].ok)!;
    for (const seat of FOCUS_SEATS)
      assert.equal(
        (await left.command("claim-seat", { seatId: seat.id })).ok,
        false,
      );
    const snapshot = await clients.at(-1)!.settled();
    assert.equal(snapshot.residents.length, ROOM_CAPACITY);
    assert.equal(snapshot.reservations.length, CAPACITY);
    assert.equal(
      new Set(snapshot.reservations.map((r: any) => r.seatId)).size,
      CAPACITY,
    );
    assert.equal(
      snapshot.residents.filter((p: any) => p.island === "home").length,
      ROOM_CAPACITY - CAPACITY - 1,
    );
    assert.equal(
      snapshot.residents.filter((p: any) => p.action === "focus").length,
      CAPACITY,
    );
    for (const p of snapshot.residents) assert.ok(validActor(p));
    const rejected = room.open();
    const [error] = await once(rejected, "error");
    assert.ok(error);
    rejected.terminate();
  } finally {
    await room.stop();
  }
});

test("자리 변경은 주제·누적 시간을 이어가고 앞 자리를 바로 비운다", async () => {
  let clock = 1000;
  const room = await startRoom({ now: () => clock });
  try {
    const a = await room.connect(),
      b = await room.connect();
    await toFocus(a);
    await toFocus(b);
    assert.equal(
      (await a.command("claim-seat", { seatId: 0, subject: "x".repeat(41) }))
        .ok,
      false,
    );
    assert.equal(
      (await a.command("claim-seat", { seatId: 0, subject: 7 })).ok,
      false,
    );
    assert.equal((await a.command("claim-seat", { seatId: 30 })).ok, false);
    assert.equal((await a.command("claim-seat", { seatId: "1" })).ok, false);
    const first = await a.command("claim-seat", {
      seatId: 0,
      subject: "  수학 문제  ",
    });
    assert.deepEqual(first.session, {
      seatId: 0,
      subject: "수학 문제",
      status: "focusing",
      elapsedMs: 0,
      startedAt: 1000,
    });
    clock = 4000;
    const moved = await a.command("claim-seat", {
      seatId: 3,
      subject: "다른 일",
    });
    assert.deepEqual(moved.session, { ...first.session, seatId: 3 });
    const seat = getFocusSeat(3)!;
    assert.deepEqual(
      {
        x: moved.actor.x,
        z: moved.actor.z,
        yaw: moved.actor.yaw,
        seatId: moved.actor.seatId,
      },
      { x: seat.x, z: seat.z, yaw: seat.yaw, seatId: 3 },
    );
    assert.equal((await b.command("claim-seat", { seatId: 3 })).ok, false);
    assert.equal((await b.command("claim-seat", { seatId: 0 })).ok, true);
    assert.equal((await a.command("claim-seat", { seatId: 0 })).ok, false);
    clock = 10000;
    const finished = await a.command("finish-focus");
    assert.deepEqual(finished.result, {
      subject: "수학 문제",
      elapsedMs: 9000,
      finishedAt: 10000,
    });
  } finally {
    await room.stop();
  }
});

test("휴식은 시간을 멈추고 예약을 지키며, 이어가기는 누적하고 종료는 자리를 비운다", async () => {
  let clock = 1000;
  const room = await startRoom({ now: () => clock });
  try {
    const a = await room.connect(),
      b = await room.connect();
    await toFocus(a);
    await toFocus(b);
    assert.equal((await a.command("pause-focus")).ok, false);
    assert.equal((await a.command("resume-focus")).ok, false);
    assert.equal((await a.command("finish-focus")).ok, false);
    await a.command("claim-seat", { seatId: 5, subject: "독서" });
    clock = 6000;
    const paused = await a.command("pause-focus");
    assert.deepEqual(paused.session, {
      seatId: 5,
      subject: "독서",
      status: "paused",
      elapsedMs: 5000,
      startedAt: null,
    });
    const spot = restSpot(5);
    assert.deepEqual(paused.actor, {
      ...createActor(),
      island: "home",
      ...spot,
      action: "sit",
    });
    assert.equal((await a.command("pause-focus")).ok, false);
    assert.equal((await a.command("travel", { island: "focus" })).ok, false);
    assert.equal((await a.command("claim-seat", { seatId: 6 })).ok, false);
    // 쉬는 동안에도 자리는 예약돼 있어 다른 주민이 앉지 못한다.
    assert.equal((await b.command("claim-seat", { seatId: 5 })).ok, false);
    let snapshot = await b.settled();
    assert.deepEqual(reservation(snapshot, 5), {
      seatId: 5,
      residentId: a.id,
      name: createActor().name,
      status: "paused",
    });
    // 휴식 중에는 일반 섬 안에서만 걸을 수 있다.
    a.move({ ...createActor(), x: 2, z: 6, action: "walk" });
    a.move({ ...createActor(), island: "focus", ...FOCUS_SPAWN });
    snapshot = await b.settled();
    assert.deepEqual(
      {
        island: resident(snapshot, a.id).island,
        x: resident(snapshot, a.id).x,
      },
      { island: "home", x: 2 },
    );
    clock = 60000;
    const resumed = await a.command("resume-focus");
    assert.deepEqual(resumed.session, {
      seatId: 5,
      subject: "독서",
      status: "focusing",
      elapsedMs: 5000,
      startedAt: 60000,
    });
    assert.deepEqual(resumed.actor, seatActor(5));
    assert.equal((await a.command("resume-focus")).ok, false);
    clock = 63000;
    const finished = await a.command("finish-focus");
    assert.deepEqual(finished.result, {
      subject: "독서",
      elapsedMs: 8000,
      finishedAt: 63000,
    });
    assert.equal(finished.session, null);
    assert.deepEqual(finished.actor, {
      ...createActor(),
      island: "focus",
      ...seatExit(5),
      yaw: getFocusSeat(5)!.yaw,
    });
    assert.ok(walkable(finished.actor, "focus"));
    snapshot = await b.settled();
    assert.equal(snapshot.reservations.length, 0);
    assert.equal((await b.command("claim-seat", { seatId: 5 })).ok, true);
  } finally {
    await room.stop();
  }
});

test("휴식 중 종료는 우리 섬에 남고 결과는 쉰 시간을 빼며, 취소는 결과 없이 비운다", async () => {
  let clock = 0;
  const room = await startRoom({ now: () => clock });
  try {
    const a = await room.connect();
    await toFocus(a);
    await a.command("claim-seat", { seatId: 9 });
    clock = 2000;
    await a.command("pause-focus");
    clock = 600000;
    const finished = await a.command("finish-focus");
    assert.deepEqual(finished.result, {
      subject: "",
      elapsedMs: 2000,
      finishedAt: 600000,
    });
    assert.deepEqual(finished.actor, {
      ...createActor(),
      island: "home",
      ...restSpot(9),
      action: "idle",
    });
    // 낚시섬으로 돌아가 다시 앉았다가 비상 취소한다.
    await toFocus(a);
    await a.command("claim-seat", { seatId: 9 });
    const canceled = await a.command("cancel-focus");
    assert.equal(canceled.ok, true);
    assert.equal(canceled.session, null);
    assert.equal(canceled.result, undefined);
    assert.deepEqual({ x: canceled.actor.x, z: canceled.actor.z }, seatExit(9));
    assert.equal(canceled.actor.action, "idle");
    // 세션 없이 취소해도 상태는 그대로다.
    const again = await a.command("cancel-focus");
    assert.deepEqual(again.actor, canceled.actor);
    assert.equal((await a.settled()).reservations.length, 0);
  } finally {
    await room.stop();
  }
});

test("앞서 보낸 명령과 취소는 도착 순서대로 판정되어 취소가 마지막 상태가 된다", async () => {
  const room = await startRoom();
  try {
    const a = await room.connect(),
      b = await room.connect();
    await toFocus(a);
    await toFocus(b);
    const claim = a.command("claim-seat", { seatId: 12 });
    const pause = a.command("pause-focus");
    const cancel = a.command("cancel-focus");
    const [claimed, paused, canceled] = await Promise.all([
      claim,
      pause,
      cancel,
    ]);
    assert.equal(claimed.ok, true);
    assert.equal(paused.ok, true);
    assert.equal(canceled.session, null);
    // 휴식 중 취소는 일반 섬에 남는다.
    assert.equal(canceled.actor.island, "home");
    const snapshot = await b.settled();
    assert.equal(reservation(snapshot, 12), undefined);
    assert.equal((await b.command("claim-seat", { seatId: 12 })).ok, true);
  } finally {
    await room.stop();
  }
});

test("잘못된 형식·requestId·큰 메시지는 상태를 바꾸지 않는다", async () => {
  const room = await startRoom();
  try {
    const a = await room.connect(),
      b = await room.connect();
    await toFocus(a);
    let replies = 0;
    a.ws.on("message", (raw) => {
      if (JSON.parse(raw.toString()).type === "command-result") replies++;
    });
    a.ws.send(JSON.stringify({ type: "claim-seat", seatId: 1 }));
    a.ws.send(JSON.stringify({ type: "claim-seat", seatId: 1, requestId: "" }));
    a.ws.send(
      JSON.stringify({
        type: "claim-seat",
        seatId: 1,
        requestId: "x".repeat(65),
      }),
    );
    a.ws.send(JSON.stringify({ type: "claim-seat", seatId: 1, requestId: 3 }));
    a.ws.send("{not json");
    a.ws.send("null");
    a.ws.send(JSON.stringify([1, 2]));
    a.ws.send(
      Buffer.from(
        JSON.stringify({ type: "claim-seat", seatId: 1, requestId: "bin" }),
      ),
      { binary: true },
    );
    const snapshot = await a.settled();
    // settled()의 확인 명령 응답만 받았다.
    assert.equal(replies, 1);
    assert.equal(snapshot.reservations.length, 0);
    const closed = once(a.ws, "close");
    a.ws.send("x".repeat(4096));
    const [code] = await closed;
    // 서버가 1009로 닫거나 바로 끊는다(1006). 어느 쪽이든 연결은 정리된다.
    assert.ok([1006, 1009].includes(code), String(code));
    const after = await b.next(
      (m) => m.type === "snapshot" && !resident(m, a.id),
    );
    assert.equal(after.residents.length, 1);
  } finally {
    await room.stop();
  }
});

test("다른 사이트와 잘못된 Origin은 연결하지 않는다", async () => {
  const room = await startRoom();
  try {
    for (const origin of ["https://unrelated.example", "malformed"]) {
      const ws = room.open(origin);
      const [error] = await once(ws, "error");
      assert.ok(error);
      ws.terminate();
    }
  } finally {
    await room.stop();
  }
});

test("연결이 닫히면 서버 스냅샷에서 주민·집중·휴식 예약이 사라지고 새 연결은 처음부터 시작한다", async () => {
  const room = await startRoom();
  try {
    const a = await room.connect(),
      b = await room.connect(),
      c = await room.connect();
    await toFocus(a);
    await toFocus(b);
    await a.command("claim-seat", { seatId: 0 });
    await b.command("claim-seat", { seatId: 1 });
    await b.command("pause-focus");
    let snapshot = await c.settled();
    assert.equal(snapshot.reservations.length, 2);
    // 클라이언트 close만으로는 서버 정리가 끝났다고 볼 수 없어 서버 스냅샷으로 확인한다.
    a.ws.close();
    b.ws.close();
    snapshot = await c.next(
      (m) => m.type === "snapshot" && !resident(m, a.id) && !resident(m, b.id),
    );
    assert.equal(snapshot.residents.length, 1);
    assert.equal(snapshot.reservations.length, 0);
    const again = await room.connect();
    assert.notEqual(again.id, a.id);
    assert.deepEqual(again.welcome.actor, createActor());
    assert.equal(again.welcome.session, null);
    await toFocus(again);
    assert.equal((await again.command("claim-seat", { seatId: 0 })).ok, true);
    assert.equal(
      (await again.command("finish-focus")).result.elapsedMs >= 0,
      true,
    );
    assert.equal((await c.command("travel", { island: "focus" })).ok, true);
    assert.equal((await c.command("claim-seat", { seatId: 1 })).ok, true);
  } finally {
    await room.stop();
  }
});

test("heartbeat 만료로 퇴장한 연결은 집중·휴식 예약을 즉시 해제한다", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const room = await startRoom();
  try {
    const a = await room.connect({ autoPong: false }),
      c = await room.connect({ autoPong: false });
    await toFocus(a);
    await toFocus(c);
    assert.equal((await a.command("claim-seat", { seatId: 4 })).ok, true);
    assert.equal((await c.command("claim-seat", { seatId: 6 })).ok, true);
    assert.equal((await c.command("pause-focus")).ok, true);
    const pinged = Promise.all([once(a.ws, "ping"), once(c.ws, "ping")]);
    t.mock.timers.tick(10000);
    await pinged;
    // pong 없이 다음 heartbeat가 오면 서버가 끊는다.
    await a.command("travel", { island: "nowhere" });
    const closed = Promise.all([once(a.ws, "close"), once(c.ws, "close")]);
    t.mock.timers.tick(10000);
    await closed;
    const b = await room.connect();
    await toFocus(b);
    assert.equal((await b.command("claim-seat", { seatId: 4 })).ok, true);
    assert.equal((await b.command("claim-seat", { seatId: 6 })).ok, true);
  } finally {
    await room.stop();
    t.mock.timers.reset();
  }
});

test("pong에 응답하는 연결은 heartbeat 뒤에도 자리를 지킨다", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const room = await startRoom();
  try {
    const a = await room.connect(),
      b = await room.connect();
    await toFocus(a);
    await toFocus(b);
    await a.command("claim-seat", { seatId: 8 });
    for (let i = 0; i < 3; i++) {
      const pinged = Promise.all([once(a.ws, "ping"), once(b.ws, "ping")]);
      t.mock.timers.tick(10000);
      await pinged;
      // 자동 pong은 ping을 받자마자 나가므로 뒤이은 명령보다 먼저 서버에 닿는다.
      await a.command("travel", { island: "nowhere" });
      await b.command("travel", { island: "nowhere" });
    }
    assert.equal(a.ws.readyState, WebSocket.OPEN);
    assert.equal((await b.command("claim-seat", { seatId: 8 })).ok, false);
  } finally {
    await room.stop();
    t.mock.timers.reset();
  }
});
