import { Vector3, type Bone } from "three";
import { CHAIR_CAST } from "../layout";
import { BONE, BONE_REST, FISH, ROD_TIP_LOCAL } from "./catModel";
import { GROUND_Y, POND_LEVEL, SEA_LEVEL, SEAT_HEIGHT } from "./palette";

// 고양이 자세. Cat.tsx의 useFrame과 수치 검증 스크립트가 같은 함수를 쓴다.
// 프레임마다 뼈 회전·위치만 바꾸고 React 상태는 건드리지 않는다.
export type PoseWeights = {
  phase: number;
  walk: number;
  sit: number;
  wave: number;
  fish: number;
  focus: number;
  // 의자 낚시에서 물고기를 낚는 중이면 시작부터 지난 초(0 ≤ catch < CATCH_SECONDS), 아니면 -1·생략.
  catch?: number;
};
export const POSES = ["walk", "sit", "wave", "fish", "focus"] as const;

// 의자에 앉을 때 몸통 바닥(모델 0.19)을 쿠션 윗면(SEAT_HEIGHT)에 살짝 묻는다.
export const SEAT_RAISE = SEAT_HEIGHT - 0.21;
// 의자 낚시: 낚싯대를 48°쯤 세우고, 찌는 의자 앞 3.5m 수면에 둔다.
// 의자 반경 13.2에서 3.5m 앞은 연못 중심에서 9.7m(연못 반경 10.5 안쪽 0.8m)다.
export const FOCUS_CAST = {
  rodLift: 0.32,
  // x는 낚싯대 끝(로컬 x ≈ -0.03)과 맞춰 줄이 옆으로 기울지 않게 한다.
  float: new Vector3(-0.02, POND_LEVEL - GROUND_Y, CHAIR_CAST),
} as const;
// 부두 낚시: 낚싯대 끝 바로 앞 바다 수면
export const DOCK_FLOAT_Y = SEA_LEVEL - GROUND_Y + 0.02;

// 의자 낚시에서 물고기 한 마리를 낚는 장면(초). 입질 → 챔질 → 끌어올리기 → 구경 →
// 양동이로 거두기 → 넣기 → 다시 던지기. 모두 7초이고 끝나면 대기 자세와 정확히 같아진다.
export const CATCH_STEPS = {
  bite: 0,
  strike: 1.7,
  lift: 2.15,
  show: 3.25,
  swing: 4.35,
  drop: 5.35,
  cast: 5.8,
  land: 6.65,
} as const;
// 다시 던지기 전에 낚싯대를 뒤로 젖히는 끝 시각
const WINDUP = 6.1;
export const CATCH_SECONDS = 7;
export type CatchStep = keyof typeof CATCH_STEPS;
export function catchStep(e: number): CatchStep | null {
  if (!(e >= 0 && e < CATCH_SECONDS)) return null;
  let step: CatchStep = "bite";
  for (const [name, at] of Object.entries(CATCH_STEPS) as [CatchStep, number][])
    if (e >= at) step = name;
  return step;
}
// 낚아 올린 물고기 크기(모델 치수 FISH의 배율)와 입에서 꼬리 끝까지 길이
export const FISH_SIZE = 1.2;
const FISH_REACH = (FISH.body - 0.02 + FISH.tail) * FISH_SIZE;
// 의자 오른쪽(+x) 미끼 양동이(chair.ts, 테두리 높이 0.24m). 찌가 이 높이면 꼬리 끝이 테두리 바로 위다.
export const BUCKET_RIM = 0.24;
export const BUCKET_DROP = new Vector3(
  0.6,
  BUCKET_RIM + FISH_REACH + FISH.leader + 0.03,
  0.12,
);
// 양동이에 넣을 때 찌가 내려가는 거리: 물고기 입이 테두리 높이에 닿는다.
const DROP_DEPTH = BUCKET_DROP.y - FISH.leader - BUCKET_RIM;
// 끌어올린 물고기가 매달리는 높이: 낚싯대 끝에서 이만큼 아래
const DANGLE = 0.65;
// 구경할 때 양동이 쪽으로 돌린 정도(낚싯대 끝이 고양이 옆 약 0.9m)
const SHOW_SWING = 0.72;

const bump = (phase: number, width: number) =>
  phase < width ? Math.sin((phase / width) * Math.PI) : 0;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const span = (e: number, a: number, b: number) => ease((e - a) / (b - a));
const pulse = (x: number) => (x > 0 && x < 1 ? Math.sin(x * Math.PI) : 0);

// 어획 곡선. 값은 모두 0(대기)에서 시작해 0으로 끝난다. 한 객체를 재사용해 프레임마다 만들지 않는다.
export type CatchCurves = {
  active: boolean;
  dip: number; // 입질에 찌가 잠기는 정도
  perk: number; // 귀·눈이 커지는 놀람
  raise: number; // 낚싯대를 더 세우는 정도(음수면 앞으로 던짐)
  swing: number; // 양동이(+x) 쪽으로 몸과 낚싯대를 돌린 정도
  lean: number; // 당기며 몸을 뒤로 젖힘
  look: number; // 물고기를 올려다봄
  tilt: number; // 구경할 때 고개 갸웃
  fish: number; // 물고기 크기(0이면 숨김)
  wiggle: number; // 물고기 파닥임 세기
  ripple: number; // 수면 물결 고리 크기(대기 1)
};
const curves: CatchCurves = {
  active: false,
  dip: 0,
  perk: 0,
  raise: 0,
  swing: 0,
  lean: 0,
  look: 0,
  tilt: 0,
  fish: 0,
  wiggle: 0,
  ripple: 1,
};
export function catchCurves(e: number | undefined): CatchCurves {
  const c = curves;
  const s = CATCH_STEPS;
  c.active = e !== undefined && e >= 0 && e < CATCH_SECONDS;
  if (!c.active || e === undefined) {
    c.dip = c.perk = c.raise = c.swing = c.lean = c.look = c.tilt = 0;
    c.fish = c.wiggle = 0;
    c.ripple = 1;
    return c;
  }
  c.dip =
    0.45 * pulse((e - 0.3) / 0.22) +
    0.75 * pulse((e - 0.78) / 0.22) +
    pulse((e - 1.22) / 0.32);
  c.perk = span(e, 0.25, 0.55) * (1 - span(e, 4.6, 5.4));
  if (e < s.strike) c.raise = 0.08 * c.dip;
  else if (e < s.lift) {
    const k = clamp01((e - s.strike) / (s.lift - s.strike));
    c.raise = 1 - (1 - k) * (1 - k);
  } else if (e < s.swing) c.raise = 1 - 0.2 * span(e, s.lift, s.show);
  else if (e < s.cast) c.raise = 0.8 - 0.25 * span(e, s.swing, s.drop);
  else if (e < WINDUP) c.raise = 0.55 + 0.55 * span(e, s.cast, WINDUP);
  else if (e < s.land) c.raise = 1.1 - 1.22 * span(e, WINDUP, s.land);
  else c.raise = -0.12 * (1 - span(e, s.land, CATCH_SECONDS));
  // 끌어올리며 양동이 쪽(+x)으로 돌려 물고기가 머리 옆 어깨 높이에 매달리게 한다.
  // 뒤에서 보는 카메라에서도 머리·이름표에 가리지 않는다.
  c.swing =
    e < s.cast
      ? SHOW_SWING * span(e, s.lift, s.show) +
        (1 - SHOW_SWING) * span(e, s.swing, s.drop)
      : 1 - span(e, s.cast, 6.3);
  c.lean =
    span(e, s.strike, s.strike + 0.25) *
    (1 - 0.6 * span(e, s.lift, s.show)) *
    (1 - span(e, s.show, s.show + 0.6));
  c.look =
    span(e, 1.9, 3.0) *
    (1 - 0.7 * span(e, s.swing, s.drop)) *
    (1 - span(e, s.drop, 6.0));
  c.tilt = span(e, 3.35, 3.65) * (1 - span(e, 4.05, 4.35));
  c.fish =
    e < 2.0 ? 0 : e < s.drop + 0.05 ? 1 : 1 - span(e, s.drop + 0.05, s.cast);
  c.wiggle =
    span(e, 2.0, 2.4) *
    (1 - 0.35 * span(e, s.swing, s.drop)) *
    (1 - span(e, s.drop, s.cast));
  if (e < s.strike) c.ripple = 1 + 0.9 * c.dip;
  else if (e < s.lift) c.ripple = 1 + span(e, s.strike, s.lift);
  else if (e < s.show)
    c.ripple = (2 + 0.8 * span(e, s.lift, 2.9)) * (1 - span(e, 2.75, 3.2));
  else if (e < s.land) c.ripple = 0;
  else if (e < 6.85) c.ripple = 0.3 + 1.5 * span(e, s.land, 6.85);
  else c.ripple = 1.8 - 0.8 * span(e, 6.85, CATCH_SECONDS);
  return c;
}

// 뼈 자세. live=0이면 반복 동작(숨쉬기·깜빡임·꼬리·입질)이 멈춘다. 반환값은 걸음에 따른 들썩임.
export function poseBones(
  b: Bone[],
  m: PoseWeights,
  t: number,
  live: number,
  seed: number,
) {
  const sitLike = Math.min(1, m.sit + m.fish);
  const holdRod = Math.min(1, m.fish + m.focus);
  const idle = Math.max(0, 1 - m.walk - m.sit - m.wave - m.fish - m.focus);
  const step = live * Math.sin(m.phase) * m.walk;
  const lift = live * Math.abs(Math.sin(m.phase)) * m.walk;
  const breathe = live * Math.sin(t * 2.1);
  // 의자 낚시의 어획 동작. 동작 줄이기(live=0)에서는 낚지 않는다.
  const c = catchCurves(live > 0 ? m.catch : -1);
  const k = m.focus;
  const e = m.catch ?? 0;

  b[BONE.hips].position.set(
    BONE_REST[BONE.hips].x,
    BONE_REST[BONE.hips].y +
      lift * 0.05 -
      0.17 * sitLike +
      SEAT_RAISE * m.focus,
    BONE_REST[BONE.hips].z + 0.05 * m.focus,
  );
  b[BONE.hips].rotation.set(0.05 * m.walk - 0.08 * sitLike, 0, step * 0.05);
  b[BONE.chest].rotation.set(
    0.12 * m.fish +
      0.06 * m.focus +
      breathe * 0.012 -
      0.03 * m.wave -
      k * 0.16 * c.lean,
    k * 0.3 * c.swing,
    -step * 0.03 + k * c.tilt * 0.05 * Math.sin(e * 7),
  );
  // 고개: 부두에서는 발밑 찌, 의자에서는 연못의 찌를 내려다본다. 가끔 둘러본다.
  // 물고기가 올라오면 올려다보고, 양동이로 옮길 때 그쪽을 본다.
  // 입질에 놀라는 순간부터 두리번거림·낚싯대 흔들림을 부드럽게 멈춘다.
  const calm = 1 - c.perk;
  b[BONE.head].rotation.set(
    0.12 * m.fish +
      0.16 * m.focus -
      0.06 * m.wave +
      live * Math.sin(t * 0.7) * 0.03 * (idle + m.sit) +
      k * (0.07 * c.perk - 0.22 * c.look),
    live * Math.sin(t * 0.37) * 0.26 * (idle + m.sit * 0.6) +
      live * Math.sin(t * 0.19) * 0.1 * holdRod * calm +
      k * 0.42 * c.swing,
    live * Math.sin(t * 0.83) * 0.07 * idle +
      0.15 * m.wave +
      step * 0.03 +
      k * 0.16 * c.tilt,
  );
  // 눈 깜빡임과 시선. 입질에는 눈이 동그래진다.
  const blinkPhase = (t * 1.0) % 4.7;
  const blink =
    live *
    (bump(blinkPhase, 0.16) +
      (seed % 3 < 1 ? bump(blinkPhase - 0.3, 0.14) : 0)) *
    (1 - c.perk);
  b[BONE.eyes].scale.set(
    1 + 0.06 * k * c.perk,
    Math.max(0.08, 1 - blink * 0.94) * (1 + 0.14 * k * c.perk),
    1,
  );
  const glance =
    live * Math.max(-1, Math.min(1, Math.sin(t * 0.53) * 2.4)) * (idle + m.sit);
  b[BONE.pupils].position.set(
    BONE_REST[BONE.pupils].x + glance * 0.02 + k * 0.012 * c.swing,
    BONE_REST[BONE.pupils].y -
      0.02 * m.focus -
      0.012 * m.fish +
      k * 0.03 * c.look,
    BONE_REST[BONE.pupils].z,
  );
  const twitchL = live * bump((t * 0.9 + 1.3) % 6.4, 0.32),
    twitchR = live * bump((t * 0.9 + 4.1) % 7.9, 0.3);
  b[BONE.earL].rotation.set(
    -0.05 * twitchL - k * 0.22 * c.perk,
    0,
    0.32 * twitchL * (1 - c.perk),
  );
  b[BONE.earR].rotation.set(
    -0.05 * twitchR - k * 0.22 * c.perk,
    0,
    -0.32 * twitchR * (1 - c.perk),
  );

  // 팔: 걷기 흔들기, 두 앞발로 낚싯대 쥐기, 손 흔들기. 챔질하면 두 팔을 들어 올린다.
  const wiggle = live * Math.sin(t * 9) * 0.3;
  const haul = k * 0.32 * Math.max(0, c.raise);
  b[BONE.armL].rotation.set(
    -0.25 - step * 0.55 - 0.1 * sitLike - 0.85 * holdRod - haul,
    0,
    0.08 + 0.18 * holdRod,
  );
  b[BONE.armR].rotation.set(
    (-0.25 + step * 0.55 - 0.1 * sitLike - 0.95 * holdRod - haul) *
      (1 - m.wave),
    0,
    -0.08 - 0.12 * holdRod + m.wave * (2.5 + wiggle),
  );
  // 다리: 걷기, 바닥에 앉기(앞으로 뻗음), 의자에 앉기(좌판 끝에 걸침)
  const legDown = -1.45 * sitLike - 1.2 * m.focus;
  const splay = 0.2 * sitLike + 0.12 * m.focus;
  // 물고기를 구경할 때 발을 살짝 동동 구른다.
  const kick = k * c.tilt * 0.12 * Math.sin(e * 11);
  b[BONE.legL].rotation.set(step * 0.65 + legDown + kick, -splay, 0);
  b[BONE.legR].rotation.set(-step * 0.65 + legDown - kick, splay, 0);
  // 꼬리: 뿌리부터 위상이 밀리는 물결. 바닥에서는 옆으로 감고, 의자에서는 쿠션 위 몸 옆으로 말아 둔다
  // (verify-fishing.ts가 좌판·등받이·다리와 겹치는 꼬리 정점이 0개인지 확인한다).
  // 물고기를 낚으면 꼬리 끝이 신나게 흔들린다.
  const wagSpeed = 1.7 + m.walk * 2.4 + k * 3 * c.look;
  const sway =
    live * (0.22 + 0.08 * m.walk) * (1 - 0.75 * m.focus) + k * 0.16 * c.look;
  b[BONE.tail1].rotation.set(
    -0.35 * sitLike + 0.2 * m.focus - 0.1 * m.walk,
    0.85 * sitLike + 1.7 * m.focus,
    Math.sin(t * wagSpeed) * sway,
  );
  b[BONE.tail2].rotation.set(
    1.6 * m.focus,
    0,
    Math.sin(t * wagSpeed - 0.8) * sway * 1.2 + 0.4 * m.focus,
  );
  b[BONE.tail3].rotation.set(
    live * Math.sin(t * 1.1) * 0.12 - 0.4 * m.focus,
    0,
    Math.sin(t * wagSpeed - 1.6) * sway * 1.4,
  );
  // 낚싯대: 팔 회전을 되돌려 몸 기준 방향을 유지한다. 의자에서는 더 세워 연못 멀리 던진다.
  // 부두에서는 가끔 찌가 당겨지는 입질이 있고, 의자에서는 어획 곡선이 낚싯대를 움직인다.
  const rod = b[BONE.rod],
    arm = b[BONE.armR].rotation;
  const tug = biteTug(t, live) * m.fish;
  rod.rotation.set(
    -arm.x -
      FOCUS_CAST.rodLift * m.focus +
      live * Math.sin(t * 1.5) * 0.025 * calm +
      tug -
      k * (0.42 * c.raise + 0.05 * c.dip),
    k * 0.7 * c.swing,
    -arm.z,
  );
  rod.scale.setScalar(Math.max(1e-4, holdRod));
  return lift;
}

// 가끔 찌가 당겨지는 입질(약 8.4초마다 0.8초)
export function biteTug(t: number, live: number) {
  return live * bump((t * 0.55) % 4.6, 0.45) * 0.12;
}

const tip = new Vector3(),
  paw = new Vector3(),
  rest = new Vector3(),
  target = new Vector3(),
  from = new Vector3(),
  to = new Vector3();
// 이차 베지에. out에 쓴다.
function bezier(out: Vector3, a: Vector3, c: Vector3, b: Vector3, s: number) {
  const u = 1 - s;
  return out.set(
    u * u * a.x + 2 * u * s * c.x + s * s * b.x,
    u * u * a.y + 2 * u * s * c.y + s * s * b.y,
    u * u * a.z + 2 * u * s * c.z + s * s * b.z,
  );
}
const SWING_VIA = new Vector3(1.2, 1.55, 0.8);
const CAST_VIA = new Vector3(0.15, 2.7, 2.0);
// 낚싯대 끝 아래에 매달린 찌(물고기가 천천히 흔들린다)
const dangle = (out: Vector3, e: number) =>
  out.set(tip.x + 0.04 * Math.sin(e * 3.1), tip.y - DANGLE, tip.z);
// 어획 중 찌의 루트 기준 위치. 낚싯대 끝(tip)을 따라가거나 양동이로 옮겨 간다.
function catchFloat(out: Vector3, e: number, c: CatchCurves, bob: number) {
  const s = CATCH_STEPS;
  const water = FOCUS_CAST.float;
  if (e < s.strike) return out.copy(water).setY(water.y + bob - 0.07 * c.dip);
  if (e < s.lift) {
    const k = span(e, s.strike, s.lift);
    return out.set(water.x, water.y - 0.12 * k, water.z - 0.3 * k);
  }
  if (e < s.show) {
    const k = span(e, s.lift, s.show);
    from.set(water.x, water.y - 0.12, water.z - 0.3);
    dangle(to, e);
    return out.lerpVectors(from, to, k).setY(out.y + 0.25 * pulse(k));
  }
  if (e < s.swing) return dangle(out, e);
  if (e < s.drop) {
    dangle(from, e);
    return bezier(out, from, SWING_VIA, BUCKET_DROP, span(e, s.swing, s.drop));
  }
  if (e < s.cast)
    return out
      .copy(BUCKET_DROP)
      .setY(BUCKET_DROP.y - DROP_DEPTH * span(e, s.drop, s.cast));
  if (e < WINDUP) {
    from.copy(BUCKET_DROP).setY(BUCKET_DROP.y - DROP_DEPTH);
    to.set(tip.x, tip.y - 0.35, tip.z);
    return out.lerpVectors(from, to, span(e, s.cast, WINDUP));
  }
  if (e < s.land) {
    from.set(tip.x, tip.y - 0.35, tip.z);
    return bezier(out, from, CAST_VIA, water, span(e, WINDUP, s.land));
  }
  return out.copy(water).setY(water.y + bob - 0.06 * pulse((e - s.land) / 0.3));
}

// 찌 위치. 루트 뼈 기준 좌표로 낚싯대 끝을 구해(부두) 또는 의자 앞 고정 지점(의자)에 둔다.
// 낚싯대를 쥐지 않을 때는 앞발 위치로 접어 줄 길이를 0으로 만든다. poseBones 뒤에 부른다.
// 의자에서 물고기를 낚는 중이면 찌가 물고기를 달고 낚싯대 끝·양동이로 옮겨 가고,
// 물결 고리는 수면에 남아 퍼지거나 사라진다.
export function placeFloat(b: Bone[], m: PoseWeights, t: number, live: number) {
  const rod = b[BONE.rod],
    root = b[BONE.root],
    float = b[BONE.float];
  rod.updateWorldMatrix(true, false);
  tip.copy(ROD_TIP_LOCAL).applyMatrix4(rod.matrixWorld);
  root.worldToLocal(tip);
  paw.setFromMatrixPosition(rod.matrixWorld);
  root.worldToLocal(paw);
  const hold = Math.min(1, m.fish + m.focus);
  const hidden = Math.max(0, 1 - hold);
  const sum = Math.max(1e-6, hidden + m.fish + m.focus);
  const bob = live * Math.sin(t * 1.9) * 0.012;
  const dockBob = bob - biteTug(t, live) * 0.3;
  rest.copy(paw).multiplyScalar(hidden);
  rest.x += m.fish * tip.x + m.focus * FOCUS_CAST.float.x;
  rest.y +=
    m.fish * (DOCK_FLOAT_Y + dockBob) + m.focus * (FOCUS_CAST.float.y + bob);
  rest.z += m.fish * (tip.z + 0.22) + m.focus * FOCUS_CAST.float.z;
  rest.divideScalar(sum);
  const c = catchCurves(live > 0 ? m.catch : -1);
  if (c.active && m.focus > 0) {
    // 의자 낚시 몫만 어획 위치로 바꾼다(전환 중 다른 자세 몫은 그대로).
    catchFloat(target, m.catch!, c, bob);
    const w = m.focus / sum;
    target.sub(FOCUS_CAST.float).setY(target.y - bob);
    float.position.copy(rest).addScaledVector(target, w);
  } else float.position.copy(rest);
  float.scale.setScalar(Math.max(1e-4, hold));

  const ripple = b[BONE.ripple];
  ripple.position.copy(rest);
  ripple.scale.setScalar(Math.max(1e-4, hold * c.ripple));

  // 물고기: 찌 아래 목줄 끝에 매달려 좌우로 파닥이고 천천히 돈다. 양동이에 들어가며 작아진다.
  const fish = b[BONE.fish],
    fin = b[BONE.fishTail];
  const e = m.catch ?? 0;
  const size = c.fish * m.focus * FISH_SIZE;
  fish.scale.setScalar(Math.max(1e-4, size));
  fish.rotation.set(
    0,
    c.wiggle * 0.5 * Math.sin(e * 2.3),
    c.wiggle * (0.3 * Math.sin(e * 7.5) + 0.1 * Math.sin(e * 13)),
  );
  fin.rotation.set(0, 0, c.wiggle * 0.6 * Math.sin(e * 15));
}
