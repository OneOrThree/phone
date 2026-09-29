import data from '@/assets/village-world/map.json';
import type { Building } from '@/services/model';
import { Grid, Point, nearestLand, onLand } from './world-grid';

export type VillageObject = (typeof data.objects)[number];
export type VillageScene = {
  objects: VillageObject[];
  roads: typeof data.roadLayers;
  grid: Grid;
  roadCells: boolean[];
};
export const villageMap = data;
export const villageDoors = data.doors;
const cache = new Map<string, VillageScene>();

function inside(p: Point, polygon: number[][]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a[1] > p.y !== b[1] > p.y && p.x < ((b[0] - a[0]) * (p.y - a[1])) / (b[1] - a[1]) + a[0])
      result = !result;
  }
  return result;
}
function blocks(o: VillageObject, p: Point) {
  if (o.layer === 'grass' || o.layer === 'flowers') return false;
  const pad = 10;
  if (o.building)
    return (
      p.x > o.x - o.w * 0.46 - pad &&
      p.x < o.x + o.w * 0.46 + pad &&
      p.y > o.y - o.h * 0.22 - pad &&
      p.y < o.y + pad
    );
  const rx = o.kind === 'fire' ? o.w * 0.46 : o.kind === 'bush' ? o.w * 0.37 : o.w * 0.18;
  const ry = o.kind === 'fire' ? o.h * 0.38 : o.kind === 'bush' ? o.h * 0.2 : 12;
  return ((p.x - o.x) / (rx + pad)) ** 2 + ((p.y - (o.y - ry * 0.4)) / (ry + pad)) ** 2 < 1;
}
export function villageScene(buildings: readonly Building[]): VillageScene {
  const key = [...new Set(buildings)].sort().join(',');
  const found = cache.get(key);
  if (found) return found;
  const active = new Set<string>(buildings);
  const objects = data.objects.filter((o) => !o.building || active.has(o.building));
  const roads = data.roadLayers.filter((r) => !r.building || active.has(r.building));
  const polygons = [
    data.navigation.landPolygon,
    data.crossings.dock.polygon,
    data.crossings.bridge.polygon,
    data.crossings.grove,
  ];
  const cols = data.navigation.columns,
    rows = data.navigation.rows;
  const cells = Array.from({ length: cols * rows }, (_, i) => {
    const p = {
      x: (((i % cols) + 0.5) * data.width) / cols,
      y: ((Math.floor(i / cols) + 0.5) * data.height) / rows,
    };
    return polygons.some((polygon) => inside(p, polygon)) && !objects.some((o) => blocks(o, p))
      ? '1'
      : '0';
  }).join('');
  const result = {
    objects,
    roads,
    grid: { w: data.width, h: data.height, cols, rows, cells },
    roadCells: data.roads.cells.map((_, i) => roads.some((r) => r.cells[i])),
  };
  cache.set(key, result);
  return result;
}

// 길을 우선하되 잔디도 걷는다. 대각선은 양쪽 직교 칸이 모두 비어야 통과한다.
export function villagePath(scene: VillageScene, from: Point, to: Point): Point[] {
  const g = scene.grid;
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return [];
  const cell = (p: Point) =>
    Math.floor((p.y / g.h) * g.rows) * g.cols + Math.floor((p.x / g.w) * g.cols);
  const start = cell(nearestLand(g, from)),
    end = cell(nearestLand(g, to));
  if (!onLand(g, nearestLand(g, from))) return [];
  const cost = new Float64Array(g.cells.length).fill(Infinity),
    parent = new Int32Array(g.cells.length).fill(-1);
  const heap: { id: number; score: number }[] = [];
  const push = (id: number, score: number) => {
    heap.push({ id, score });
    let i = heap.length - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p].score <= score) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let j = i * 2 + 1;
        if (j >= heap.length) break;
        if (j + 1 < heap.length && heap[j + 1].score < heap[j].score) j++;
        if (heap[i].score <= heap[j].score) break;
        [heap[i], heap[j]] = [heap[j], heap[i]];
        i = j;
      }
    }
    return top;
  };
  const h = (p: number) =>
    Math.hypot((p % g.cols) - (end % g.cols), Math.floor(p / g.cols) - Math.floor(end / g.cols)) *
    0.8;
  cost[start] = 0;
  push(start, h(start));
  while (heap.length) {
    const { id: p, score } = pop();
    if (score > cost[p] + h(p) + 1e-8) continue;
    if (p === end) break;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const x = (p % g.cols) + dx,
          y = Math.floor(p / g.cols) + dy,
          q = y * g.cols + x;
        if (
          x < 0 ||
          y < 0 ||
          x >= g.cols ||
          y >= g.rows ||
          g.cells[q] !== '1' ||
          (dx && dy && (g.cells[p + dx] !== '1' || g.cells[p + dy * g.cols] !== '1'))
        )
          continue;
        const road =
          scene.roadCells[
            Math.floor((y * data.roads.rows) / g.rows) * data.roads.columns +
              Math.floor((x * data.roads.columns) / g.cols)
          ];
        const n = cost[p] + Math.hypot(dx, dy) * (road ? 0.8 : 2.7);
        if (n < cost[q]) {
          cost[q] = n;
          parent[q] = p;
          push(q, n + h(q));
        }
      }
  }
  if (!Number.isFinite(cost[end])) return [];
  const result: Point[] = [];
  for (let p = end; p !== -1; p = parent[p])
    result.push({
      x: (((p % g.cols) + 0.5) * g.w) / g.cols,
      y: ((Math.floor(p / g.cols) + 0.5) * g.h) / g.rows,
    });
  return result.reverse();
}
