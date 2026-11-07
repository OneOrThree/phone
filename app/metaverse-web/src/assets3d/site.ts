import { BUILDINGS, CAMPFIRE, DOCK_POINT, TREE_POSITIONS } from "../layout";
import { rng } from "./geometry";
import { GROUND_Y } from "./palette";
import { shoreDistance, shoreWidth, polar, RX, RZ } from "./shoreline";

// layout.ts의 좌표에서 파생한 장식 배치. 데이터 정본은 layout.ts이고, 이 파일은 읽기만 한다.
export type XZ = [number, number];

// 일반 섬 광장은 모닥불 둘레 휴식 자리(world.restSpot 반경 3.6·4.7·5.8)만 남긴다.
// 30석 낚시 의자는 낚시섬으로 옮겼고, 예전 의자 고리 자리는 풀밭·꽃밭이다.
export const PLAZA_RADIUS = 6.5;
// 모닥불 둘레 돌길
export const STONE_RINGS = [3.6];
// 광장 가장자리에서 길이 시작한다(예전 의자 고리 자리는 풀밭·꽃밭).
const fromPlaza = (x: number, z: number): XZ => {
  const r = Math.hypot(x, z);
  return [(x / r) * (PLAZA_RADIUS - 0.2), (z / r) * (PLAZA_RADIUS - 0.2)];
};

export const PATHS: { points: XZ[]; width: number }[] = [
  {
    points: [
      fromPlaza(0, 9.4),
      [0, 9.4],
      [0.35, 12.2],
      [-0.25, 15.3],
      [0, 18.2],
    ],
    width: 0.95,
  },
  {
    points: [
      fromPlaza(-7.3, -5),
      [-7.3, -5],
      [-9.5, -6.9],
      [-12, -7.9],
      [-12, -8.6],
    ],
    width: 0.95,
  },
  {
    points: [
      fromPlaza(7.6, -4.6),
      [7.6, -4.6],
      [9.9, -5.6],
      [12, -6],
      [12, -6.6],
    ],
    width: 0.95,
  },
  {
    points: [
      fromPlaza(2.6, -9.3),
      [2.6, -9.3],
      [3.5, -12],
      [4.9, -14.5],
      [5.55, -15.7],
    ],
    width: 0.8,
  },
  {
    points: [fromPlaza(8.4, 4.4), [8.4, 4.4], [11.1, 5.8], [13.3, 6.7]],
    width: 0.8,
  },
  {
    points: [
      fromPlaza(-9.3, 1.4),
      [-9.3, 1.4],
      [-13.4, 2.6],
      [-17, 1.3],
      [-21, 0.4],
    ],
    width: 0.62,
  },
  {
    points: [
      fromPlaza(9.3, -0.9),
      [9.3, -0.9],
      [13.4, -1.7],
      [17.1, -0.1],
      [21.1, 0],
    ],
    width: 0.62,
  },
];

export function catmull(points: XZ[], step = 0.2): XZ[] {
  const out: XZ[] = [];
  const p = [points[0], ...points, points[points.length - 1]];
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    const length = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(length / step));
    for (let s = 0; s < n; s++) {
      const t = s / n,
        t2 = t * t,
        t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b +
          (-a + c) * t +
          (2 * a - 5 * b + 4 * c - d) * t2 +
          (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
export const PATH_SAMPLES = PATHS.map((path) => ({
  width: path.width,
  samples: catmull(path.points),
}));

// 격자 해시로 경로까지의 거리를 빠르게 찾는다. 경로 가장자리 기준 거리(음수면 경로 안), 멀면 큰 값.
export function makePathField(
  paths: { width: number; samples: XZ[] }[],
  cell = 2,
) {
  const buckets = new Map<string, { x: number; z: number; w: number }[]>();
  for (const path of paths)
    for (const [x, z] of path.samples) {
      const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
      const list = buckets.get(key) ?? [];
      list.push({ x, z, w: path.width });
      buckets.set(key, list);
    }
  return (x: number, z: number) => {
    const cx = Math.floor(x / cell),
      cz = Math.floor(z / cell);
    let best = 99;
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const s of buckets.get(`${cx + i},${cz + j}`) ?? [])
          best = Math.min(best, Math.hypot(s.x - x, s.z - z) - s.w);
    return best;
  };
}
export const pathDistance = makePathField(PATH_SAMPLES);

// 건물 외형. 상자(회관·상점)와 원(등대·우체통)으로 나무·풀 배치와 충돌을 피한다.
export const FOOTPRINTS = {
  hall: {
    kind: "box",
    x: BUILDINGS.hall.x,
    z: BUILDINGS.hall.z,
    hx: 1.95,
    hz: 1.7,
  },
  shop: {
    kind: "box",
    x: BUILDINGS.shop.x,
    z: BUILDINGS.shop.z,
    hx: 1.85,
    hz: 1.6,
  },
  lighthouse: {
    kind: "circle",
    x: BUILDINGS.lighthouse.x,
    z: BUILDINGS.lighthouse.z,
    r: 1.05,
  },
  mailbox: {
    kind: "circle",
    x: BUILDINGS.mailbox.x,
    z: BUILDINGS.mailbox.z,
    r: 0.45,
  },
} as const;
export function buildingClearance(x: number, z: number) {
  let best = 99;
  for (const f of Object.values(FOOTPRINTS)) {
    if (f.kind === "box") {
      const dx = Math.max(0, Math.abs(x - f.x) - f.hx),
        dz = Math.max(0, Math.abs(z - f.z) - f.hz);
      best = Math.min(best, Math.hypot(dx, dz));
    } else best = Math.min(best, Math.hypot(x - f.x, z - f.z) - f.r);
  }
  return best;
}
// 등대 문과 우체통 투입구는 광장을 본다.
export const LIGHTHOUSE_YAW = Math.atan2(
  -BUILDINGS.lighthouse.x,
  -BUILDINGS.lighthouse.z,
);
export const MAILBOX_YAW = Math.atan2(
  -BUILDINGS.mailbox.x,
  -BUILDINGS.mailbox.z,
);

export const DOCK = {
  x: 1.62,
  z0: 17.5,
  z1: DOCK_POINT.z + 1.25,
  top: GROUND_Y + 0.005,
  pilings: [19.4, 21, 22.6, 24.2, DOCK_POINT.z + 1.12],
} as const;
export const BOAT = { x: 2.95, z: 22.7, yaw: 0.08 } as const;

export type TreeSpec = {
  x: number;
  z: number;
  scale: number;
  pine: boolean;
  variant: number;
  yaw: number;
};
// 건물과 겹치는 나무는 어린 나무로 줄인다. 위치와 충돌 반경은 layout 그대로다.
export const TREES: TreeSpec[] = TREE_POSITIONS.map(([x, z, size], i) => {
  const pine = i % 3 === 2 || buildingClearance(x, z) < 1;
  const crown = pine ? 1.0 : 1.35;
  const fit = (buildingClearance(x, z) - 0.15) / crown;
  return {
    x,
    z,
    scale: Math.max(0.42, Math.min(size, fit)),
    pine,
    variant: i % (pine ? 2 : 3),
    yaw: (i * 2.39996) % (Math.PI * 2),
  };
});

export type Rock = {
  x: number;
  z: number;
  r: number;
  h: number;
  yaw: number;
  variant: number;
};
const nearDock = (x: number, z: number) => Math.abs(x) < 4.6 && z > 16;
// 얕은 바다와 물가의 바위. 걷는 영역 밖에만 둔다.
export const WATER_ROCKS: Rock[] = (() => {
  const random = rng(7);
  const out: Rock[] = [];
  for (let i = 0; i < 40 && out.length < 24; i++) {
    const theta = (i / 40) * Math.PI * 2 + random() * 0.12;
    const w = shoreWidth(theta);
    const u = w + 0.5 + random() * (i % 3 === 0 ? 5.5 : 2.6);
    const rn = 1 + u / RX;
    const x = Math.cos(theta) * rn * RX,
      z = Math.sin(theta) * rn * RZ;
    if (nearDock(x, z) || random() < 0.3) continue;
    const r = 0.45 + random() * (u > w + 3 ? 0.9 : 0.6);
    out.push({
      x,
      z,
      r,
      h: r * (0.55 + random() * 0.35),
      yaw: random() * 6.28,
      variant: i % 3,
    });
    // 큰 바위 옆 작은 바위
    if (r > 0.8 && random() < 0.7) {
      const a = random() * 6.28;
      out.push({
        x: x + Math.cos(a) * (r + 0.35),
        z: z + Math.sin(a) * (r + 0.35),
        r: r * 0.45,
        h: r * 0.3,
        yaw: a,
        variant: (i + 1) % 3,
      });
    }
  }
  return out.filter((rock) => shoreDistance(rock.x, rock.z) > -0.1);
})();

// 바다 셰이더가 포말 고리를 그릴 물체(바위·부두 기둥)
export const FOAM_SOURCES: [number, number, number][] = [
  ...WATER_ROCKS.map((r): [number, number, number] => [r.x, r.z, r.r * 0.92]),
  ...DOCK.pilings.flatMap((z): [number, number, number][] =>
    [-DOCK.x, DOCK.x].map((x) => [x, z, 0.16]),
  ),
  [BOAT.x, BOAT.z, 0.55],
].filter(([x, z]) => shoreDistance(x, z) > -0.2) as [number, number, number][];

export const isOpenGround = (x: number, z: number, margin = 0) => {
  const { rn } = polar(x, z);
  if (rn > 0.985) return false;
  if (Math.hypot(x - CAMPFIRE.x, z - CAMPFIRE.z) < PLAZA_RADIUS + 0.3 + margin)
    return false;
  if (pathDistance(x, z) < 0.35 + margin) return false;
  if (buildingClearance(x, z) < 0.35 + margin) return false;
  if (TREE_POSITIONS.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 0.55))
    return false;
  return true;
};
