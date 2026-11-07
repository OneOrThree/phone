import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import {
  CATCH_LENGTH,
  FishingRhythm,
  MAX_FRAME_STEP,
  MY_FISHING,
  OTHERS_FISHING,
} from "../src/fishing-rhythm";
import {
  FOCUS_FRIENDS,
  FRIEND_FISHING_EVERY,
  IslandCompanions,
} from "../src/companion-motion";
import {
  CAPACITY,
  FOCUS_ISLAND,
  FOCUS_ISLET,
  FOCUS_POND,
  FOCUS_SEATS,
  FRIEND_SEATS,
  castSpot,
} from "../src/layout";
import { pathTo, seatExit, walkable, FOCUS_SPAWN } from "../src/world";
// 렌더 쪽 값은 검사에서만 읽는다.
import { BONE, createCatRig, ROD_TIP_LOCAL } from "../src/assets3d/catModel";
import {
  BUCKET_DROP,
  BUCKET_RIM,
  CATCH_SECONDS,
  CATCH_STEPS,
  catchCurves,
  catchStep,
  FISH_SIZE,
  placeFloat,
  poseBones,
  type PoseWeights,
} from "../src/assets3d/catPose";
import { focusHeight } from "../src/assets3d/focusTerrain";
import { GROUND_Y, POND_LEVEL } from "../src/assets3d/palette";
import {
  FRIEND_FLOATS,
  inFriendLane,
  ISLET_SHORE,
  POND_DECOR,
} from "../src/assets3d/pond";

const FRAME = 1 / 60;
// 앉은 고양이를 seconds초 동안 돌려 어획 구간(시작 시각, 끝 시각)을 모은다.
function catches(
  rhythm: FishingRhythm,
  seconds: number,
  seat: number | null = 3,
  dt = FRAME,
) {
  const spans: [number, number][] = [];
  let at = 0,
    open = -1,
    last = -1;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    at += dt;
    const e = rhythm.step(dt, seat, false);
    if (e >= 0) {
      assert.ok(e < CATCH_LENGTH);
      if (open < 0 || e < last) {
        if (open >= 0) spans.push([open, at - dt]);
        open = at;
      }
    } else if (open >= 0) {
      spans.push([open, at - dt]);
      open = -1;
    }
    last = e;
  }
  if (open >= 0) spans.push([open, at]);
  return spans;
}

test("어획 장면 길이는 박자와 자세가 같은 값을 쓴다", () => {
  assert.equal(CATCH_LENGTH, CATCH_SECONDS);
  assert.equal(catchStep(-1), null);
  assert.equal(catchStep(CATCH_SECONDS), null);
  assert.equal(catchStep(0), "bite");
  assert.equal(catchStep(CATCH_STEPS.show + 0.1), "show");
  assert.equal(catchStep(CATCH_SECONDS - 0.01), "land");
});

test("내 고양이는 앉은 지 7초에 첫 물고기를 낚고 이후 20~35초마다 낚는다", () => {
  const rhythm = new FishingRhythm(MY_FISHING, () => 0.5);
  const spans = catches(rhythm, 200);
  assert.ok(Math.abs(spans[0][0] - 7) < 0.05, `첫 입질 ${spans[0][0]}`);
  for (const [start, end] of spans.slice(0, -1))
    assert.ok(Math.abs(end - start - CATCH_LENGTH) < 0.05);
  for (let i = 1; i < spans.length; i++) {
    const gap = spans[i][0] - spans[i - 1][1];
    assert.ok(gap >= 20 - 0.05 && gap <= 35 + 0.05, `간격 ${gap}`);
  }
  assert.ok(spans.length >= 5);
});

test("일어서거나 자리를 바꾸면 물고기를 바로 거두고 새 자리에서 다시 기다린다", () => {
  const rhythm = new FishingRhythm(MY_FISHING, () => 0.5);
  let e = -1;
  for (let i = 0; i < 60 * 10; i++) e = rhythm.step(FRAME, 3, false);
  assert.ok(e > 2.5, "10초째에는 물고기를 들고 있다");
  // 휴식·퇴석·섬 이동: 같은 프레임에 연출이 끝난다.
  assert.equal(rhythm.step(FRAME, null, false), -1);
  assert.equal(rhythm.untilNext, Infinity);
  // 다시 앉으면 처음부터 7초를 기다린다.
  assert.equal(rhythm.step(FRAME, 3, false), -1);
  assert.ok(Math.abs(rhythm.untilNext - 7 + FRAME) < 1e-6);
  for (let i = 0; i < 60 * 5; i++) rhythm.step(FRAME, 3, false);
  // 자리 바꾸기도 새로 앉은 것으로 본다.
  assert.equal(rhythm.step(FRAME, 8, false), -1);
  assert.ok(rhythm.untilNext > 6.9);
});

test("동작 줄이기에서는 낚지 않고 시간도 흐르지 않는다", () => {
  const rhythm = new FishingRhythm(MY_FISHING, () => 0.5);
  for (let i = 0; i < 60 * 9; i++) rhythm.step(FRAME, 0, false);
  assert.ok(rhythm.step(FRAME, 0, false) >= 0);
  // 낚는 중에 켜면 즉시 멈추고, 켜 둔 동안은 계속 -1이다.
  for (let i = 0; i < 60 * 120; i++)
    assert.equal(rhythm.step(FRAME, 0, true), -1);
  // 끄면 몇 초 기다렸다가 처음부터 다시 낚는다.
  assert.ok(rhythm.untilNext > 3.9 && rhythm.untilNext <= 4);
  const spans = catches(rhythm, 12, 0);
  assert.ok(spans.length === 1 && Math.abs(spans[0][0] - 4) < 0.05);
});

test("숨긴 탭에서 돌아온 큰 프레임 간격은 0.1초씩만 진행해 순간이동·연속 어획이 없다", () => {
  const rhythm = new FishingRhythm(MY_FISHING, () => 0.5);
  // 6.95초 앉아 있다가 탭이 10분 숨겨진 뒤 돌아온 첫 프레임
  for (let i = 0; i < 139; i++) rhythm.step(0.05, 1, false);
  let e = rhythm.step(600, 1, false);
  assert.ok(e >= 0 && e <= MAX_FRAME_STEP + 1e-9, `복귀 프레임 ${e}`);
  let previous = e;
  for (let i = 0; i < 40; i++) {
    e = rhythm.step(600, 1, false);
    assert.ok(e - previous <= MAX_FRAME_STEP + 1e-9);
    previous = e;
  }
  // 이상한 delta도 시간을 거꾸로 돌리거나 멈춘 박자를 깨지 않는다.
  assert.ok(rhythm.step(Number.NaN, 1, false) >= previous);
  assert.ok(rhythm.step(-5, 1, false) >= previous);
});

test("이미 앉아 있던 다른 고양이는 첫 어획을 2~30초에 흩고, 앉는 모습을 보면 6~10초 뒤 낚는다", () => {
  let seed = 0;
  const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const firsts: number[] = [];
  for (let i = 0; i < 40; i++) {
    const rhythm = new FishingRhythm(OTHERS_FISHING, random, true);
    rhythm.step(0, 5, false);
    firsts.push(rhythm.untilNext);
    // 일어섰다 다시 앉으면 6~10초
    rhythm.step(0, null, false);
    rhythm.step(0, 5, false);
    assert.ok(rhythm.untilNext >= 6 && rhythm.untilNext <= 10);
  }
  assert.ok(firsts.every((s) => s >= 2 && s <= 30));
  assert.ok(Math.max(...firsts) - Math.min(...firsts) > 15, "고르게 퍼진다");
});

test("집중 친구는 섬에 들어서고 2.5초 뒤부터 33초 박자를 어긋나게 낚아 서로 겹치지 않는다", () => {
  const { sitters } = new IslandCompanions("focus");
  const all = sitters.map(({ fishing }) => catches(fishing, 400, -1));
  all.forEach((spans, i) => {
    assert.ok(Math.abs(spans[0][0] - (2.5 + i * 11)) < 0.05);
    for (let k = 1; k < spans.length; k++) {
      const every = spans[k][0] - spans[k - 1][0];
      assert.ok(Math.abs(every - FRIEND_FISHING_EVERY) < 0.05);
    }
  });
  const flat = all.flat().sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < flat.length; k++)
    assert.ok(flat[k][0] >= flat[k - 1][1] + 1, "두 친구가 함께 낚지 않는다");
});

test("집중 친구 셋은 이름·털색이 산책 친구와 겹치지 않고 서버 좌석이 없다", () => {
  const home = new IslandCompanions("home");
  assert.equal(home.sitters.length, 0);
  const focus = new IslandCompanions("focus");
  assert.equal(focus.sitters.length, FOCUS_FRIENDS.length);
  const everyone = [...focus.actors, ...focus.sitters.map((s) => s.actor)];
  assert.equal(new Set(everyone.map((a) => a.name)).size, everyone.length);
  assert.equal(new Set(everyone.map((a) => a.color)).size, everyone.length);
  assert.ok(everyone.every((a) => !a.name.includes("봇")));
  focus.sitters.forEach(({ actor }, i) => {
    assert.equal(actor.action, "focus");
    assert.equal(actor.seatId, undefined);
    assert.equal(actor.x, FRIEND_SEATS[i].x);
    assert.equal(actor.yaw, FRIEND_SEATS[i].yaw);
  });
  const before = focus.sitters.map(({ actor }) => ({ ...actor }));
  for (let i = 0; i < 600; i++) {
    focus.step(0.05, focus.sitters[0].actor, i % 2 === 0);
  }
  assert.deepEqual(
    focus.sitters.map(({ actor }) => actor),
    before,
    "가까이 가도·동작 줄이기에도 의자에서 움직이지 않는다",
  );
});

test("집중 친구 자리는 연못 가운데 작은 섬의 평평한 꼭대기라 사용자 의자·길·출구와 겹치지 않는다", () => {
  assert.equal(FOCUS_SEATS.length, CAPACITY);
  // 의자 다리·양동이·앉은 발이 놓이는 범위가 모두 땅 높이로 평평하다.
  for (const seat of FRIEND_SEATS) {
    const right = { x: Math.cos(seat.yaw), z: -Math.sin(seat.yaw) },
      ahead = { x: Math.sin(seat.yaw), z: Math.cos(seat.yaw) };
    for (const [lx, lz] of [
      [-0.4, -0.37],
      [0.75, -0.37],
      [-0.4, 0.6],
      [0.75, 0.6],
      [0.6, 0.12],
    ]) {
      const x = seat.x + right.x * lx + ahead.x * lz,
        z = seat.z + right.z * lx + ahead.z * lz;
      assert.ok(Math.abs(focusHeight(x, z) - GROUND_Y) < 1e-6);
    }
    // 연못 물 한가운데라 사람이 걸어 들어갈 수 없고 물가 길·의자와 멀다.
    assert.ok(!walkable(seat, "focus"));
    assert.ok(Math.hypot(seat.x - FOCUS_ISLET.x, seat.z - FOCUS_ISLET.z) < 1);
    for (const user of FOCUS_SEATS) {
      assert.ok(Math.hypot(user.x - seat.x, user.z - seat.z) > 11);
      const exit = seatExit(user.id);
      assert.ok(walkable(exit, "focus"));
      assert.ok(Math.hypot(exit.x - seat.x, exit.z - seat.z) > 12);
    }
  }
  // 작은 섬은 물가 길(걷는 곳 반경 11.4)보다 한참 안쪽이다.
  assert.ok(ISLET_SHORE > 2 && ISLET_SHORE < FOCUS_ISLAND.bankRadius - 8);
  // 30석 모두 자리에서 출구·부두 쪽 시작점까지 길이 그대로 있다.
  for (const user of FOCUS_SEATS)
    assert.ok(pathTo(FOCUS_SPAWN, seatExit(user.id), "focus").length > 0);
});

test("집중 친구의 찌는 연못 수면 깊은 곳에 떨어지고 사용자 찌·수련·갈대와 떨어져 있다", () => {
  const userFloats = FOCUS_SEATS.map(castSpot);
  FRIEND_FLOATS.forEach((f) => {
    const r = Math.hypot(f.x - FOCUS_POND.x, f.z - FOCUS_POND.z);
    assert.ok(r > ISLET_SHORE + 1.5 && r < FOCUS_POND.radius - 4);
    assert.ok(POND_LEVEL - focusHeight(f.x, f.z) > 0.5, "찌 아래 물이 깊다");
    for (const u of userFloats)
      assert.ok(Math.hypot(u.x - f.x, u.z - f.z) > 4.5);
    for (const lily of POND_DECOR.lilies)
      assert.ok(Math.hypot(lily.x - f.x, lily.z - f.z) - lily.s > 0.6);
  });
  for (const lily of POND_DECOR.lilies) {
    assert.ok(!inFriendLane(lily.x, lily.z, 0.6));
    assert.ok(Math.hypot(lily.x, lily.z) > ISLET_SHORE + 0.5);
  }
  for (const reed of POND_DECOR.reeds)
    assert.ok(!inFriendLane(reed.x, reed.z, 0.5));
});

// ---- 자세: 실제 skinned 정점으로 물고기·찌·몸·의자 위치를 확인한다 ----
const rig = createCatRig("cream", false);
const group = new Group();
group.add(rig.mesh);
const skin = rig.mesh.geometry.getAttribute("skinIndex");
const weight = rig.mesh.geometry.getAttribute("skinWeight");
const count = rig.mesh.geometry.getAttribute("position").count;
const boneOf = (i: number) => {
  let best = 0,
    bone = 0;
  for (let k = 0; k < 4; k++)
    if (weight.getComponent(i, k) > best) {
      best = weight.getComponent(i, k);
      bone = skin.getComponent(i, k);
    }
  return bone;
};
const FISH_BONES: number[] = [BONE.fish, BONE.fishTail];
const PROP_BONES: number[] = [BONE.rod, BONE.float, BONE.ripple, ...FISH_BONES];
const fishVerts: number[] = [],
  bodyVerts: number[] = [];
for (let i = 0; i < count; i++) {
  const bone = boneOf(i);
  // 목줄 정점(찌에 반쯤 묶임)은 물고기 몸으로 보지 않는다.
  if (FISH_BONES.includes(bone) && weight.getComponent(i, 0) === 1)
    fishVerts.push(i);
  else if (!PROP_BONES.includes(bone)) bodyVerts.push(i);
}
const v = new Vector3();
function pose(
  seat: { x: number; z: number; yaw: number },
  e: number,
  live = 1,
) {
  const m: PoseWeights = {
    phase: 0,
    walk: 0,
    sit: 0,
    wave: 0,
    fish: 0,
    focus: 1,
    catch: e,
  };
  group.position.set(seat.x, GROUND_Y, seat.z);
  group.rotation.set(0, seat.yaw, 0);
  group.updateMatrixWorld(true);
  poseBones(rig.bones, m, 12.3, live, 1);
  placeFloat(rig.bones, m, 12.3, live);
  group.updateMatrixWorld(true);
  rig.mesh.skeleton.update();
}
const world = (i: number) =>
  rig.mesh.getVertexPosition(i, v).applyMatrix4(rig.mesh.matrixWorld).clone();
const boneWorld = (bone: number) =>
  new Vector3().setFromMatrixPosition(rig.bones[bone].matrixWorld);
const fishScale = () => rig.bones[BONE.fish].scale.x;
const SEATS = [
  FOCUS_SEATS[0],
  FOCUS_SEATS[13],
  FOCUS_SEATS[22],
  ...FRIEND_SEATS,
];
const timeline = Array.from({ length: 141 }, (_, i) => i * 0.05);

test("어획은 대기 자세에서 시작해 대기 자세로 끝나고 동작 줄이기에서는 움직이지 않는다", () => {
  const snap = () =>
    rig.bones.map((b) => [
      ...b.position.toArray(),
      ...b.rotation.toArray().slice(0, 3),
      b.scale.x,
    ]) as number[][];
  const close = (a: number[][], b: number[][], tol: number) =>
    a.every((row, i) => row.every((n, k) => Math.abs(n - b[i][k]) < tol));
  pose(FOCUS_SEATS[0], -1);
  const idle = snap();
  pose(FOCUS_SEATS[0], 0);
  assert.ok(close(snap(), idle, 1e-6), "시작 프레임은 대기 자세");
  pose(FOCUS_SEATS[0], CATCH_SECONDS - 1e-4);
  assert.ok(close(snap(), idle, 2e-3), "끝 프레임은 대기 자세");
  pose(FOCUS_SEATS[0], -1, 0);
  const still = snap();
  for (const e of [1, 3, 5]) {
    pose(FOCUS_SEATS[0], e, 0);
    assert.ok(close(snap(), still, 1e-9));
  }
  assert.equal(catchCurves(undefined).fish, 0);
  // 연속성: 50ms마다 찌가 순간이동하지 않는다(던질 때가 가장 빠르다).
  let previous = boneWorld(BONE.float);
  for (const e of timeline.slice(1)) {
    pose(FOCUS_SEATS[0], Math.min(e, CATCH_SECONDS - 1e-4));
    const now = boneWorld(BONE.float);
    assert.ok(now.distanceTo(previous) < 0.75, `찌 이동 ${e}`);
    previous = now;
  }
});

test("물고기는 물에서 올라와 물 위·고양이 앞에 보이고, 몸·의자·땅을 뚫지 않고 양동이에 들어간다", () => {
  for (const seat of SEATS) {
    let shown = 0;
    for (const e of timeline) {
      pose(seat, e);
      const scale = fishScale();
      if (scale < 0.05) continue;
      const fish = fishVerts.map(world);
      const step = catchStep(e);
      if (step === "show") {
        shown++;
        assert.equal(scale, FISH_SIZE);
        // 구경할 때는 물 밖 공중, 고양이 머리 옆(양동이 쪽)·앞쪽 어깨 높이에 매달려 있다.
        assert.ok(fish.every((p) => p.y > GROUND_Y + 0.9));
        const mouth = group.worldToLocal(boneWorld(BONE.fish));
        assert.ok(mouth.x > 0.7 && mouth.z > 0.5, "머리 옆 앞");
      }
      // 물 위로 나온 물고기는 땅·물가 비탈 위에 있다(물속에서 올라오는 동안은 물이 가린다).
      for (const p of fish)
        if (p.y > POND_LEVEL + 0.02)
          assert.ok(p.y > focusHeight(p.x, p.z) - 1e-3, `땅 뚫음 ${e}`);
      // 고양이 몸과 떨어져 있다(물고기 둘레 구 안의 몸 정점만 거리를 잰다).
      const center = fish
        .reduce((sum, p) => sum.add(p), new Vector3())
        .divideScalar(fish.length);
      const radius = Math.max(...fish.map((p) => p.distanceTo(center)));
      let gap = Infinity;
      for (const i of bodyVerts) {
        const b = world(i);
        if (b.distanceTo(center) > radius + 0.15) continue;
        for (const f of fish) gap = Math.min(gap, f.distanceTo(b));
      }
      assert.ok(gap > 0.08, `몸과 ${gap.toFixed(3)} (${e}s)`);
      // 의자 좌판·등받이 안에 들어가지 않는다(의자 기준 좌표, 원점은 의자 아래 땅).
      for (const p of fish) {
        const local = group.worldToLocal(p.clone());
        const inSeat =
          Math.abs(local.x) < 0.41 &&
          Math.abs(local.z) < 0.37 &&
          local.y > 0.3 &&
          local.y < 1.05;
        assert.ok(!inSeat, `의자와 겹침 ${e}`);
      }
    }
    assert.ok(shown >= 20, "1초 넘게 물고기를 구경한다");
    // 양동이에 넣는 끝에는 물고기 입이 양동이 테두리 높이에서 사라진다.
    pose(seat, CATCH_STEPS.cast - 1e-3);
    const mouth = group.worldToLocal(boneWorld(BONE.fish));
    assert.ok(fishScale() < 0.01);
    assert.ok(
      Math.hypot(mouth.x - BUCKET_DROP.x, mouth.z - BUCKET_DROP.z) < 0.02,
    );
    assert.ok(Math.abs(mouth.y - BUCKET_RIM) < 0.02);
    // 끝나면 물고기는 숨고 찌는 원래 수면 자리로 돌아온다.
    pose(seat, -1);
    const rest = boneWorld(BONE.float);
    pose(seat, CATCH_STEPS.land + 0.3);
    assert.ok(boneWorld(BONE.float).distanceTo(rest) < 0.02);
    assert.ok(fishScale() < 0.01);
  }
});

test("낚싯대·줄은 들어 올릴 때도 이웃 친구와 닿지 않는다", () => {
  // 작은 섬 세 친구가 동시에 낚는 일은 없지만, 한 친구가 낚는 동안 이웃의 대기 몸과 거리를 본다.
  for (let i = 0; i < FRIEND_SEATS.length; i++) {
    const others: Vector3[] = [];
    for (let j = 0; j < FRIEND_SEATS.length; j++) {
      if (j === i) continue;
      pose(FRIEND_SEATS[j], -1);
      others.push(...bodyVerts.filter((_, k) => k % 3 === 0).map(world));
    }
    for (const e of timeline.filter((_, k) => k % 4 === 0)) {
      pose(FRIEND_SEATS[i], e);
      const tip = ROD_TIP_LOCAL.clone().applyMatrix4(
        rig.bones[BONE.rod].matrixWorld,
      );
      const float = boneWorld(BONE.float);
      for (const p of others)
        for (let s = 0; s <= 10; s++) {
          const q = tip.clone().lerp(float, s / 10);
          assert.ok(q.distanceTo(p) > 0.2, `줄과 이웃 ${e}`);
        }
      if (fishScale() > 0.05)
        for (const f of fishVerts.filter((_, k) => k % 4 === 0).map(world))
          for (const p of others) assert.ok(f.distanceTo(p) > 0.3);
    }
  }
});
