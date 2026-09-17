export type Point = { x: number; y: number };
// Foot positions in legacy coordinates (world x = x + 768).
export const nodes: Record<string, Point> = {
  dock: { x: 313, y: 1135 },
  mail: { x: 420, y: 1125 },
  south: { x: 510, y: 1020 },
  shop: { x: 700, y: 1038 },
  low: { x: 542, y: 930 },
  east: { x: 642, y: 700 },
  fire: { x: 455, y: 825 },
  west: { x: 330, y: 760 },
  board: { x: 340, y: 735 },
  center: { x: 555, y: 640 },
  fork: { x: 465, y: 565 },
  hall: { x: 440, y: 530 },
  tower: { x: 735, y: 565 },
  gram: { x: 610, y: 880 },
};
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
// Trace the inner grass edge of the 2560×1536 oval island. Trees and water
// stay outside. This is deliberately independent of camera/device dimensions.
const grass = [
  [920, 365],
  [1050, 350],
  [1210, 395],
  [1350, 425],
  [1440, 470],
  [1620, 490],
  [1740, 465],
  [1860, 450],
  [1920, 525],
  [1870, 625],
  [2010, 690],
  [2060, 760],
  [2000, 830],
  [1890, 900],
  [1780, 940],
  [1710, 1030],
  [1550, 1140],
  [1330, 1140],
  [1190, 1190],
  [1050, 1170],
  [945, 1090],
  [870, 1050],
  [795, 985],
  [835, 910],
  [800, 840],
  [720, 830],
  [720, 750],
  [780, 680],
  [845, 590],
  [820, 495],
  [855, 410],
].map(([x, y]) => ({ x: x - 768, y }));
type Box = { x: number; y: number; w: number; h: number };
// Solid footprints include a small clearance for the cat's feet, not the roof.
const facilities: Record<string, Box> = {
  hall: { x: 245, y: 230, w: 300, h: 282 },
  board: { x: 218, y: 555, w: 174, h: 165 },
  tower: { x: 692, y: 280, w: 175, h: 265 },
  shop: { x: 618, y: 755, w: 275, h: 268 },
  mail: { x: 375, y: 1032, w: 52, h: 75 },
  gram: { x: 615, y: 852, w: 50, h: 100 },
};
const fire: Box = { x: 480, y: 715, w: 105, h: 100 };
const allBuildings = Object.keys(facilities);
function inPolygon(p: Point) {
  let inside = false;
  for (let i = 0, j = grass.length - 1; i < grass.length; j = i++) {
    const a = grass[i],
      b = grass[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}
export function isWalkable(p: Point, buildings: readonly string[] = allBuildings) {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  // Dock arrival joins the grass without making the sea walkable.
  const dock = p.x >= 285 && p.x <= 350 && p.y >= 1090 && p.y <= 1150;
  if (!dock && !inPolygon(p)) return false;
  return ![fire, ...buildings.map((b) => facilities[b]).filter(Boolean)].some(
    (b) => p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h,
  );
}
export function clearSegment(a: Point, b: Point, buildings: readonly string[] = allBuildings) {
  const n = Math.max(1, Math.ceil(distance(a, b) / 7));
  for (let i = 0; i <= n; i++)
    if (!isWalkable({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }, buildings))
      return false;
  return true;
}
const step = 24;
const cache = new Map<string, Point[]>();
function mesh(buildings: readonly string[]) {
  const key = [...buildings].sort().join(',');
  let points = cache.get(key);
  if (!points) {
    points = [];
    for (let y = 336; y <= 1200; y += step)
      for (let x = -72; x <= 1320; x += step)
        if (isWalkable({ x, y }, buildings)) points.push({ x, y });
    cache.set(key, points);
  }
  return points;
}
export function nearestPoint(p: Point, buildings: readonly string[] = allBuildings): Point {
  if (isWalkable(p, buildings)) return p;
  return mesh(buildings).reduce(
    (best, q) => (distance(p, q) < distance(p, best) ? q : best),
    nodes.low,
  );
}
// Ground taps must fall inside land. Water/forest taps never start a walk.
export function touchDestination(
  p: Point,
  buildings: readonly string[] = allBuildings,
): Point | null {
  return isWalkable(p, buildings) ? p : null;
}
export function walkPath(
  from: Point,
  to: Point,
  buildings: readonly string[] = allBuildings,
): Point[] {
  const start = nearestPoint(from, buildings),
    end = nearestPoint(to, buildings);
  if (clearSegment(start, end, buildings)) return [start, end];
  const verts = [start, end, ...mesh(buildings)],
    adjacency = new Map<string, number>();
  for (let i = 2; i < verts.length; i++) adjacency.set(`${verts[i].x},${verts[i].y}`, i);
  const neighbors = (i: number) => {
    if (i < 2)
      return verts.flatMap((p, j) =>
        j > 1 && distance(verts[i], p) <= step * 2.5 && clearSegment(verts[i], p, buildings)
          ? [j]
          : [],
      );
    const ns: number[] = [];
    for (let dx = -step; dx <= step; dx += step)
      for (let dy = -step; dy <= step; dy += step) {
        if (!dx && !dy) continue;
        const j = adjacency.get(`${verts[i].x + dx},${verts[i].y + dy}`);
        if (j !== undefined && clearSegment(verts[i], verts[j], buildings)) ns.push(j);
      }
    for (let j = 0; j < 2; j++)
      if (distance(verts[i], verts[j]) <= step * 2.5 && clearSegment(verts[i], verts[j], buildings))
        ns.push(j);
    return ns;
  };
  const open = new Set([0]),
    cost = new Map([[0, 0]]),
    prev = new Map<number, number>();
  while (open.size) {
    let u = -1,
      best = Infinity;
    for (const i of open) {
      const f = cost.get(i)! + distance(verts[i], end);
      if (f < best) {
        u = i;
        best = f;
      }
    }
    if (u === 1) break;
    open.delete(u);
    for (const v of neighbors(u)) {
      const n = cost.get(u)! + distance(verts[u], verts[v]);
      if (n < (cost.get(v) ?? Infinity)) {
        cost.set(v, n);
        prev.set(v, u);
        open.add(v);
      }
    }
  }
  if (!prev.has(1)) return [start]; // Never cut through a building on an unreachable route.
  const raw = [end];
  let k = 1;
  while (prev.has(k)) {
    k = prev.get(k)!;
    raw.unshift(verts[k]);
  }
  const smooth = [start];
  let i = 0;
  while (i < raw.length - 1) {
    let j = raw.length - 1;
    while (j > i + 1 && !clearSegment(raw[i], raw[j], buildings)) j--;
    smooth.push(raw[j]);
    i = j;
  }
  return [start, ...smooth].filter((p, i, a) => i === 0 || distance(p, a[i - 1]) > 0.5);
}
