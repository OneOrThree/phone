import {
  ISLAND,
  SPAWN_POINT,
  DOCK_POINT,
  BUILDINGS,
  CAMPFIRE,
  CAPACITY,
  REST_POINT,
  FOCUS_ISLAND,
  FOCUS_POND,
  FOCUS_SEATS,
  FOCUS_SPAWN_POINT,
  FOCUS_LANDMARKS,
  FOCUS_TREE_POSITIONS,
  TREE_POSITIONS,
  getFocusSeat,
} from "./layout.ts";
import {
  FOCUS_BRIDGES,
  FOCUS_PLUNGE,
  FOCUS_STREAM,
  FOCUS_STREAM_Z0,
  FOCUS_STREAM_Z1,
  focusStreamX,
} from "./focus-water.ts";
import type { IslandId } from "./focus-session.ts";
export type { IslandId } from "./focus-session.ts";
export type Point = { x: number; z: number };
export type Action = "idle" | "walk" | "wave" | "fish" | "sit" | "focus";
export const actions: Action[] = [
  "idle",
  "walk",
  "wave",
  "fish",
  "sit",
  "focus",
];
export const islands: readonly IslandId[] = ["home", "focus"];
export const catColors = [
  "cream",
  "peach",
  "gray",
  "black",
  "white",
  "brown",
] as const;
export type CatColor = (typeof catColors)[number];
// 섬·좌석·집중 상태는 서버 명령으로만 바뀐다. seatId는 action이 focus일 때만 있다.
export type Actor = Point & {
  island: IslandId;
  yaw: number;
  action: Action;
  color: CatColor;
  name: string;
  seatId?: number;
};
export type Resident = Actor & { id: string };
export type Circle = Point & { radius: number };
export const SPAWN: Point = SPAWN_POINT;
export const DOCK: Point = DOCK_POINT;
export const FOCUS_SPAWN: Point = FOCUS_SPAWN_POINT;
export const ISLAND_SPAWN: Record<IslandId, Point> = {
  home: SPAWN,
  focus: FOCUS_SPAWN,
};
export const NAME_MAX = 16;
export const SUBJECT_MAX = 40;
const BODY = 0.25;
const TREE_RADIUS = 0.6;
const SEAT_RADIUS = 0.48;
// 일반 섬에는 낚시 의자가 없다. 의자 30석은 낚시섬 물가에만 있다.
export const homeObstacles: readonly Circle[] = [
  ...Object.values(BUILDINGS),
  CAMPFIRE,
];
export const focusObstacles: readonly Circle[] = [
  ...Object.values(FOCUS_LANDMARKS),
  ...FOCUS_SEATS.map((s) => ({ x: s.x, z: s.z, radius: SEAT_RADIUS })),
];
/** 기존 호출 호환: 일반 섬 장애물. */
export const obstacles = homeObstacles;
export const trees = TREE_POSITIONS;
export const focusTrees = FOCUS_TREE_POSITIONS;
export const isIsland = (value: unknown): value is IslandId =>
  value === "home" || value === "focus";
/** 몸(반경 BODY)이 다리 판자 안에 다 들어가는 다리 위 자리. 다리는 x 방향으로 건넌다. */
export function onFocusBridge(p: Point): boolean {
  return FOCUS_BRIDGES.some(
    (b) =>
      Math.abs(p.z - b.z) <= b.width / 2 - BODY &&
      Math.abs(p.x - focusStreamX(b.z)) <= b.length / 2,
  );
}
/**
 * 몸이 폭포 아래 소나 물길 수면에 닿는 자리. 물길은 중심선까지의 수직 거리로 잰다.
 * 다리 위는 물길에서 빼고, 소에는 다리가 없다.
 */
export function inFocusWater(p: Point): boolean {
  if (
    Math.hypot(p.x - FOCUS_PLUNGE.x, p.z - FOCUS_PLUNGE.z) <
    FOCUS_PLUNGE.radius + BODY
  )
    return true;
  if (p.z < FOCUS_STREAM_Z0 - BODY || p.z > FOCUS_STREAM_Z1 + BODY)
    return false;
  const slope = (focusStreamX(p.z + 0.01) - focusStreamX(p.z - 0.01)) / 0.02;
  const distance =
    Math.abs(p.x - focusStreamX(p.z)) / Math.sqrt(1 + slope * slope);
  return distance < FOCUS_STREAM.width / 2 + BODY && !onFocusBridge(p);
}
export function walkable(p: Point, island: IslandId = "home"): boolean {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
  const land = (p.x / ISLAND.radiusX) ** 2 + (p.z / ISLAND.radiusZ) ** 2 < 1;
  if (island === "focus") {
    const pond =
      Math.hypot(p.x - FOCUS_POND.x, p.z - FOCUS_POND.z) <
      FOCUS_ISLAND.bankRadius;
    return (
      land &&
      !pond &&
      !inFocusWater(p) &&
      !focusObstacles.some(
        (o) => Math.hypot(o.x - p.x, o.z - p.z) < o.radius + BODY,
      ) &&
      !focusTrees.some(([x, z]) => Math.hypot(x - p.x, z - p.z) < TREE_RADIUS)
    );
  }
  if (island !== "home") return false;
  const dock = Math.abs(p.x) < 1.5 && p.z >= 18 && p.z < 25.3;
  return (
    (land || dock) &&
    !homeObstacles.some(
      (o) => Math.hypot(o.x - p.x, o.z - p.z) < o.radius + BODY,
    ) &&
    !trees.some(([x, z]) => Math.hypot(x - p.x, z - p.z) < TREE_RADIUS)
  );
}
// 직선 이동은 5cm마다 확인한다. 다리 입구처럼 좁은 모서리를 15cm 간격으로 건너뛰면
// 물 위를 스치는 구간이 생긴다.
const MOVE_STEP = 0.05;
export function moveSafe(
  from: Point,
  to: Point,
  island: IslandId = "home",
): Point {
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / MOVE_STEP),
  );
  let at = from;
  for (let i = 1; i <= steps; i++) {
    const next = {
      x: from.x + ((to.x - from.x) * i) / steps,
      z: from.z + ((to.z - from.z) * i) / steps,
    };
    if (walkable(next, island)) at = next;
    else break;
  }
  return at;
}
const CELL = 0.4;
const key = (p: Point) => `${Math.round(p.x / CELL)},${Math.round(p.z / CELL)}`;
const grid = (p: Point) => ({
  x: Math.round(p.x / CELL) * CELL,
  z: Math.round(p.z / CELL) * CELL,
});
export function pathTo(
  start: Point,
  target: Point,
  island: IslandId = "home",
): Point[] {
  if (!walkable(target, island)) return [];
  const reaches = (from: Point, to: Point, tolerance: number) => {
    const reached = moveSafe(from, to, island);
    return Math.hypot(reached.x - to.x, reached.z - to.z) < tolerance;
  };
  const snapped = grid(start),
    goal = grid(target);
  const candidates: Point[] = [];
  for (let x = -1; x <= 1; x++)
    for (let z = -1; z <= 1; z++)
      candidates.push({ x: snapped.x + x * CELL, z: snapped.z + z * CELL });
  const first = candidates
    .sort(
      (a, b) =>
        Math.hypot(a.x - start.x, a.z - start.z) -
        Math.hypot(b.x - start.x, b.z - start.z),
    )
    .find((p) => walkable(p, island) && reaches(start, p, 0.001));
  if (!first) return [];
  const queue = [first],
    parents = new Map<string, Point>(),
    costs = new Map([[key(first), 0]]);
  let end: Point | undefined;
  while (queue.length) {
    queue.sort(
      (a, b) =>
        costs.get(key(a))! +
        Math.hypot(a.x - target.x, a.z - target.z) -
        costs.get(key(b))! -
        Math.hypot(b.x - target.x, b.z - target.z),
    );
    const p = queue.shift()!;
    if (
      Math.hypot(p.x - goal.x, p.z - goal.z) < CELL * 1.1 &&
      reaches(p, target, 0.01)
    ) {
      end = p;
      break;
    }
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const n = { x: p.x + dx * CELL, z: p.z + dz * CELL },
        k = key(n);
      if (!walkable(n, island)) continue;
      const cost = costs.get(key(p))! + Math.hypot(dx, dz) * CELL;
      if (cost >= (costs.get(k) ?? Infinity) - 0.000001) continue;
      if (!reaches(p, n, 0.01)) continue;
      costs.set(k, cost);
      parents.set(k, p);
      if (!queue.some((q) => key(q) === k)) queue.push(n);
    }
  }
  if (!end) return [];
  const path = [target];
  while (key(end) !== key(first)) {
    path.unshift(end);
    end = parents.get(key(end))!;
  }
  if (Math.hypot(first.x - start.x, first.z - start.z) > 0.01)
    path.unshift(first);
  const smoothed: Point[] = [];
  let anchor = start,
    index = 0;
  while (index < path.length) {
    let last = index;
    for (let candidate = path.length - 1; candidate > index; candidate--) {
      if (reaches(anchor, path[candidate], 0.001)) {
        last = candidate;
        break;
      }
    }
    anchor = path[last];
    smoothed.push(anchor);
    index = last + 1;
  }
  return smoothed;
}
export function createActor(): Actor {
  return {
    ...SPAWN,
    island: "home",
    yaw: 0,
    action: "idle",
    color: "cream",
    name: "산책하는 고양이",
  };
}
/** 섬에 도착한 모습. 이름·털색만 이어 가고 위치·행동·좌석은 새로 정한다. */
export function arrivalActor(
  island: IslandId,
  appearance: Pick<Actor, "name" | "color">,
): Actor {
  return {
    ...ISLAND_SPAWN[island],
    island,
    yaw: 0,
    action: "idle",
    color: appearance.color,
    name: appearance.name,
  };
}
export const validName = (name: unknown): name is string =>
  typeof name === "string" && name.trim().length > 0 && name.length <= NAME_MAX;
export const validColor = (color: unknown): color is CatColor =>
  catColors.includes(color as CatColor);
/** 집중 주제는 앞뒤 공백을 지운 뒤 최대 40자다. 빈값은 허용한다. */
export function normalizeSubject(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const subject = value.trim();
  return subject.length <= SUBJECT_MAX ? subject : null;
}
export function validActor(value: unknown): value is Actor {
  if (!value || typeof value !== "object") return false;
  const p = value as Actor;
  return (
    isIsland(p.island) &&
    (p.action === "focus"
      ? validFocus(p)
      : walkable(p, p.island) && p.seatId === undefined) &&
    Number.isFinite(p.yaw) &&
    Math.abs(p.yaw) < 100 &&
    actions.includes(p.action) &&
    validColor(p.color) &&
    validName(p.name)
  );
}
// 집중 자세는 낚시섬의 실제 의자 좌표·방향과 정확히 같아야 한다.
function validFocus(p: Actor): boolean {
  const seat = Number.isInteger(p.seatId) ? getFocusSeat(p.seatId!) : undefined;
  return (
    p.island === "focus" &&
    !!seat &&
    Math.hypot(p.x - seat.x, p.z - seat.z) < 0.0001 &&
    Math.abs(p.yaw - seat.yaw) < 0.0001
  );
}
export function sanitizeActor(p: Actor): Actor {
  const actor: Actor = {
    island: p.island,
    x: p.x,
    z: p.z,
    yaw: p.yaw,
    action: p.action,
    color: p.color,
    name: p.name.trim(),
  };
  if (p.action === "focus") actor.seatId = p.seatId;
  return actor;
}
/** 집중 의자에서 일어설 때 서는 곳. 연못 반대편(바깥 물가 길)을 먼저 찾는다. */
export function seatExit(id: number): Point {
  const seat = getFocusSeat(id);
  if (seat) {
    const outward = Math.atan2(seat.x - FOCUS_POND.x, seat.z - FOCUS_POND.z);
    for (let radius = 1; radius <= 3; radius += 0.3)
      for (let i = 0; i < 24; i++) {
        const turn = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
        const angle = outward + (turn * Math.PI) / 12;
        const p = {
          x: seat.x + Math.sin(angle) * radius,
          z: seat.z + Math.cos(angle) * radius,
        };
        if (walkable(p, "focus")) return p;
      }
  }
  return { ...FOCUS_SPAWN };
}
/**
 * 휴식 중 모닥불 둘레의 자리. 0번 의자는 REST_POINT 그대로이고, 나머지는 같은
 * 원과 바깥 두 원에 10석씩 퍼져 서로 겹치지 않는다. 모두 모닥불을 본다.
 */
export function restSpot(seatId: number): Point & { yaw: number } {
  const id = Number.isInteger(seatId) && seatId >= 0 ? seatId % CAPACITY : 0;
  const base = Math.hypot(REST_POINT.x - CAMPFIRE.x, REST_POINT.z - CAMPFIRE.z);
  const baseAngle = Math.atan2(
    REST_POINT.x - CAMPFIRE.x,
    REST_POINT.z - CAMPFIRE.z,
  );
  const ring = Math.floor(id / 10),
    index = id % 10;
  const angle = baseAngle + (index / 10) * Math.PI * 2 + (ring * Math.PI) / 10;
  const radius = base + ring * 1.1;
  const x = CAMPFIRE.x + Math.sin(angle) * radius,
    z = CAMPFIRE.z + Math.cos(angle) * radius;
  return { x, z, yaw: Math.atan2(CAMPFIRE.x - x, CAMPFIRE.z - z) };
}
