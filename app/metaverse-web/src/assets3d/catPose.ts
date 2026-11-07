import { Vector3, type Bone } from "three";
import { BONE, BONE_REST, ROD_TIP_LOCAL } from "./catModel";
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
};
export const POSES = ["walk", "sit", "wave", "fish", "focus"] as const;

// 의자에 앉을 때 몸통 바닥(모델 0.19)을 쿠션 윗면(SEAT_HEIGHT)에 살짝 묻는다.
export const SEAT_RAISE = SEAT_HEIGHT - 0.21;
// 의자 낚시: 낚싯대를 48°쯤 세우고, 찌는 의자 앞 3.5m 수면에 둔다.
// 의자 반경 13.2에서 3.5m 앞은 연못 중심에서 9.7m(연못 반경 10.5 안쪽 0.8m)다.
export const FOCUS_CAST = {
  rodLift: 0.32,
  // x는 낚싯대 끝(로컬 x ≈ -0.03)과 맞춰 줄이 옆으로 기울지 않게 한다.
  float: new Vector3(-0.02, POND_LEVEL - GROUND_Y, 3.5),
} as const;
// 부두 낚시: 낚싯대 끝 바로 앞 바다 수면
export const DOCK_FLOAT_Y = SEA_LEVEL - GROUND_Y + 0.02;

const bump = (phase: number, width: number) =>
  phase < width ? Math.sin((phase / width) * Math.PI) : 0;

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
    0.12 * m.fish + 0.06 * m.focus + breathe * 0.012 - 0.03 * m.wave,
    0,
    -step * 0.03,
  );
  // 고개: 부두에서는 발밑 찌, 의자에서는 연못의 찌를 내려다본다. 가끔 둘러본다.
  b[BONE.head].rotation.set(
    0.12 * m.fish +
      0.16 * m.focus -
      0.06 * m.wave +
      live * Math.sin(t * 0.7) * 0.03 * (idle + m.sit),
    live * Math.sin(t * 0.37) * 0.26 * (idle + m.sit * 0.6) +
      live * Math.sin(t * 0.19) * 0.1 * holdRod,
    live * Math.sin(t * 0.83) * 0.07 * idle + 0.15 * m.wave + step * 0.03,
  );
  // 눈 깜빡임과 시선
  const blinkPhase = (t * 1.0) % 4.7;
  const blink =
    live *
    (bump(blinkPhase, 0.16) +
      (seed % 3 < 1 ? bump(blinkPhase - 0.3, 0.14) : 0));
  b[BONE.eyes].scale.set(1, Math.max(0.08, 1 - blink * 0.94), 1);
  const glance =
    live * Math.max(-1, Math.min(1, Math.sin(t * 0.53) * 2.4)) * (idle + m.sit);
  b[BONE.pupils].position.set(
    BONE_REST[BONE.pupils].x + glance * 0.02,
    BONE_REST[BONE.pupils].y - 0.02 * m.focus - 0.012 * m.fish,
    BONE_REST[BONE.pupils].z,
  );
  const twitchL = live * bump((t * 0.9 + 1.3) % 6.4, 0.32),
    twitchR = live * bump((t * 0.9 + 4.1) % 7.9, 0.3);
  b[BONE.earL].rotation.set(-0.05 * twitchL, 0, 0.32 * twitchL);
  b[BONE.earR].rotation.set(-0.05 * twitchR, 0, -0.32 * twitchR);

  // 팔: 걷기 흔들기, 두 앞발로 낚싯대 쥐기, 손 흔들기
  const wiggle = live * Math.sin(t * 9) * 0.3;
  b[BONE.armL].rotation.set(
    -0.25 - step * 0.55 - 0.1 * sitLike - 0.85 * holdRod,
    0,
    0.08 + 0.18 * holdRod,
  );
  b[BONE.armR].rotation.set(
    (-0.25 + step * 0.55 - 0.1 * sitLike - 0.95 * holdRod) * (1 - m.wave),
    0,
    -0.08 - 0.12 * holdRod + m.wave * (2.5 + wiggle),
  );
  // 다리: 걷기, 바닥에 앉기(앞으로 뻗음), 의자에 앉기(좌판 끝에 걸침)
  const legDown = -1.45 * sitLike - 1.2 * m.focus;
  const splay = 0.2 * sitLike + 0.12 * m.focus;
  b[BONE.legL].rotation.set(step * 0.65 + legDown, -splay, 0);
  b[BONE.legR].rotation.set(-step * 0.65 + legDown, splay, 0);
  // 꼬리: 뿌리부터 위상이 밀리는 물결. 바닥에서는 옆으로 감고, 의자에서는 쿠션 위 몸 옆으로 말아 둔다
  // (verify-fishing.ts가 좌판·등받이·다리와 겹치는 꼬리 정점이 0개인지 확인한다).
  const wagSpeed = 1.7 + m.walk * 2.4;
  const sway = live * (0.22 + 0.08 * m.walk) * (1 - 0.75 * m.focus);
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
  const rod = b[BONE.rod],
    arm = b[BONE.armR].rotation;
  const tug = biteTug(t, live);
  rod.rotation.set(
    -arm.x -
      FOCUS_CAST.rodLift * m.focus +
      live * Math.sin(t * 1.5) * 0.025 +
      tug,
    0,
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
  target = new Vector3();
// 찌 위치. 루트 뼈 기준 좌표로 낚싯대 끝을 구해(부두) 또는 의자 앞 고정 지점(의자)에 둔다.
// 낚싯대를 쥐지 않을 때는 앞발 위치로 접어 줄 길이를 0으로 만든다. poseBones 뒤에 부른다.
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
  const bob = live * Math.sin(t * 1.9) * 0.012 - biteTug(t, live) * 0.3;
  target.copy(paw).multiplyScalar(hidden);
  target.x += m.fish * tip.x + m.focus * FOCUS_CAST.float.x;
  target.y +=
    m.fish * (DOCK_FLOAT_Y + bob) + m.focus * (FOCUS_CAST.float.y + bob);
  target.z += m.fish * (tip.z + 0.22) + m.focus * FOCUS_CAST.float.z;
  float.position.copy(target).divideScalar(sum);
  float.scale.setScalar(Math.max(1e-4, hold));
}
