import test from "node:test";
import assert from "node:assert/strict";
import {
  FOCUS_BRIDGES,
  FOCUS_PLUNGE,
  FOCUS_STREAM,
  FOCUS_STREAM_Z0,
  FOCUS_STREAM_Z1,
  focusStreamX,
  type FocusBridge,
} from "../src/focus-water";
import { FOCUS_SEATS, FOCUS_ISLAND } from "../src/layout";
import {
  FOCUS_SPAWN,
  inFocusWater,
  moveSafe,
  onFocusBridge,
  pathTo,
  restSpot,
  seatExit,
  walkable,
  type Point,
} from "../src/world";
import { Simulation } from "../src/simulation";
// 렌더 쪽 값은 검사에서만 읽는다. world.ts·server는 그래픽 파일을 가져오지 않는다.
import * as pond from "../src/assets3d/pond";
import { focusHeight } from "../src/assets3d/focusTerrain";
import { GROUND_Y } from "../src/assets3d/palette";

const BODY = 0.25;
const halfWater = FOCUS_STREAM.width / 2;
const onDeck = (q: Point, b: FocusBridge) =>
  Math.abs(q.z - b.z) <= b.width / 2 + 1e-9 &&
  Math.abs(q.x - focusStreamX(b.z)) <= b.length / 2 + 1e-9;
// 렌더와 같은 기준의 수면: 물길은 중심선까지의 가로 거리(streamCut과 같다), 소는 반경.
const water = (q: Point) =>
  Math.hypot(q.x - FOCUS_PLUNGE.x, q.z - FOCUS_PLUNGE.z) <
    FOCUS_PLUNGE.radius - 1e-3 ||
  (q.z >= FOCUS_STREAM_Z0 &&
    q.z <= FOCUS_STREAM_Z1 &&
    Math.abs(q.x - focusStreamX(q.z)) < halfWater - 1e-3);
// 몸 둘레 n점과 중심이 물에 닿지 않는다. 다리 판자 위는 물 위가 아니다.
function bodyDry(p: Point, n = 32) {
  for (let i = 0; i <= n; i++) {
    const r = i === n ? 0 : BODY;
    const q = {
      x: p.x + Math.sin((i / n) * Math.PI * 2) * r,
      z: p.z + Math.cos((i / n) * Math.PI * 2) * r,
    };
    if (water(q) && !FOCUS_BRIDGES.some((b) => onDeck(q, b))) return false;
  }
  return true;
}
// 경로를 5cm마다 다시 걷는다. 물길 중심선을 넘는 순간은 반드시 다리 위여야 한다.
function walkPath(start: Point, path: Point[]) {
  assert.ok(path.length > 0, "경로가 있어야 한다");
  let at = start,
    length = 0;
  const crossings: Point[] = [];
  for (const p of path) {
    const reached = moveSafe(at, p, "focus");
    assert.ok(Math.hypot(reached.x - p.x, reached.z - p.z) < 0.01);
    const steps = Math.ceil(Math.hypot(p.x - at.x, p.z - at.z) / 0.05);
    let prev = at;
    for (let i = 1; i <= steps; i++) {
      const q = {
        x: at.x + ((p.x - at.x) * i) / steps,
        z: at.z + ((p.z - at.z) * i) / steps,
      };
      assert.ok(walkable(q, "focus"), `걷지 못하는 점 ${q.x},${q.z}`);
      assert.ok(bodyDry(q), `물 위 ${q.x},${q.z}`);
      if (
        q.z >= FOCUS_STREAM_Z0 &&
        q.z <= FOCUS_STREAM_Z1 &&
        Math.sign(q.x - focusStreamX(q.z)) !==
          Math.sign(prev.x - focusStreamX(prev.z))
      ) {
        assert.ok(onFocusBridge(q), `다리 밖에서 물길을 건넜다 ${q.x},${q.z}`);
        crossings.push(q);
      }
      prev = q;
    }
    length += Math.hypot(p.x - at.x, p.z - at.z);
    at = p;
  }
  return { length, crossings };
}

test("소·물길 배치는 렌더(pond.ts)와 이동 판정이 같은 값 하나를 쓴다", () => {
  assert.equal(pond.streamX, focusStreamX);
  assert.equal(pond.BRIDGES, FOCUS_BRIDGES);
  assert.equal(pond.STREAM_Z0, FOCUS_STREAM_Z0);
  assert.equal(pond.STREAM_Z1, FOCUS_STREAM_Z1);
  assert.equal(pond.STREAM.width, FOCUS_STREAM.width);
  assert.deepEqual(
    { x: pond.PLUNGE.x, z: pond.PLUNGE.z, radius: pond.PLUNGE.radius },
    FOCUS_PLUNGE,
  );
  // 브리프 수치 그대로다.
  assert.equal(FOCUS_STREAM.width, 0.62);
  assert.equal(FOCUS_STREAM_Z1, -10.25);
  assert.ok(Math.abs(FOCUS_STREAM_Z0 - -16.039) < 1e-9);
  assert.deepEqual(FOCUS_BRIDGES, [
    { z: -(FOCUS_ISLAND.bankRadius + 0.62), length: 1.5, width: 0.95 },
    { z: -14.55, length: 1.4, width: 0.85 },
  ]);
});

test("물길·소의 물 위에는 몸이 닿는 자리도 설 수 없고, 다리 판자 위에서만 건넌다", () => {
  // 연못 둑부터 소까지 물길 중심선 양쪽 0.54m 안은 다리 판자 폭 안쪽이 아니면 모두 막힌다.
  let bridged = 0;
  for (let z = FOCUS_STREAM_Z0; z <= -FOCUS_ISLAND.bankRadius; z += 0.05) {
    const cx = focusStreamX(z);
    const onBridge = FOCUS_BRIDGES.some(
      (b) => Math.abs(z - b.z) <= b.width / 2 - BODY,
    );
    if (onBridge) bridged++;
    for (const dx of [0, 0.15, -0.3, 0.45, -0.54]) {
      const p = { x: cx + dx, z };
      assert.equal(
        walkable(p, "focus"),
        onBridge,
        `z ${z.toFixed(2)} dx ${dx}`,
      );
      assert.equal(inFocusWater(p), !onBridge);
    }
  }
  assert.ok(bridged >= 2 * 6, "두 다리 모두 판자 폭 안쪽 띠가 있다");
  // 다리 위: 가운데와 판자 폭 안쪽(몸 반경만큼 여유)은 걷고, 그 밖의 물 위는 막는다.
  for (const b of FOCUS_BRIDGES) {
    const cx = focusStreamX(b.z);
    const inner = b.width / 2 - BODY;
    for (const dz of [0, inner - 0.005, -(inner - 0.005)])
      assert.ok(
        walkable({ x: cx, z: b.z + dz }, "focus"),
        `다리 ${b.z} dz ${dz}`,
      );
    for (const dz of [inner + 0.01, -(inner + 0.01), b.width / 2])
      assert.equal(walkable({ x: cx, z: b.z + dz }, "focus"), false);
  }
  // 소: 폭포 바위(랜드마크)와 따로 소 가장자리만으로 막히는 자리가 있다.
  assert.equal(walkable(FOCUS_PLUNGE, "focus"), false);
  assert.equal(walkable({ x: 0.75, z: -15.65 }, "focus"), false);
  assert.equal(inFocusWater({ x: 0.75, z: -15.65 }), true);
  assert.ok(walkable({ x: 0.9, z: -15.6 }, "focus"));
  // 일반 섬에는 물길이 없다.
  assert.ok(walkable({ x: focusStreamX(-13.6), z: -13.6 }, "home"));
});

test("낚시섬의 걸을 수 있는 0.2m 격자는 몸이 물에 닿지 않고, 지형이 땅보다 낮은 곳은 다리 위뿐이다", () => {
  let walkableCount = 0,
    bridgeLow = 0;
  for (let i = -110; i <= 110; i++)
    for (let k = -102; k <= 102; k++) {
      const p = { x: i * 0.2, z: k * 0.2 };
      if (!walkable(p, "focus")) continue;
      walkableCount++;
      assert.ok(bodyDry(p), `물 위 ${p.x},${p.z}`);
      const h = focusHeight(p.x, p.z);
      if (Math.abs(h - GROUND_Y) > 1e-6) {
        assert.ok(onFocusBridge(p), `땅이 아닌 곳 ${p.x},${p.z} 높이 ${h}`);
        bridgeLow++;
      }
    }
  assert.ok(walkableCount > 20000);
  // 두 다리 아래는 물길 홈이라 판자 위만 걷는다.
  assert.ok(bridgeLow > 0);
});

test("두 다리는 양쪽 어느 방향에서나 pathTo로 가장 가까운 다리를 건넌다", () => {
  const cases: { from: Point; to: Point; bridge: FocusBridge }[] = [];
  const [inner, outer] = FOCUS_BRIDGES;
  for (const [west, east] of [
    [
      { x: -1.1, z: -11.6 },
      { x: 1.1, z: -12.3 },
    ],
    [
      { x: -1.1, z: inner.z },
      { x: 1.1, z: inner.z },
    ],
    [
      { x: -1.1, z: -12.3 },
      { x: 1.1, z: -11.6 },
    ],
  ])
    cases.push(
      { from: west, to: east, bridge: inner },
      { from: east, to: west, bridge: inner },
    );
  for (const [west, east] of [
    [
      { x: -1.2, z: -14 },
      { x: 1.2, z: -15 },
    ],
    [
      { x: -1.2, z: outer.z },
      { x: 1.2, z: outer.z },
    ],
    [
      { x: -1.2, z: -15 },
      { x: 1.2, z: -14 },
    ],
  ])
    cases.push(
      { from: west, to: east, bridge: outer },
      { from: east, to: west, bridge: outer },
    );
  for (const { from, to, bridge } of cases) {
    assert.ok(walkable(from, "focus") && walkable(to, "focus"));
    const { length, crossings } = walkPath(from, pathTo(from, to, "focus"));
    assert.equal(crossings.length, 1);
    assert.ok(Math.abs(crossings[0].z - bridge.z) <= bridge.width / 2 - BODY);
    assert.ok(
      length < 4,
      `${bridge.z} 다리 대신 돌아갔다 (${length.toFixed(2)})`,
    );
  }
  // 물가 길에서 다리 판자 위 여러 곳으로 비스듬히 들어가도 5cm 간격의 어느 점도 물을 스치지 않는다.
  // (0, -11.9)는 15cm 간격 이동 검사가 다리 입구 모서리를 건너뛰던 실제 사례다.
  const decks: Point[] = [{ x: 0, z: -11.9 }];
  for (const b of FOCUS_BRIDGES) {
    const inner = b.width / 2 - BODY;
    for (const dz of [-0.9 * inner, 0, 0.9 * inner])
      for (const dx of [-0.3, 0, 0.3])
        decks.push({ x: focusStreamX(b.z) + dx, z: b.z + dz });
  }
  for (const deck of decks) {
    assert.ok(onFocusBridge(deck));
    // 물가 길 서쪽·동쪽(15cm 검사가 실패하던 경로의 꺾임점)과 의자 뒤 동쪽에서 출발한다.
    for (const from of [
      { x: -6, z: -12.5 },
      { x: 5.2, z: -10.4 },
      { x: 6, z: -15.5 },
    ]) {
      assert.ok(walkable(from, "focus"));
      walkPath(from, pathTo(from, deck, "focus"));
    }
  }
  // 다리 사이·소 앞의 물길은 직선으로 건널 수 없다.
  for (const z of [-15, -13.8, -11.6]) {
    const cx = focusStreamX(z);
    const start = { x: cx - 1, z };
    assert.ok(walkable(start, "focus"));
    const stop = moveSafe(start, { x: cx + 1, z }, "focus");
    assert.ok(stop.x <= cx - halfWater - BODY + 1e-9, `z ${z} 물에 들어감`);
    assert.ok(stop.x > cx - halfWater - BODY - 0.08, `z ${z} 너무 일찍 멈춤`);
  }
});

test("물길이 가장 비스듬한 곳에서도 걸을 수 있는 자리의 몸 둘레는 수면에 닿지 않는다", () => {
  // 중심선 기울기가 가장 큰 z(= -10.4 - π/1.05) 둘레를 1mm 간격으로 훑는다.
  const steepest = -10.4 - Math.PI / 1.05;
  let edge = 0;
  for (const z of [steepest - 0.05, steepest, steepest + 0.05]) {
    const cx = focusStreamX(z);
    for (const side of [-1, 1])
      for (let d = 0.5; d <= 0.6; d += 0.001) {
        const p = { x: cx + side * d, z };
        if (!walkable(p, "focus")) continue;
        edge++;
        assert.ok(bodyDry(p, 720), `물가 ${p.x.toFixed(4)},${z.toFixed(3)}`);
      }
  }
  assert.ok(edge > 100);
});

test("키보드로 걸어도 다리 위로는 건너고 다리 밖 물길 앞에서는 멈춘다", () => {
  const [, outer] = FOCUS_BRIDGES;
  const walkEast = (z: number) => {
    const sim = new Simulation();
    const start = { x: focusStreamX(z) - 1.2, z };
    assert.ok(
      sim.applyAuthoritativeActor({ ...sim.actor, island: "focus", ...start }),
    );
    sim.keys.add("d");
    for (let i = 0; i < 60; i++) {
      sim.step(1 / 30, 0, i * 33);
      assert.ok(walkable(sim.actor, "focus"));
      assert.ok(bodyDry(sim.actor));
    }
    return sim.actor;
  };
  const crossed = walkEast(outer.z);
  assert.ok(crossed.x > focusStreamX(outer.z) + outer.length / 2);
  const stopped = walkEast(-15);
  assert.ok(stopped.x < focusStreamX(-15) - halfWater - BODY + 0.01);
});

test("물길을 막아도 30석 출구·시작점·휴식 자리는 그대로이고 모두 시작점에서 걸어갈 수 있다", () => {
  assert.ok(walkable(FOCUS_SPAWN, "focus"));
  for (const seat of FOCUS_SEATS) {
    const exit = seatExit(seat.id);
    assert.ok(walkable(exit, "focus") && !inFocusWater(exit));
    assert.ok(Math.hypot(exit.x, exit.z) > FOCUS_ISLAND.seatRadius);
    walkPath(FOCUS_SPAWN, pathTo(FOCUS_SPAWN, exit, "focus"));
    const rest = restSpot(seat.id);
    assert.ok(walkable(rest, "home"));
  }
  // 물길 양쪽 북쪽 의자(14번·15번) 출구 사이는 다리 하나로 오간다.
  const east = seatExit(14),
    west = seatExit(15);
  assert.ok(east.x > focusStreamX(east.z) && west.x < focusStreamX(west.z));
  const { crossings, length } = walkPath(east, pathTo(east, west, "focus"));
  assert.equal(crossings.length, 1);
  assert.ok(length < 6);
});
