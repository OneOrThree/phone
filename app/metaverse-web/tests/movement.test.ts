import test from "node:test";
import assert from "node:assert/strict";
import {
  DOCK,
  SPAWN,
  FOCUS_SPAWN,
  moveSafe,
  obstacles,
  focusObstacles,
  focusTrees,
  pathTo,
  walkable,
  validActor,
  createActor,
  seatExit,
  type Point,
  type IslandId,
} from "../src/world";
import {
  FOCUS_ISLAND,
  FOCUS_LANDMARKS,
  FOCUS_POND,
  FOCUS_SEATS,
  getFocusSeat,
} from "../src/layout";
import { Simulation } from "../src/simulation";

const pondDistance = (p: Point) =>
  Math.hypot(p.x - FOCUS_POND.x, p.z - FOCUS_POND.z);
// 경로의 모든 구간을 0.05 간격으로 다시 걸어 장애물·연못을 지나지 않는지 본다.
function assertWalkablePath(
  start: Point,
  path: Point[],
  island: IslandId,
  end: Point,
) {
  assert.ok(path.length > 0, "경로가 있어야 한다");
  let at = start;
  for (const p of path) {
    const next = moveSafe(at, p, island);
    assert.ok(Math.hypot(next.x - p.x, next.z - p.z) < 0.01);
    const steps = Math.ceil(Math.hypot(p.x - at.x, p.z - at.z) / 0.05);
    for (let i = 1; i <= steps; i++)
      assert.ok(
        walkable(
          {
            x: at.x + ((p.x - at.x) * i) / steps,
            z: at.z + ((p.z - at.z) * i) / steps,
          },
          island,
        ),
      );
    at = p;
  }
  assert.deepEqual(path.at(-1), end);
}

test("일반 섬: 바다·건물·나무를 막고 부두와 시작점은 걸을 수 있다", () => {
  assert.ok(walkable(SPAWN));
  assert.ok(walkable(DOCK));
  assert.ok(walkable(SPAWN, "home"));
  assert.equal(walkable({ x: 24, z: 0 }), false);
  for (const o of obstacles) assert.equal(walkable(o), false);
  assert.equal(walkable({ x: NaN, z: 0 }), false);
  assert.equal(walkable({ x: 1.6, z: 24 }), false);
  assert.equal(walkable(SPAWN, "moon" as IslandId), false);
});
test("일반 섬에는 물가 30석 장애물이 없고 낚시섬에서만 의자·연못이 막는다", () => {
  const seat = getFocusSeat(0)!;
  assert.ok(walkable(seat, "home"));
  assert.equal(walkable(seat, "focus"), false);
  // 일반 섬 모닥불 앞 마당은 낚시섬에서는 연못이다.
  const yard = { x: 0, z: 6 };
  assert.ok(walkable(yard, "home"));
  assert.equal(walkable(yard, "focus"), false);
  const gramophone = FOCUS_LANDMARKS.gramophone;
  assert.ok(walkable(gramophone, "home"));
  assert.equal(walkable(gramophone, "focus"), false);
  // 일반 섬 건물 자리는 낚시섬에서 막지 않는다(회관을 복제하지 않는다).
  const hallEntrance = { x: -12, z: -11 };
  assert.equal(walkable(hallEntrance, "home"), false);
  assert.ok(walkable(hallEntrance, "focus"));
});
test("낚시섬: 연못 둑 안쪽·랜드마크·나무·외곽 바다·부두를 막는다", () => {
  assert.ok(walkable(FOCUS_SPAWN, "focus"));
  for (const r of [0, 5, 10.5, FOCUS_ISLAND.bankRadius - 0.01])
    for (const angle of [0, 1, 2.5, 4])
      assert.equal(
        walkable({ x: Math.sin(angle) * r, z: Math.cos(angle) * r }, "focus"),
        false,
        `연못 반경 ${r}`,
      );
  // 둑 바로 바깥 물가 길(의자 사이)은 걸을 수 있다.
  assert.ok(walkable({ x: 0, z: FOCUS_ISLAND.bankRadius + 0.05 }, "focus"));
  assert.ok(walkable({ x: 2, z: -11.6 }, "focus"));
  for (const o of focusObstacles) assert.equal(walkable(o, "focus"), false);
  for (const landmark of Object.values(FOCUS_LANDMARKS))
    assert.equal(walkable(landmark, "focus"), false);
  for (const [x, z] of focusTrees)
    assert.equal(walkable({ x, z }, "focus"), false);
  for (const sea of [
    { x: 24, z: 0 },
    { x: -23, z: 0 },
    { x: 0, z: 21 },
    { x: 0, z: -20.5 },
  ])
    assert.equal(walkable(sea, "focus"), false);
  assert.equal(walkable(DOCK, "focus"), false, "일반 섬 뗏목 부두는 없다");
  assert.equal(walkable({ x: NaN, z: 15 }, "focus"), false);
});
test("일반 섬 네 목적지의 모든 경로 구간은 충돌 없이 도착한다", () => {
  for (const end of [
    DOCK,
    { x: -16, z: -10 },
    { x: 16, z: 0 },
    { x: -10, z: 10 },
  ])
    assertWalkablePath(SPAWN, pathTo(SPAWN, end), "home", end);
});
test("낚시섬 경로는 연못을 가로지르지 않고 물가를 돌아 반대편 의자 옆에 닿는다", () => {
  const far = seatExit(15);
  assert.ok(walkable(far, "focus"));
  // 북쪽 물가 길(물길·다리 옆).
  const north = { x: 2, z: -11.6 };
  for (const end of [far, north, { x: 15.5, z: 4 }, { x: -15, z: -6 }]) {
    const path = pathTo(FOCUS_SPAWN, end, "focus");
    assertWalkablePath(FOCUS_SPAWN, path, "focus", end);
    for (const p of path) assert.ok(pondDistance(p) >= FOCUS_ISLAND.bankRadius);
  }
  // 직선은 연못에 막힌다.
  const blocked = moveSafe(FOCUS_SPAWN, north, "focus");
  assert.ok(blocked.z > FOCUS_ISLAND.bankRadius - 0.2);
  assert.deepEqual(pathTo(FOCUS_SPAWN, FOCUS_POND, "focus"), []);
  assert.deepEqual(pathTo(FOCUS_SPAWN, FOCUS_SEATS[3], "focus"), []);
  assert.deepEqual(pathTo(SPAWN, DOCK, "focus"), []);
});
test("건물 반대편까지 돌아가며 장애물 내부 목적지는 거부한다", () => {
  const from = { x: -12, z: -7 },
    to = { x: -12, z: -15 };
  const path = pathTo(from, to);
  assert.ok(path.length > 1);
  let previous = from;
  for (const p of path) {
    assert.ok(walkable(p));
    assert.deepEqual(moveSafe(previous, p), p);
    previous = p;
  }
  assert.deepEqual(pathTo(SPAWN, obstacles[0]), []);
});
test("큰 이동량도 건물·연못을 뚫지 않는다", () => {
  const start = { x: -12, z: -7 },
    stop = moveSafe(start, { x: -12, z: -16 });
  assert.ok(stop.z > -8.3);
  assert.ok(walkable(stop));
  // 0번·29번 의자 사이 틈으로 들어가도 연못 둑에서 멈춘다.
  const shore = moveSafe(FOCUS_SPAWN, { x: 0, z: -30 }, "focus");
  assert.ok(walkable(shore, "focus"));
  assert.ok(pondDistance(shore) >= FOCUS_ISLAND.bankRadius);
  assert.ok(shore.z < FOCUS_ISLAND.bankRadius + 0.2);
});
test("Simulation은 actor.island의 지형으로 키 이동·경로를 검사한다", () => {
  const sim = new Simulation();
  assert.ok(
    sim.applyAuthoritativeActor({
      ...sim.actor,
      island: "focus",
      ...FOCUS_SPAWN,
    }),
  );
  sim.keys.add("w");
  for (let i = 0; i < 400; i++) sim.step(1 / 30, 0, i * 33);
  assert.ok(walkable(sim.actor, "focus"));
  assert.ok(pondDistance(sim.actor) >= FOCUS_ISLAND.bankRadius);
  sim.stop();
  // 일반 섬 좌표 기준이면 갈 수 있는 연못 중앙도 낚시섬에서는 경로가 없다.
  assert.equal(sim.moveTo(FOCUS_POND), false);
  assert.ok(sim.moveTo({ x: 15.5, z: 4 }));
  assert.equal(sim.action("fish"), false, "부두 낚시는 일반 섬에서만");
  for (let i = 0; i < 2000 && sim.path.length; i++) {
    sim.step(1 / 30, 0, i * 33);
    assert.ok(walkable(sim.actor, "focus"));
  }
  assert.ok(Math.hypot(sim.actor.x - 15.5, sim.actor.z - 4) < 0.09);
});
test("낚시 명령은 걷기 뒤 부두에서 낚시로 전환된다", () => {
  const sim = new Simulation();
  sim.action("fish");
  for (let i = 0; i < 900; i++) {
    sim.step(1 / 60, 0, (i * 1000) / 60);
    if (sim.actor.action === "fish")
      assert.ok(
        Math.hypot(sim.actor.x - DOCK.x, sim.actor.z - DOCK.z) < 0.09,
        "부두 도착 전에는 낚시를 시작하지 않는다",
      );
  }
  assert.equal(sim.actor.action, "fish");
  assert.ok(Math.hypot(sim.actor.x - DOCK.x, sim.actor.z - DOCK.z) < 0.09);
  sim.keys.add("w");
  sim.step(1 / 60, 0, 16000);
  assert.equal(sim.actor.action, "walk");
});
test("대각선 속도·프레임 중단·메뉴·입력 해제를 일관되게 처리한다", () => {
  const straight = new Simulation(),
    diagonal = new Simulation();
  straight.keys.add("s");
  diagonal.keys.add("s");
  diagonal.keys.add("d");
  straight.step(0.05, 0, 0);
  diagonal.step(0.05, 0, 0);
  assert.ok(
    Math.abs(
      Math.hypot(diagonal.actor.x - SPAWN.x, diagonal.actor.z - SPAWN.z) -
        (straight.actor.z - SPAWN.z),
    ) < 0.001,
  );
  const sim = new Simulation();
  sim.keys.add("w");
  sim.step(10, 0, 0);
  assert.ok(Math.hypot(sim.actor.x, sim.actor.z - SPAWN.z) <= 0.161);
  sim.blocked = true;
  const old = { ...sim.actor };
  sim.step(0.05, 0, 0);
  assert.deepEqual(sim.actor, old);
  sim.stop();
  assert.equal(sim.keys.size, 0);
  assert.equal(sim.path.length, 0);
  assert.equal(sim.actor.action, "idle");
});
test("인사가 끝나면 대기로 돌아오고 쉬기는 유지한다", () => {
  const sim = new Simulation();
  sim.action("wave");
  sim.step(0.01, 0, sim.emoteUntil + 1);
  assert.equal(sim.actor.action, "idle");
  sim.action("sit");
  sim.step(0.01, 0, Infinity);
  assert.equal(sim.actor.action, "sit");
});
test("잘못된 실시간 위치·섬·이름·행동·털색을 받지 않는다", () => {
  const actor = createActor();
  assert.ok(validActor(actor));
  assert.equal(actor.island, "home");
  for (const patch of [
    { x: 1e6 },
    { z: Infinity },
    { name: "" },
    { name: "   " },
    { name: "x".repeat(17) },
    { name: 7 },
    { action: "hack" },
    { color: "red" },
    { yaw: NaN },
    { yaw: 1000 },
    { island: "moon" },
    { island: undefined },
    // 일반 섬에서 걸을 수 있는 (0, 5)도 낚시섬에서는 연못 안이다.
    { island: "focus", x: 0, z: 5 },
  ])
    assert.equal(
      validActor({ ...actor, ...patch }),
      false,
      JSON.stringify(patch),
    );
  assert.ok(validActor({ ...actor, island: "focus", ...FOCUS_SPAWN }));
});
test("부두 가장자리에서 반올림 격자가 바다여도 다시 걸어 나온다", () => {
  const start = { x: 1.49, z: 25.2 };
  assert.ok(walkable(start));
  const path = pathTo(start, SPAWN);
  assert.ok(path.length > 0);
  let previous = start;
  for (const p of path) {
    const safe = moveSafe(previous, p);
    assert.ok(Math.hypot(safe.x - p.x, safe.z - p.z) < 0.001);
    previous = p;
  }
});
