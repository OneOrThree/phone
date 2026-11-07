import {
  Bone,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  LatheGeometry,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Sphere,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { art } from "../theme";
import { Builder, smooth, type V3 } from "./geometry";
import { furTones, material } from "./palette";

// Cattus 고양이. 큰 머리와 큰 눈, 짧은 팔다리, 물음표처럼 휜 꼬리.
// 낚싯대는 오른팔(rod 뼈)에, 찌는 루트의 float 뼈에 붙는다. 낚싯줄은 위 끝을 rod, 아래 끝을 float에
// 묶은 한 칸짜리 관이라 두 뼈 사이를 곧게 잇는다.
// 모든 부품을 하나의 skinned geometry로 합쳐 고양이 한 마리가 draw call 하나다.
// 뼈마다 강체로 묶어(가중치 1) 자세를 바꾸고, 몸통과 꼬리만 이웃 뼈와 섞어 부드럽게 굽힌다.
export const BONE = {
  root: 0,
  hips: 1,
  chest: 2,
  head: 3,
  eyes: 4,
  pupils: 5,
  earL: 6,
  earR: 7,
  armL: 8,
  armR: 9,
  legL: 10,
  legR: 11,
  tail1: 12,
  tail2: 13,
  tail3: 14,
  rod: 15,
  // 찌. 루트에 직접 붙어 줄 끝을 연못·바다 수면에 둔다(catPose.ts가 매 프레임 위치를 정한다).
  float: 16,
  // 낚아 올린 물고기. 찌 아래 짧은 목줄 끝(입)에 매달리고, 꼬리지느러미는 따로 흔든다.
  fish: 17,
  fishTail: 18,
  // 찌 둘레 물결 고리. 찌가 물 밖으로 나가도 수면에 남아 퍼지거나 사라진다.
  ripple: 19,
} as const;
// 물고기 치수(모델 좌표 m). 입이 위, 꼬리가 아래로 매달린다. 넓은 옆면이 ±z(고양이 앞뒤)를 본다.
export const FISH = {
  leader: 0.13,
  body: 0.29,
  tail: 0.13,
  width: 0.17,
} as const;

const TAIL = new CatmullRomCurve3([
  new Vector3(0, 0.34, -0.24),
  new Vector3(0.03, 0.38, -0.46),
  new Vector3(0.1, 0.58, -0.62),
  new Vector3(0.15, 0.84, -0.6),
  new Vector3(0.12, 1.02, -0.47),
  new Vector3(0.05, 1.07, -0.35),
]);
const tailAt = (s: number) => TAIL.getPoint(s).toArray() as V3;

// [부모, 묶는 위치(모델 좌표)]
const BONES: [number, V3][] = [
  [-1, [0, 0, 0]],
  [0, [0, 0.36, 0]],
  [1, [0, 0.6, 0]],
  [2, [0, 0.84, 0.03]],
  [3, [0, 1.12, 0.37]],
  [4, [0, 1.11, 0.4]],
  [3, [-0.27, 1.36, 0]],
  [3, [0.27, 1.36, 0]],
  [2, [-0.22, 0.74, 0.12]],
  [2, [0.22, 0.74, 0.12]],
  [1, [-0.16, 0.3, 0.03]],
  [1, [0.16, 0.3, 0.03]],
  [1, tailAt(0)],
  [12, tailAt(0.36)],
  [13, tailAt(0.7)],
  [9, [0.22, 0.46, 0.15]],
  [0, [0.3, -0.4, 2.0]],
  [16, [0.3, -0.4 - FISH.leader, 2.0]],
  [17, [0.3, -0.4 - FISH.leader - FISH.body + 0.02, 2.0]],
  [0, [0.3, -0.4, 2.0]],
];
export const BONE_REST: Vector3[] = BONES.map(([parent, at]) => {
  const p = parent < 0 ? [0, 0, 0] : BONES[parent][1];
  return new Vector3(at[0] - p[0], at[1] - p[1], at[2] - p[2]);
});

// 낚싯대: 오른 앞발(rod 뼈 원점)에서 앞쪽 위로 뻗는다. 끝점은 catPose.ts가 찌 위치 계산에 쓴다.
export const ROD = {
  length: 1.75,
  dir: new Vector3(0.06, 0.5, 0.86).normalize(),
} as const;
export const ROD_TIP = new Vector3(...BONES[BONE.rod][1]).addScaledVector(
  ROD.dir,
  ROD.length,
);
// 뼈 원점 기준 낚싯대 끝(rod 뼈의 로컬 좌표)
export const ROD_TIP_LOCAL = ROD.dir.clone().multiplyScalar(ROD.length);

const torsoWeights = (
  p: Vector3,
): [number, number, number, number, number, number] => {
  const k = smooth(0.48, 0.7, p.y);
  return [BONE.hips, 1 - k, BONE.chest, k, 0, 0];
};
const tailSamples = Array.from({ length: 80 }, (_, i) => TAIL.getPoint(i / 79));
const tailWeights = (
  p: Vector3,
): [number, number, number, number, number, number] => {
  let best = 0,
    dist = Infinity;
  tailSamples.forEach((q, i) => {
    const d = q.distanceToSquared(p);
    if (d < dist) {
      dist = d;
      best = i / 79;
    }
  });
  const w1 = 1 - smooth(0.22, 0.46, best),
    w3 = smooth(0.58, 0.82, best);
  return [BONE.tail1, w1, BONE.tail2, Math.max(0, 1 - w1 - w3), BONE.tail3, w3];
};

const cache = new Map<string, BufferGeometry>();
export function catGeometry(color: string, local: boolean) {
  const key = `${color}:${local}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const tone = furTones[color] ?? furTones.cream;
  const fur = tone.fur,
    belly = tone.belly;
  const collar = local ? art.pink : art.sky;
  const b = new Builder(7);
  const ball = new SphereGeometry(1, 26, 18),
    small = new SphereGeometry(1, 14, 10);

  // 몸통: 아래가 통통한 서양배 모양
  const profile: [number, number][] = [
    [0.001, 0.19],
    [0.16, 0.205],
    [0.265, 0.26],
    [0.31, 0.35],
    [0.318, 0.45],
    [0.298, 0.57],
    [0.258, 0.69],
    [0.2, 0.79],
    [0.12, 0.87],
    [0.001, 0.91],
  ];
  b.add(
    new LatheGeometry(
      profile.map(([r, y]) => new Vector2(r, y)),
      22,
    ),
    {
      scale: [1, 1, 0.9],
      color: fur,
      weights: torsoWeights,
    },
  );
  b.add(ball, {
    at: [0, 0.48, 0.2],
    scale: [0.2, 0.25, 0.1],
    color: belly,
    weights: torsoWeights,
  });
  b.add(new TorusGeometry(0.245, 0.045, 8, 28), {
    at: [0, 0.705, 0.01],
    rot: [Math.PI / 2 + 0.08, 0, 0],
    scale: [1, 0.92, 1],
    color: collar,
    bone: BONE.chest,
  });
  b.add(small, {
    at: [0, 0.655, 0.25],
    scale: 0.05,
    color: art.butter,
    bone: BONE.chest,
  });

  // 머리
  b.add(ball, {
    at: [0, 1.1, 0],
    scale: [0.5, 0.43, 0.43],
    color: fur,
    bone: BONE.head,
  });
  for (const s of [-1, 1]) {
    b.add(ball, {
      at: [s * 0.29, 0.98, 0.1],
      scale: [0.2, 0.15, 0.17],
      color: fur,
      bone: BONE.head,
    });
    // 볼 털
    b.add(new ConeGeometry(0.06, 0.12, 5), {
      at: [s * 0.47, 0.98, 0.06],
      rot: [0, 0, (-s * Math.PI) / 2],
      scale: [1, 1, 0.6],
      color: fur,
      bone: BONE.head,
    });
    b.add(ball, {
      at: [s * 0.056, 0.99, 0.385],
      scale: [0.075, 0.058, 0.05],
      color: belly,
      bone: BONE.head,
    });
    b.add(small, {
      at: [s * 0.29, 1.0, 0.335],
      rot: [0, s * 0.62, 0],
      scale: [0.065, 0.034, 0.02],
      color: material.blush,
      bone: BONE.head,
    });
    // 수염
    for (const [dy, tilt] of [
      [0.035, 0.12],
      [0, 0],
      [-0.035, -0.12],
    ])
      b.add(new CylinderGeometry(0.0055, 0.004, 0.3, 4), {
        at: [s * 0.47, 1.0 + dy + tilt * 0.4, 0.3],
        rot: [0, s * 0.35, (Math.PI / 2) * s + tilt * s],
        color: tone.whisker,
        bone: BONE.head,
      });
    // 입: 작은 ω
    b.add(new TorusGeometry(0.028, 0.0065, 4, 10, Math.PI), {
      at: [s * 0.028, 0.972, 0.433],
      rot: [0, 0, Math.PI],
      color: material.pupil,
      bone: BONE.head,
    });
  }
  b.add(ball, {
    at: [0, 0.915, 0.2],
    scale: [0.18, 0.08, 0.14],
    color: belly,
    bone: BONE.head,
  });
  b.add(small, {
    at: [0, 1.03, 0.425],
    scale: [0.04, 0.027, 0.026],
    color: material.nose,
    bone: BONE.head,
  });

  // 귀
  for (const s of [-1, 1]) {
    const bone = s < 0 ? BONE.earL : BONE.earR;
    b.add(new ConeGeometry(0.175, 0.36, 14), {
      at: [s * 0.29, 1.5, -0.03],
      rot: [-0.08, 0, -s * 0.34],
      scale: [1, 1, 0.55],
      color: fur,
      bone,
    });
    b.add(new ConeGeometry(0.11, 0.23, 12), {
      at: [s * 0.285, 1.475, 0.025],
      rot: [-0.08, 0, -s * 0.34],
      scale: [1, 1, 0.35],
      color: material.innerEar,
      bone,
    });
  }

  // 눈: 크림색 흰자, 큰 눈동자, 빛 두 점
  for (const s of [-1, 1]) {
    b.add(ball, {
      at: [s * 0.175, 1.12, 0.36],
      rot: [0, s * 0.38, 0],
      scale: [0.13, 0.155, 0.06],
      color: material.eyeWhite,
      bone: BONE.eyes,
    });
    b.add(ball, {
      at: [s * 0.175 + 0.012, 1.105, 0.394],
      rot: [0, s * 0.38, 0],
      scale: [0.086, 0.108, 0.04],
      color: material.pupil,
      bone: BONE.pupils,
    });
    b.add(small, {
      at: [s * 0.175 - 0.012, 1.15, 0.43 - s * 0.006],
      scale: 0.027,
      color: art.paper,
      bone: BONE.pupils,
    });
    b.add(small, {
      at: [s * 0.175 + 0.04, 1.075, 0.428 - s * 0.012],
      scale: 0.012,
      color: art.paper,
      bone: BONE.pupils,
    });
  }

  // 팔: 짧은 기둥과 둥근 앞발, 발가락 선
  for (const s of [-1, 1]) {
    const bone = s < 0 ? BONE.armL : BONE.armR;
    const [x, y, z] = BONES[bone][1];
    b.add(new CapsuleGeometry(0.083, 0.15, 6, 12), {
      at: [x, y - 0.12, z],
      color: fur,
      bone,
    });
    b.add(ball, {
      at: [x, y - 0.28, z + 0.025],
      scale: [0.1, 0.085, 0.105],
      color: fur,
      bone,
    });
    for (const t of [-1, 1])
      b.add(new CapsuleGeometry(0.008, 0.035, 2, 4), {
        at: [x + t * 0.03, y - 0.315, z + 0.12],
        rot: [0.6, 0, 0],
        color: tone.whisker,
        bone,
      });
  }
  // 다리와 뒷발
  for (const s of [-1, 1]) {
    const bone = s < 0 ? BONE.legL : BONE.legR;
    const [x, y, z] = BONES[bone][1];
    b.add(new CapsuleGeometry(0.105, 0.1, 6, 12), {
      at: [x, y - 0.1, z],
      color: fur,
      bone,
    });
    b.add(ball, {
      at: [x, y - 0.215, z + 0.055],
      scale: [0.122, 0.086, 0.15],
      color: fur,
      bone,
    });
    for (const t of [-1, 1])
      b.add(new CapsuleGeometry(0.009, 0.04, 2, 4), {
        at: [x + t * 0.035, y - 0.22, z + 0.2],
        rot: [1.1, 0, 0],
        color: tone.whisker,
        bone,
      });
  }

  // 꼬리
  b.add(new TubeGeometry(TAIL, 30, 0.078, 10, false), {
    color: fur,
    weights: tailWeights,
  });
  b.add(ball, { at: tailAt(0), scale: 0.08, color: fur, bone: BONE.tail1 });
  b.add(ball, { at: tailAt(1), scale: 0.078, color: fur, bone: BONE.tail3 });

  // 낚싯대(낚시·집중 때만 보인다): 오른 앞발에서 앞쪽 위로 뻗는다.
  const paw = new Vector3(...BONES[BONE.rod][1]);
  b.add(new CylinderGeometry(0.013, 0.03, ROD.length, 6), {
    at: paw
      .clone()
      .addScaledVector(ROD.dir, ROD.length / 2)
      .toArray() as V3,
    rot: [Math.atan2(ROD.dir.z, ROD.dir.y), 0, 0],
    color: material.woodDark,
    bone: BONE.rod,
  });
  b.add(new CylinderGeometry(0.036, 0.036, 0.26, 8), {
    at: paw.clone().addScaledVector(ROD.dir, 0.02).toArray() as V3,
    rot: [Math.atan2(ROD.dir.z, ROD.dir.y), 0, 0],
    color: material.cattail,
    bone: BONE.rod,
  });
  b.add(new CylinderGeometry(0.045, 0.045, 0.07, 10), {
    at: paw.clone().addScaledVector(ROD.dir, 0.28).toArray() as V3,
    rot: [Math.atan2(ROD.dir.z, ROD.dir.y), 0, Math.PI / 2],
    color: material.brass,
    bone: BONE.rod,
  });
  b.add(new SphereGeometry(0.018, 6, 4), {
    at: ROD_TIP.toArray() as V3,
    color: art.pink,
    bone: BONE.rod,
  });
  // 낚싯줄: 위 고리는 rod, 아래 고리는 float에 묶는다(높이 분할 1칸이라 곧은 선).
  const float = new Vector3(...BONES[BONE.float][1]);
  const span = float.clone().sub(ROD_TIP);
  b.add(new CylinderGeometry(0.0055, 0.0055, 1, 3, 1, true), {
    matrix: new Matrix4().compose(
      ROD_TIP.clone().addScaledVector(span, 0.5),
      new Quaternion().setFromUnitVectors(
        new Vector3(0, -1, 0),
        span.clone().normalize(),
      ),
      new Vector3(1, span.length(), 1),
    ),
    color: art.paper,
    weights: (p) =>
      p.distanceToSquared(ROD_TIP) < p.distanceToSquared(float)
        ? [BONE.rod, 1, 0, 0, 0, 0]
        : [BONE.float, 1, 0, 0, 0, 0],
  });
  // 찌: 빨간 윗부분·흰 아랫부분·작은 꼭지. 수면에 반쯤 잠긴다. 둘레에 옅은 물결 고리.
  const f = float.toArray() as V3;
  b.add(new SphereGeometry(0.065, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), {
    at: f,
    color: material.mailRed,
    bone: BONE.float,
  });
  b.add(
    new SphereGeometry(0.065, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    { at: f, color: art.paper, bone: BONE.float },
  );
  b.add(new CylinderGeometry(0.008, 0.008, 0.1, 4), {
    at: [f[0], f[1] + 0.1, f[2]],
    color: material.mailRed,
    bone: BONE.float,
  });
  b.add(new TorusGeometry(0.17, 0.007, 3, 28), {
    at: [f[0], f[1] + 0.012, f[2]],
    rot: [Math.PI / 2, 0, 0],
    color: "#E8F5F0",
    bone: BONE.ripple,
  });
  addFish(b, f, small);
  const geometry = b.build();
  cache.set(key, geometry);
  return geometry;
}

// 낚아 올린 물고기: 주황 몸통·크림 배·큰 눈·볼 터치·등지느러미·갈래 꼬리. 입(목줄 끝)을 뼈 원점으로
// 머리를 위로 두고 매달린다. 평소에는 catPose.ts가 크기를 0으로 접어 보이지 않는다.
const FISH_TONE = {
  body: "#F28C4E",
  back: "#E9773F",
  belly: "#FFE7C4",
  fin: "#F7B58F",
} as const;
function addFish(b: Builder, f: V3, small: SphereGeometry) {
  const ball = new SphereGeometry(1, 16, 12);
  const mouth = [f[0], f[1] - FISH.leader, f[2]] as V3;
  const [mx, my, mz] = mouth;
  const half = FISH.body / 2;
  const cy = my - half; // 몸통 가운데
  // 목줄: 찌(위)와 물고기 입(아래)을 잇는 짧은 줄
  b.add(new CylinderGeometry(0.004, 0.004, FISH.leader, 3, 1, true), {
    at: [mx, my + FISH.leader / 2, mz],
    color: art.paper,
    weights: (p) =>
      p.y > my + FISH.leader / 2
        ? [BONE.float, 1, 0, 0, 0, 0]
        : [BONE.fish, 1, 0, 0, 0, 0],
  });
  // 몸통(등은 +x 쪽으로 조금 진하게)과 배
  b.add(ball, {
    at: [mx, cy, mz],
    scale: [FISH.width / 2, half, 0.05],
    color: FISH_TONE.body,
    bone: BONE.fish,
  });
  b.add(ball, {
    at: [mx + 0.03, cy + 0.01, mz],
    scale: [FISH.width / 2 - 0.035, half - 0.03, 0.052],
    color: FISH_TONE.back,
    bone: BONE.fish,
  });
  b.add(ball, {
    at: [mx - 0.032, cy - 0.005, mz],
    scale: [0.048, half - 0.035, 0.047],
    color: FISH_TONE.belly,
    bone: BONE.fish,
  });
  // 입: 위쪽 끝의 작은 분홍 입술
  b.add(new TorusGeometry(0.014, 0.007, 6, 12), {
    at: [mx, my - 0.012, mz],
    rot: [Math.PI / 2, 0, 0],
    color: material.nose,
    bone: BONE.fish,
  });
  for (const s of [-1, 1]) {
    // 눈: 양 옆면에 크림 흰자·큰 눈동자·빛 한 점
    b.add(small, {
      at: [mx + 0.012, my - 0.065, mz + s * 0.04],
      scale: [0.03, 0.032, 0.014],
      color: material.eyeWhite,
      bone: BONE.fish,
    });
    b.add(small, {
      at: [mx + 0.014, my - 0.067, mz + s * 0.05],
      scale: [0.019, 0.022, 0.008],
      color: material.pupil,
      bone: BONE.fish,
    });
    b.add(small, {
      at: [mx + 0.007, my - 0.058, mz + s * 0.056],
      scale: 0.0065,
      color: art.paper,
      bone: BONE.fish,
    });
    b.add(small, {
      at: [mx - 0.03, my - 0.1, mz + s * 0.045],
      scale: [0.018, 0.012, 0.006],
      color: material.blush,
      bone: BONE.fish,
    });
    // 가슴지느러미
    b.add(ball, {
      at: [mx - 0.05, my - 0.13, mz + s * 0.04],
      rot: [0, 0, 0.5],
      scale: [0.035, 0.018, 0.012],
      color: FISH_TONE.fin,
      bone: BONE.fish,
    });
  }
  // 등지느러미: 등(+x) 가장자리에 반쯤 묻힌 납작한 타원
  b.add(ball, {
    at: [mx + FISH.width / 2 - 0.004, cy + 0.015, mz],
    scale: [0.036, 0.075, 0.008],
    color: FISH_TONE.fin,
    bone: BONE.fish,
  });
  // 꼬리지느러미: 꼬리 마디에서 아래로 벌어지는 두 갈래 V
  const ty = my - FISH.body + 0.02;
  for (const s of [-1, 1])
    b.add(new ConeGeometry(0.045, FISH.tail, 6), {
      at: [mx + s * 0.028, ty - FISH.tail / 2 + 0.01, mz],
      rot: [0, 0, s * 0.45],
      scale: [1, 1, 0.22],
      color: FISH_TONE.fin,
      bone: BONE.fishTail,
    });
  b.add(ball, {
    at: [mx, ty + 0.01, mz],
    scale: [0.03, 0.03, 0.025],
    color: FISH_TONE.body,
    bone: BONE.fishTail,
  });
}

export const catMaterial = new MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.82,
  metalness: 0,
});

export type CatRig = { mesh: SkinnedMesh; bones: Bone[] };
export function createCatRig(color: string, local: boolean): CatRig {
  const bones = BONES.map(() => new Bone());
  // 다리·꼬리 뿌리는 옆으로 벌린 뒤 앞뒤로 굽혀야 자연스럽다.
  for (const i of [BONE.legL, BONE.legR, BONE.tail1])
    bones[i].rotation.order = "YXZ";
  BONES.forEach(([parent], i) => {
    bones[i].position.copy(BONE_REST[i]);
    if (parent >= 0) bones[parent].add(bones[i]);
  });
  const mesh = new SkinnedMesh(catGeometry(color, local), catMaterial);
  mesh.add(bones[0]);
  mesh.bind(new Skeleton(bones));
  // 자세가 바뀌어도 잘리지 않게 넉넉한 경계 구를 고정한다(매 프레임 재계산하지 않음).
  // 의자에서 낚시할 때 찌가 앞으로 3.5m까지 나가므로 앞쪽으로 넓힌다.
  mesh.boundingSphere = new Sphere(new Vector3(0, 0.7, 1.4), 2.75);
  mesh.castShadow = true;
  return { mesh, bones };
}
