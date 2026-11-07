import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMPFIRE,
  FOCUS_ISLAND,
  FOCUS_POND,
  FOCUS_SEATS,
  REST_POINT,
  SEAT_SECTIONS,
} from "../src/layout";
import { Simulation } from "../src/simulation";
import {
  arrivalActor,
  normalizeSubject,
  restSpot,
  sanitizeActor,
  seatExit,
  validActor,
  walkable,
  FOCUS_SPAWN,
  SPAWN,
  type Actor,
} from "../src/world";

const seated = (id: number, base: Actor): Actor => {
  const seat = FOCUS_SEATS[id];
  return {
    ...base,
    island: "focus",
    x: seat.x,
    z: seat.z,
    yaw: seat.yaw,
    action: "focus",
    seatId: id,
  };
};

test("낚시섬 30석은 3구역 10석씩 연못을 보고, 서버 응답으로만 앉고 비상 취소로 일어선다", () => {
  assert.equal(FOCUS_SEATS.length, 30);
  assert.equal(new Set(FOCUS_SEATS.map((s) => `${s.x},${s.z}`)).size, 30);
  for (let ring = 0; ring < SEAT_SECTIONS.length; ring++)
    assert.equal(FOCUS_SEATS.filter((s) => s.ring === ring).length, 10);
  const sim = new Simulation();
  for (const seat of FOCUS_SEATS) {
    assert.ok(
      Math.abs(Math.hypot(seat.x, seat.z) - FOCUS_ISLAND.seatRadius) < 1e-9,
    );
    assert.equal(
      seat.yaw,
      Math.atan2(FOCUS_POND.x - seat.x, FOCUS_POND.z - seat.z),
    );
    sim.keys.add("w");
    sim.path = [{ x: 0, z: 0 }];
    assert.ok(sim.applyAuthoritativeActor(seated(seat.id, sim.actor)));
    assert.ok(validActor(sim.actor));
    assert.equal(sim.actor.island, "focus");
    assert.equal(walkable(seat, "focus"), false);
    assert.equal(sim.keys.size, 0, "앉으면 키 입력을 버린다");
    assert.equal(sim.path.length, 0);
    sim.keys.add("w");
    sim.step(1, 0, Infinity);
    assert.equal(sim.actor.x, seat.x, "집중 중에는 키로 움직이지 않는다");
    assert.equal(sim.moveTo(FOCUS_SPAWN), false);
    assert.equal(sim.action("wave"), false);
    assert.equal(validActor({ ...sim.actor, x: seat.x + 0.1 }), false);
    sim.leaveSeat();
    assert.equal(sim.actor.island, "focus");
    assert.ok(walkable(sim.actor, "focus"));
    assert.ok(validActor(sim.actor));
    assert.equal(sim.actor.seatId, undefined);
    assert.equal(sim.actor.action, "idle");
  }
});

test("집중 Actor는 낚시섬의 실제 좌석·방향을 요구하고 허용 필드만 복사한다", () => {
  const sim = new Simulation();
  const focus = seated(29, sim.actor);
  assert.ok(validActor(focus));
  for (const patch of [
    { seatId: -1 },
    { seatId: 30 },
    { seatId: 0.5 },
    { seatId: undefined },
    { yaw: focus.yaw + 0.2 },
    { island: "home" },
  ])
    assert.equal(
      validActor({ ...focus, ...patch }),
      false,
      JSON.stringify(patch),
    );
  // 집중이 아닌 행동은 좌석을 가질 수 없다.
  assert.equal(validActor({ ...focus, action: "idle" }), false);
  assert.equal(validActor({ ...sim.actor, seatId: 0 }), false);
  const sanitized = sanitizeActor({
    ...focus,
    admin: true,
    focusStartedAt: 1,
  } as Actor);
  assert.deepEqual(Object.keys(sanitized).sort(), [
    "action",
    "color",
    "island",
    "name",
    "seatId",
    "x",
    "yaw",
    "z",
  ]);
  assert.equal("seatId" in sanitizeActor({ ...sim.actor, seatId: 3 }), false);
});

test("서버 Actor 반영은 겉모습을 내 값으로 두고 잘못된 값은 무시한다", () => {
  const sim = new Simulation();
  sim.actor.name = "내 고양이";
  sim.actor.color = "black";
  const before = { ...sim.actor };
  for (const bad of [
    { ...seated(3, sim.actor), island: "home" },
    { ...sim.actor, island: "focus", x: 0, z: 6 },
    { ...sim.actor, x: Infinity },
    null,
    "actor",
  ])
    assert.equal(sim.applyAuthoritativeActor(bad), false);
  assert.deepEqual(sim.actor, before);
  const reference = sim.actor;
  assert.ok(
    sim.applyAuthoritativeActor({
      ...arrivalActor("focus", { name: "서버 기본", color: "cream" }),
    }),
  );
  assert.equal(sim.actor, reference, "장면이 잡은 Actor 참조를 유지한다");
  assert.equal(sim.actor.name, "내 고양이");
  assert.equal(sim.actor.color, "black");
  assert.deepEqual({ x: sim.actor.x, z: sim.actor.z }, FOCUS_SPAWN);
  sim.applyAuthoritativeActor(seated(7, sim.actor));
  sim.resetToHome();
  assert.equal(sim.actor, reference);
  assert.deepEqual(sim.actor, {
    ...SPAWN,
    island: "home",
    yaw: 0,
    action: "idle",
    color: "black",
    name: "내 고양이",
  });
});

test("휴식 자리는 모닥불 둘레에 겹치지 않게 놓이고 0번은 REST_POINT다", () => {
  assert.deepEqual(
    { x: restSpot(0).x, z: restSpot(0).z },
    { x: REST_POINT.x, z: REST_POINT.z },
  );
  const spots = FOCUS_SEATS.map((s) => restSpot(s.id));
  for (const [i, spot] of spots.entries()) {
    assert.ok(walkable(spot, "home"), `휴식 자리 ${i}`);
    assert.ok(
      validActor({
        ...spot,
        island: "home",
        action: "sit",
        color: "cream",
        name: "쉼",
      }),
    );
    assert.ok(
      Math.abs(
        spot.yaw - Math.atan2(CAMPFIRE.x - spot.x, CAMPFIRE.z - spot.z),
      ) < 1e-9,
      "모닥불을 본다",
    );
    for (const other of spots.slice(i + 1))
      assert.ok(Math.hypot(other.x - spot.x, other.z - spot.z) > 1.2);
  }
});

test("의자 옆 출구는 연못 바깥쪽 물가 길이다", () => {
  for (const seat of FOCUS_SEATS) {
    const exit = seatExit(seat.id);
    assert.ok(walkable(exit, "focus"));
    assert.ok(Math.hypot(exit.x - seat.x, exit.z - seat.z) <= 3.01);
    assert.ok(
      Math.hypot(exit.x, exit.z) > FOCUS_ISLAND.seatRadius,
      `${seat.id}번 출구`,
    );
  }
  assert.deepEqual(seatExit(99), FOCUS_SPAWN);
});

test("할 일은 앞뒤 공백을 지우고 40자까지 받는다", () => {
  assert.equal(normalizeSubject(undefined), "");
  assert.equal(normalizeSubject("   "), "");
  assert.equal(normalizeSubject("  수학 문제  "), "수학 문제");
  assert.equal(normalizeSubject("가".repeat(40)), "가".repeat(40));
  assert.equal(normalizeSubject(` ${"가".repeat(40)} `), "가".repeat(40));
  assert.equal(normalizeSubject("가".repeat(41)), null);
  assert.equal(normalizeSubject(42), null);
  assert.equal(normalizeSubject({}), null);
});
