// 타일 섬 로컬 A*: 탭(이미지 px) → 월드 → 100×100 통행 격자 → 셀 중심 월드 경로.
// 규칙 정본: docs/prd/fishcat/island-movement/high-level-design.md §3.
import {
  CellIndex,
  ImageSize,
  WorldPoint,
  cellCenterToWorld,
  imageToWorld,
  worldToCell,
  worldToImage,
} from './worldCoords';

export type NavJson = { columns: number; rows: number; walkable: string; traversalCost: number[] };
export type NavGrid = {
  cols: number;
  rows: number;
  walkable: Uint8Array;
  cost: Uint8Array; // ×10 정수 (길 8, 잔디 27, 차단 0)
  minCost: number; // 통행 셀 최소 비용 (휴리스틱 계수, 8/10)
  region: Int32Array; // 연결 영역 라벨 (비통행 -1)
};

// 근거: 기존 걷기는 16px 셀 한 칸에 95ms. 격자 셀 1칸 = 1 world unit 이므로 95ms / 1.04unit ≈ 91ms/unit.
export const MS_PER_UNIT = 91;

const idx = (g: NavGrid, cx: number, cy: number) => cy * g.cols + cx;
const dist = (a: WorldPoint, b: WorldPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const DIRS = [-1, 0, 1]
  .flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy]))
  .filter(([dx, dy]) => dx || dy);

// 이웃 셀 번호 (없으면 -1). 대각은 양옆 직교 셀이 모두 통행 가능할 때만(규칙 ⑤).
function neighbor(g: NavGrid, p: number, dx: number, dy: number) {
  const x = (p % g.cols) + dx,
    y = Math.floor(p / g.cols) + dy;
  if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) return -1;
  const q = idx(g, x, y);
  if (!g.walkable[q]) return -1;
  if (dx && dy && (!g.walkable[idx(g, x, y - dy)] || !g.walkable[idx(g, x - dx, y)])) return -1;
  return q;
}

const cache = new WeakMap<NavJson, NavGrid>();
export function loadNav(nav: NavJson): NavGrid {
  const hit = cache.get(nav);
  if (hit) return hit;
  const n = nav.columns * nav.rows;
  const walkable = new Uint8Array(n),
    cost = new Uint8Array(n);
  let min = Infinity;
  for (let i = 0; i < n; i++) {
    walkable[i] = nav.walkable[i] === '1' ? 1 : 0;
    cost[i] = walkable[i] ? nav.traversalCost[i] : 0;
    if (cost[i] > 0) min = Math.min(min, cost[i]);
  }
  const g: NavGrid = {
    cols: nav.columns,
    rows: nav.rows,
    walkable,
    cost,
    minCost: (Number.isFinite(min) ? min : 10) / 10,
    region: new Int32Array(n).fill(-1),
  };
  let label = 0;
  for (let s = 0; s < n; s++) {
    if (!walkable[s] || g.region[s] >= 0) continue;
    g.region[s] = label;
    const queue = [s];
    for (let h = 0; h < queue.length; h++)
      for (const [dx, dy] of DIRS) {
        const q = neighbor(g, queue[h], dx, dy);
        if (q >= 0 && g.region[q] < 0) {
          g.region[q] = label;
          queue.push(q);
        }
      }
    label++;
  }
  cache.set(nav, g);
  return g;
}

// 영역(region, -1 이면 전체 통행 셀) 안에서 p 에 월드 거리가 가장 가까운 통행 셀. 동률은 index 작은 쪽.
function nearestCell(g: NavGrid, p: WorldPoint, region: number): number {
  let best = -1,
    bestD = Infinity;
  for (let i = 0; i < g.walkable.length; i++) {
    if (!g.walkable[i] || (region >= 0 && g.region[i] !== region)) continue;
    const d = dist(p, cellCenterToWorld({ cx: i % g.cols, cy: Math.floor(i / g.cols) }));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const cellOf = (c: CellIndex, g: NavGrid) => idx(g, c.cx, c.cy);
const startCell = (g: NavGrid, from: WorldPoint) => {
  const i = cellOf(worldToCell(from), g);
  return g.walkable[i] ? i : nearestCell(g, from, -1);
};

// 규칙 ③: 목적지 셀이 출발 영역 밖이면 출발 영역 안의 최근접 통행 셀로 보정.
// 출발 셀 index 도 함께 돌려 navPath 가 다시 계산하지 않게 한다.
export function resolveTarget(
  g: NavGrid,
  from: WorldPoint,
  to: WorldPoint,
): { start: number; target: CellIndex } | null {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return null;
  const s = startCell(g, from);
  if (s < 0) return null;
  const t = cellOf(worldToCell(to), g);
  const e = g.walkable[t] && g.region[t] === g.region[s] ? t : nearestCell(g, to, g.region[s]);
  return e < 0 ? null : { start: s, target: { cx: e % g.cols, cy: Math.floor(e / g.cols) } };
}

// 규칙 ⑤⑥: 8방향 A*. edge = 월드 거리 × 대상 셀 비용/10, h = 월드 직선 거리 × minCost. 동률 (f, h, index).
export function navPath(g: NavGrid, from: WorldPoint, to: WorldPoint): WorldPoint[] {
  const r = resolveTarget(g, from, to);
  if (!r) return [];
  const s = r.start,
    e = cellOf(r.target, g);
  if (s === e) return [];
  const gx = e % g.cols,
    gy = Math.floor(e / g.cols);
  const h = (p: number) => Math.hypot((p % g.cols) - gx, Math.floor(p / g.cols) - gy) * g.minCost;
  const best = new Float64Array(g.walkable.length).fill(Infinity),
    parent = new Int32Array(g.walkable.length).fill(-1);
  type Node = { f: number; h: number; id: number };
  // 동률 비교가 부동소수 동치(a.f - b.f)에 기댄다. 지금은 클라이언트 단독이라 유지하지만,
  // 서버 A* 와 비트 단위 일치가 필요해지면 고정소수점(HLD §3 초안 10⁶)으로 비교·연산 순서를 fixture 로 고정한다.
  const less = (a: Node, b: Node) => a.f - b.f || a.h - b.h || a.id - b.id;
  const heap: Node[] = [];
  const push = (n: Node) => {
    heap.push(n);
    let i = heap.length - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (less(heap[p], n) <= 0) break;
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
      for (;;) {
        let j = i * 2 + 1;
        if (j >= heap.length) break;
        if (j + 1 < heap.length && less(heap[j + 1], heap[j]) < 0) j++;
        if (less(heap[i], heap[j]) <= 0) break;
        [heap[i], heap[j]] = [heap[j], heap[i]];
        i = j;
      }
    }
    return top;
  };
  best[s] = 0;
  push({ f: h(s), h: h(s), id: s });
  while (heap.length) {
    const { f, id: p } = pop();
    if (f > best[p] + h(p) + 1e-9) continue; // 낡은 항목
    if (p === e) break;
    for (const [dx, dy] of DIRS) {
      const q = neighbor(g, p, dx, dy);
      if (q < 0) continue;
      const c = best[p] + Math.hypot(dx, dy) * (g.cost[q] / 10);
      if (c < best[q]) {
        best[q] = c;
        parent[q] = p;
        push({ f: c + h(q), h: h(q), id: q });
      }
    }
  }
  if (parent[e] < 0) return [];
  const out: WorldPoint[] = [];
  for (let p = e; p !== s; p = parent[p])
    out.push(cellCenterToWorld({ cx: p % g.cols, cy: Math.floor(p / g.cols) }));
  return out.reverse();
}

// Pressable 의 locationX/Y(웹은 clientX - rect.left) = 확대된 이미지 위 px → 이미지 px → 월드.
export function tapToWorld(
  tap: { locationX: number; locationY: number },
  view: { scale: number } & ImageSize,
): WorldPoint {
  return imageToWorld({ x: tap.locationX / view.scale, y: tap.locationY / view.scale }, view);
}

// 속도는 지형 비용과 무관하다(길을 더 빨리 걷지 않음) — 의도.
// 속도는 world unit/초 기준(가로·세로 동일, 대각은 √2). 화면 px 비율 보정은 하지 않는다(결정 2026-10-08 A).
export const stepDurationMs = (a: WorldPoint, b: WorldPoint, msPerUnit = MS_PER_UNIT) =>
  dist(a, b) * msPerUnit;

// 이미지 px 경로(출발점 포함). 같은 셀이면 [from] 이라 walk 의 done 이 불린다. 도달 불가는 [] (기존 villagePath 와 동일).
export function tilePath(
  g: NavGrid,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: ImageSize,
): { x: number; y: number }[] {
  const wf = imageToWorld(from, size),
    wt = imageToWorld(to, size);
  const nodes = navPath(g, wf, wt);
  if (nodes.length) return [from, ...nodes.map((n) => worldToImage(n, size))];
  const r = resolveTarget(g, wf, wt);
  return r && r.start === cellOf(r.target, g) ? [from] : [];
}
