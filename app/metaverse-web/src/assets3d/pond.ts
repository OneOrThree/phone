import {
  FOCUS_ISLAND,
  FOCUS_LANDMARKS,
  FOCUS_POND,
  FOCUS_SEATS,
  FOCUS_SPAWN_POINT,
  FOCUS_TREE_POSITIONS,
} from "../layout";
import { fbm, rng, smooth } from "./geometry";
import { GROUND_Y, POND_LEVEL } from "./palette";
import { polar } from "./shoreline";
import { catmull, makePathField, type XZ } from "./site";
import {
  FOCUS_BRIDGES,
  FOCUS_PLUNGE,
  FOCUS_STREAM,
  FOCUS_STREAM_Z0,
  FOCUS_STREAM_Z1,
  focusStreamX,
} from "../focus-water";

// 낚시섬 배치. 정본은 layout.ts(연못 반경·물가·의자·랜드마크)이고, 이 파일은 그 좌표에서
// 지형 높이와 장식 위치를 파생한다. 걷는 곳과 의자 바닥은 모두 GROUND_Y다.
export const POND = {
  x: FOCUS_POND.x,
  z: FOCUS_POND.z,
  radius: FOCUS_POND.radius,
  bank: FOCUS_ISLAND.bankRadius,
  // 의자 앞 물가 길(걷는 곳). 의자 좌판 앞쪽 끝(13.2 - 0.36)까지.
  path: FOCUS_ISLAND.seatRadius - 0.62,
} as const;
// 연못 수면(palette.ts의 POND_LEVEL). 땅(0.1)보다 0.3m 낮아 물가 비탈과 돌이 드러난다.
export { POND_LEVEL };
// 연못 바닥 비탈이 물에 닿는 반경. 수면 메시는 이보다 조금 크게 깔고 지형이 가린다.
const LIP_INNER = POND.radius - 0.06;
const BED_DEEP = 0.95;
export const ISLET = { radius: 1.25, top: POND_LEVEL + 0.24 } as const;

export const pondR = (x: number, z: number) =>
  Math.hypot(x - POND.x, z - POND.z);

// 연못 안 바닥 높이(수면 아래). 물가에서 0.06m, 가운데로 갈수록 깊어지고 가운데 작은 섬이 솟는다.
export function pondBed(x: number, z: number) {
  const r = pondR(x, z);
  const wobble = (fbm(x * 0.35 + 7, z * 0.35 - 3, 2) - 0.5) * 0.16;
  let h =
    POND_LEVEL -
    0.06 -
    BED_DEEP * smooth(LIP_INNER, 7.2, r) +
    wobble * smooth(LIP_INNER, 9, r);
  // 가운데 작은 섬: 수면 위로 0.24m, 가장자리는 완만하게 물에 잠긴다.
  const islet =
    ISLET.top -
    (ISLET.top - (POND_LEVEL - 0.7)) *
      smooth(ISLET.radius * 0.55, ISLET.radius + 1.1, r);
  h = Math.max(
    h,
    islet + (fbm(x * 1.4, z * 1.4, 2) - 0.5) * 0.08 * (1 - smooth(0.4, 1.4, r)),
  );
  return h;
}
// 물가 비탈: 걷는 땅(bank)에서 수면 아래(LIP_INNER)까지 볼록하게 내려간다.
export function bankHeight(r: number) {
  const low = POND_LEVEL - 0.06;
  const t = Math.min(1, Math.max(0, (r - LIP_INNER) / (POND.bank - LIP_INNER)));
  return low + (GROUND_Y - low) * (1 - (1 - t) * (1 - t));
}

// 폭포·물길. 폭포 바위(랜드마크 반경 2) 앞 작은 소에서 넘친 물이 좁은 돌 물길을 따라 연못으로 흘러든다.
const FALL = FOCUS_LANDMARKS.waterfall;
// 소·물길·다리의 평면 배치는 이동 판정과 같은 focus-water.ts 값을 쓴다. 여기서는 높이만 붙인다.
export const PLUNGE = { ...FOCUS_PLUNGE, level: GROUND_Y - 0.08 } as const;
export const FALL_LIP = {
  x: FALL.x,
  y: GROUND_Y + 2.72,
  z: FALL.z + 0.46,
} as const;
export const STREAM = {
  ...FOCUS_STREAM,
  level: GROUND_Y - 0.1,
  bed: 0.14,
} as const;
// 물길 중심선 x(z): 북쪽 두 의자(x=±1.38) 사이를 살짝 굽이쳐 지난다.
export const streamX = focusStreamX;
export const STREAM_Z0 = FOCUS_STREAM_Z0; // 소에서 나오는 곳(-16.04)
export const STREAM_Z1 = FOCUS_STREAM_Z1; // 연못에 들어가는 곳
// 물길 수면 높이: 땅 위에서는 완만하고, 물가 비탈에서 연못 수면까지 작은 여울로 떨어진다.
export function streamLevel(z: number) {
  const r = -z;
  if (r >= POND.bank + 0.25)
    return STREAM.level + 0.03 * smooth(POND.bank + 0.25, -STREAM_Z0, r);
  const t = smooth(POND.radius - 0.05, POND.bank + 0.25, r);
  return POND_LEVEL + (STREAM.level - POND_LEVEL) * t;
}
// 물길 단면: 가운데 깊고 양옆이 둥글게 올라와 땅과 이어진다. d는 중심선까지의 거리.
export function streamCut(x: number, z: number) {
  if (z > STREAM_Z1 + 0.5 || z < STREAM_Z0 - 0.6) return Infinity;
  const d = Math.abs(x - streamX(z));
  if (d > 0.5) return Infinity;
  const bed = streamLevel(z) - STREAM.bed;
  return bed + (GROUND_Y + 0.02 - bed) * smooth(0.1, 0.48, d);
}
// 폭포 아래 소: 둥근 웅덩이. 바다 셰이더(-0.42)가 비치지 않게 바닥은 -0.22보다 높다.
export function plungeCut(x: number, z: number) {
  const d = Math.hypot(x - PLUNGE.x, z - PLUNGE.z);
  if (d > PLUNGE.radius + 0.35) return Infinity;
  const bottom = PLUNGE.level - 0.28;
  return (
    bottom +
    (GROUND_Y + 0.02 - bottom) *
      smooth(PLUNGE.radius * 0.45, PLUNGE.radius + 0.3, d)
  );
}

// 낚시섬 길: 부두→물가 길, 물가 길→쉼터·축음기, 물길 옆 디딤돌. 물가 둘레 길은 지형에서 따로 칠한다.
const SHELTER = FOCUS_LANDMARKS.shelter;
const GRAMOPHONE = FOCUS_LANDMARKS.gramophone;
// 의자 사이 각도(도)와 반경으로 길의 시작점을 정한다. 각도 0은 +Z(부두 쪽)다.
const seatGap = (deg: number, r: number): XZ => [
  Math.sin((deg * Math.PI) / 180) * r,
  Math.cos((deg * Math.PI) / 180) * r,
];
export const FOCUS_PATHS: { points: XZ[]; width: number }[] = [
  {
    // 부두와 스폰에서 남쪽 물가로. 남쪽 두 의자(0번·29번) 사이를 지난다.
    points: [
      [0, POND.path - 0.1],
      [0.1, 14.6],
      [-0.25, 16.1],
      [0.05, FOCUS_SPAWN_POINT.z + 0.4],
      [0, 18.6],
    ],
    width: 0.9,
  },
  {
    // 동쪽 축음기. 6·7번 의자 사이로 나간다.
    points: [
      seatGap(84, POND.path - 0.1),
      seatGap(84, 14.4),
      [15.6, 1.05],
      [GRAMOPHONE.x - 0.95, 0.35],
    ],
    width: 0.72,
  },
  {
    // 서쪽 쉼터. 21·22번 의자 사이로 나간다.
    points: [
      seatGap(264, POND.path - 0.1),
      seatGap(264, 14.4),
      [-15.2, 1.1],
      [SHELTER.x + 1.5, 0.3],
    ],
    width: 0.8,
  },
];
export const FOCUS_PATH_SAMPLES = FOCUS_PATHS.map((path) => ({
  width: path.width,
  samples: catmull(path.points),
}));
export const focusPathDistance = makePathField(FOCUS_PATH_SAMPLES);

// 물길을 건너는 판자 다리 두 개. 걷는 판정(world.ts)은 다리 위에서만 물길을 건너게 한다.
export const BRIDGES = FOCUS_BRIDGES;

// 쉼터와 축음기는 연못 쪽(중심)을 본다.
export const SHELTER_YAW = Math.atan2(POND.x - SHELTER.x, POND.z - SHELTER.z);
export const GRAMOPHONE_YAW = Math.atan2(
  POND.x - GRAMOPHONE.x,
  POND.z - GRAMOPHONE.z,
);

// 의자 둘레의 다져진 흙 자리
export const nearestSeat = (x: number, z: number) => {
  let best = 99;
  for (const s of FOCUS_SEATS)
    best = Math.min(best, Math.hypot(s.x - x, s.z - z));
  return best;
};
export const landmarkClearance = (x: number, z: number) =>
  Math.min(
    Math.hypot(x - FALL.x, z - FALL.z) - 2.35,
    Math.hypot(x - SHELTER.x, z - SHELTER.z) - 1.75,
    Math.hypot(x - GRAMOPHONE.x, z - GRAMOPHONE.z) - 0.95,
    Math.hypot(x - PLUNGE.x, z - PLUNGE.z) - PLUNGE.radius - 0.2,
  );
export const streamDistance = (x: number, z: number) => {
  if (z > STREAM_Z1 + 0.3 || z < STREAM_Z0 - 0.4) return 99;
  return Math.abs(x - streamX(z)) - STREAM.width / 2;
};
const nearDock = (x: number, z: number) => Math.abs(x) < 2.4 && z > 17;

// 풀·꽃이 자라는 빈 땅: 물가 길·의자·길·랜드마크·물길·나무·부두 밖.
export function focusOpenGround(x: number, z: number, margin = 0) {
  const { rn } = polar(x, z);
  if (rn > 0.985) return false;
  if (pondR(x, z) < POND.path + 0.55 + margin) return false;
  if (nearestSeat(x, z) < 0.85 + margin) return false;
  if (focusPathDistance(x, z) < 0.35 + margin) return false;
  if (landmarkClearance(x, z) < margin) return false;
  if (streamDistance(x, z) < 0.45 + margin) return false;
  if (nearDock(x, z)) return false;
  if (
    FOCUS_TREE_POSITIONS.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 0.55)
  )
    return false;
  return true;
}

// 낚시섬 나무: 바깥 둘레에 늘어선 활엽수·침엽수, 물가 쪽 몇 그루는 늘어진 버드나무.
export type FocusTree = {
  x: number;
  z: number;
  scale: number;
  kind: "broadleaf" | "pine" | "willow";
  variant: number;
  yaw: number;
};
export const FOCUS_TREES: FocusTree[] = FOCUS_TREE_POSITIONS.map(
  ([x, z, size], i) => {
    const clear = landmarkClearance(x, z) + 2.35;
    const kind: FocusTree["kind"] =
      i % 4 === 1 ? "willow" : i % 3 === 2 ? "pine" : "broadleaf";
    return {
      x,
      z,
      scale: Math.max(0.6, Math.min(size, clear / 1.6)),
      kind,
      variant: i % (kind === "broadleaf" ? 3 : 2),
      yaw: (i * 2.39996) % (Math.PI * 2),
    };
  },
);

// 연못 장식 배치. 낚싯줄은 의자 각도(i+0.5)×12°로 들어가므로 갈대·수련은 의자 사이 각도에 둔다.
export const seatAngle = (i: number) =>
  ((i + 0.5) / FOCUS_SEATS.length) * Math.PI * 2;
const angleGap = (a: number) => {
  const step = (Math.PI * 2) / FOCUS_SEATS.length;
  const k = (((a / step) % 1) + 1) % 1;
  return Math.min(Math.abs(k - 0.5), 1 - Math.abs(k - 0.5)) * step; // 가장 가까운 줄과의 각도
};
export type Spot = {
  x: number;
  z: number;
  s: number;
  yaw: number;
  tone?: number;
};
export const POND_DECOR = (() => {
  const random = rng(1786);
  const reeds: Spot[] = [],
    lilies: Spot[] = [],
    bankStones: Spot[] = [],
    waterGrass: Spot[] = [],
    bankFlowers: Spot[] = [];
  const at = (a: number, r: number) => ({
    x: POND.x + Math.sin(a) * r,
    z: POND.z + Math.cos(a) * r,
  });
  const nearStream = (x: number, z: number, pad: number) =>
    z < 0 && Math.abs(x - streamX(z)) < STREAM.width / 2 + pad;
  // 의자 사이마다 갈대 무더기
  for (let i = 0; i < FOCUS_SEATS.length; i++) {
    const base = (i / FOCUS_SEATS.length) * Math.PI * 2;
    if (i % 2 === 1) continue;
    const n = 3 + Math.floor(random() * 3);
    for (let k = 0; k < n; k++) {
      const a = base + (random() - 0.5) * 0.08,
        r = POND.radius - 0.25 + random() * 0.65;
      const p = at(a, r);
      if (nearStream(p.x, p.z, 0.35)) continue;
      reeds.push({
        ...p,
        s: 0.55 + random() * 0.4,
        yaw: random() * 6.28,
        tone: k % 3,
      });
    }
  }
  // 물가 돌: 비탈 위 낮은 돌. 물길 입구는 비운다.
  for (let k = 0; k < 120; k++) {
    const a = random() * Math.PI * 2,
      r = POND.radius - 0.25 + random() * 0.95;
    const p = at(a, r);
    if (nearStream(p.x, p.z, 0.2)) continue;
    const big = random() < 0.25;
    bankStones.push({
      ...p,
      s: big ? 0.28 + random() * 0.16 : 0.13 + random() * 0.12,
      yaw: random() * 6.28,
      tone: k % 3,
    });
  }
  // 물가 꽃(물망초·붓꽃 느낌의 작은 꽃): 비탈 위쪽
  for (let k = 0; k < 90; k++) {
    const a = random() * Math.PI * 2,
      r = POND.radius + 0.35 + random() * 0.55;
    const p = at(a, r);
    if (nearStream(p.x, p.z, 0.3) || angleGap(a) < 0.03) continue;
    bankFlowers.push({
      ...p,
      s: 0.7 + random() * 0.4,
      yaw: random() * 6.28,
      tone: k % 4,
    });
  }
  // 수련잎: 가운데 섬 둘레와 물가 쪽 의자 사이. 찌가 떨어지는 반경(9.4~10.1)의 줄 방향은 비운다.
  let tries = 0;
  while (lilies.length < 46 && tries++ < 900) {
    const a = random() * Math.PI * 2,
      r = 2.0 + random() * 8.1;
    if (r > 8.4 && angleGap(a) < 0.11) continue;
    const p = at(a, r);
    if (nearStream(p.x, p.z, 0.8)) continue;
    if (lilies.some((l) => Math.hypot(l.x - p.x, l.z - p.z) < 0.85)) continue;
    // 무리 지어 자라도록 노이즈가 높은 곳만
    if (fbm(p.x * 0.22 + 4, p.z * 0.22 - 9, 2) < 0.48) continue;
    lilies.push({
      ...p,
      s: 0.32 + random() * 0.22,
      yaw: random() * 6.28,
      tone: random() < 0.22 ? 1 : 0,
    });
  }
  // 물속 수초: 얕은 물가 안쪽
  for (let k = 0; k < 140; k++) {
    const a = random() * Math.PI * 2,
      r = POND.radius - 0.4 - random() * 1.8;
    const p = at(a, r);
    if (nearStream(p.x, p.z, 0.5)) continue;
    waterGrass.push({ ...p, s: 0.6 + random() * 0.6, yaw: random() * 6.28 });
  }
  // 가운데 섬: 갈대와 꽃 몇 송이
  for (let k = 0; k < 9; k++) {
    const a = random() * Math.PI * 2,
      r = 0.25 + random() * 0.6;
    reeds.push({
      ...at(a, r),
      s: 0.8 + random() * 0.45,
      yaw: random() * 6.28,
      tone: k % 3,
    });
  }
  return { reeds, lilies, bankStones, waterGrass, bankFlowers };
})();
