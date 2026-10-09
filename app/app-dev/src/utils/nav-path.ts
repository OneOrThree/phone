// 타일 섬 로컬 A*: 탭(이미지 px) → 월드 → 100×100 통행 격자 → 셀 중심 월드 경로.
// 규칙 정본: docs/prd/fishcat/island-movement/high-level-design.md §3.
// 서버 Pathfinder(server/realtime …/movement/nav)와 같은 정수 연산을 같은 순서로 한다 —
// 공통 fixture docs/prd/fishcat/island-movement/fixtures/paths.json 을 양쪽 테스트가 같이 통과해야 한다.
import {
  CellIndex,
  ImageSize,
  WorldPoint,
  cellCenterToWorld,
  imageToWorld,
  isInsideWorld,
  worldToCell,
  worldToImage,
} from './worldCoords';

export type NavJson = {
  columns: number;
  rows: number;
  walkable: string;
  traversalCost: number[];
  /** 건물별 「미완공일 때만 통행」인 셀 index. walkable 은 전부 완공 기준. */
  buildingCells?: Record<string, number[]>;
  /** 간선 중점이 막혀 직교 이동이 불가한 인접 셀 쌍 [a, b] (a < b). */
  blockedEdges?: [number, number][];
};
export type NavGrid = {
  cols: number;
  rows: number;
  walkable: Uint8Array;
  cost: Uint8Array; // ×10 정수 (길 8, 잔디 27)
  blockedEdges: Set<number>; // edgeKey(a, b)
  minCostTenths: number; // 통행 셀 최소 비용 ×10 정수 (휴리스틱 계수, 길 8)
  region: Int32Array; // 연결 영역 라벨 (비통행 -1)
};
/** A* 결과. 셀은 전부 index(`cy*cols+cx`), cells 는 출발 셀을 뺀 순서, cost 는 고정소수점 정수. */
export type NavPathDetail = { start: number; goal: number; cost: number; cells: number[] };

// 근거: 기존 걷기는 16px 셀 한 칸에 95ms. 격자 셀 1칸 = 1 world unit 이므로 95ms / 1.04unit ≈ 91ms/unit.
export const MS_PER_UNIT = 91;

// 고정소수점(HLD §3.6): 월드 1 unit = SCALE. 대각 한 칸은 ceil(√2 × 10⁶) 리터럴 — sqrt 결과에 기대지 않는다.
const SCALE = 1_000_000;
const STEP_STRAIGHT = SCALE;
const STEP_DIAG = 1_414_214;
// 값이 2^53 보다 한참 작은 음 아닌 정수라 double 나눗셈 + floor 가 정수 나눗셈과 같다(서버는 long 나눗셈).
const ceilDiv10 = (a: number) => Math.floor((a + 9) / 10);

const edgeKey = (a: number, b: number, n: number) => (a < b ? a * n + b : b * n + a);
const idx = (g: NavGrid, cx: number, cy: number) => cy * g.cols + cx;
const dist = (a: WorldPoint, b: WorldPoint) => Math.hypot(a.x - b.x, a.y - b.y);
// 이웃 순서 (-1,-1) (0,-1) (1,-1) (-1,0) (1,0) (-1,1) (0,1) (1,1) — 서버와 같게 둔다(계약 §1).
// 결과는 이 순서에 기대지 않는다: 꺼내는 순서는 항목마다 유일한 (f, h, index) 가 정한다.
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
  if ((!dx || !dy) && g.blockedEdges.has(edgeKey(p, q, g.walkable.length))) return -1;
  if (dx && dy && (!g.walkable[idx(g, x, y - dy)] || !g.walkable[idx(g, x - dx, y)])) return -1;
  return q;
}

const cache = new WeakMap<NavJson, Map<string, NavGrid>>();
// completedBuildings: 완공된 건물 id. buildingCells 중 완공되지 않은 건물의 셀을 통행으로 켠다(없으면 전부 완공 기준).
export function loadNav(nav: NavJson, completedBuildings?: readonly string[]): NavGrid {
  const key = completedBuildings ? [...completedBuildings].sort().join(',') : '*';
  const byKey = cache.get(nav) ?? new Map<string, NavGrid>();
  cache.set(nav, byKey);
  const hit = byKey.get(key);
  if (hit) return hit;
  const { columns, rows } = nav;
  if (!Number.isInteger(columns) || columns <= 0)
    throw new Error(`nav.columns 는 양의 정수여야 한다: ${columns}`);
  if (!Number.isInteger(rows) || rows <= 0)
    throw new Error(`nav.rows 는 양의 정수여야 한다: ${rows}`);
  const n = columns * rows;
  if (nav.walkable.length !== n)
    throw new Error(`nav.walkable 길이 ${nav.walkable.length} != columns*rows ${n}`);
  if (nav.traversalCost.length !== n)
    throw new Error(`nav.traversalCost 길이 ${nav.traversalCost.length} != columns*rows ${n}`);
  // 미완공 건물 자리가 켜질 수 있어 차단 셀도 비용이 있어야 한다.
  for (let i = 0; i < n; i++)
    if (!(nav.traversalCost[i] > 0))
      throw new Error(`nav.traversalCost[${i}] 가 ${nav.traversalCost[i]} (0 이하 불가)`);
  const walkable = new Uint8Array(n),
    cost = new Uint8Array(n);
  let min = Infinity;
  for (let i = 0; i < n; i++) {
    walkable[i] = nav.walkable[i] === '1' ? 1 : 0;
    cost[i] = nav.traversalCost[i];
  }
  if (completedBuildings)
    for (const [b, cells] of Object.entries(nav.buildingCells ?? {}))
      if (!completedBuildings.includes(b)) for (const c of cells) walkable[c] = 1;
  for (let i = 0; i < n; i++) if (walkable[i]) min = Math.min(min, cost[i]);
  const g: NavGrid = {
    cols: nav.columns,
    rows: nav.rows,
    walkable,
    cost,
    blockedEdges: new Set((nav.blockedEdges ?? []).map(([a, b]) => edgeKey(a, b, n))),
    minCostTenths: Number.isFinite(min) ? min : 10,
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
  byKey.set(key, g);
  return g;
}

// 영역(region, -1 이면 전체 통행 셀) 안에서 p 에 월드 거리가 가장 가까운 통행 셀. 동률은 index 작은 쪽.
function nearestCell(g: NavGrid, p: WorldPoint, region: number): number {
  let best = -1,
    bestD = Infinity;
  for (let i = 0; i < g.walkable.length; i++) {
    if (!g.walkable[i] || (region >= 0 && g.region[i] !== region)) continue;
    // 루프 안 객체 할당을 피한다 — 셀 중심(cx+0.5, cy+0.5, cellCenterToWorld 와 동일)을 직접 계산해 index 로 비교한다.
    // 제곱 거리로 비교한다: hypot 은 엔진(V8·JVM)마다 마지막 비트가 다를 수 있지만 뺄셈·곱셈·덧셈은 IEEE 로 같다.
    const dx = p.x - ((i % g.cols) + 0.5),
      dy = p.y - (Math.floor(i / g.cols) + 0.5);
    const d = dx * dx + dy * dy;
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
// 출발 셀 index 도 함께 돌려 navPathDetailed 가 다시 계산하지 않게 한다.
export function resolveTarget(
  g: NavGrid,
  from: WorldPoint,
  to: WorldPoint,
): { start: number; target: CellIndex } | null {
  // 좌표 계약(HLD §2): 서버는 범위 밖 입력을 거부한다 — 앱은 탭이 이미지 안이라 실제로는 못 만들지만 계약을 맞춘다.
  if (!isInsideWorld(to)) return null;
  const s = startCell(g, from);
  if (s < 0) return null;
  const t = cellOf(worldToCell(to), g);
  const e = g.walkable[t] && g.region[t] === g.region[s] ? t : nearestCell(g, to, g.region[s]);
  return e < 0 ? null : { start: s, target: { cx: e % g.cols, cy: Math.floor(e / g.cols) } };
}

// 규칙 ⑤⑥: 8방향 A*, 비용은 전부 정수(고정소수점).
//   edge = ceil(step × cost[q] / 10)       step = 직교 10⁶ · 대각 1,414,214, cost = 대상 셀 ×10
//   h    = floor(floor(√(dx²+dy²) × 10⁶) × minCost / 10)   — sqrt·곱·floor 만 double(IEEE 로 엔진 무관)
// 우선순위 (f, h, index) 오름차순, 개선은 strict < (같은 비용이면 먼저 찾은 부모 유지).
// 출발 보정 실패·도달 불가면 null, 같은 셀이면 cells 가 빈 결과.
export function navPathDetailed(
  g: NavGrid,
  from: WorldPoint,
  to: WorldPoint,
): NavPathDetail | null {
  const r = resolveTarget(g, from, to);
  if (!r) return null;
  const s = r.start,
    e = cellOf(r.target, g);
  if (s === e) return { start: s, goal: e, cost: 0, cells: [] };
  const gx = e % g.cols,
    gy = Math.floor(e / g.cols);
  const h = (p: number) => {
    const dx = (p % g.cols) - gx,
      dy = Math.floor(p / g.cols) - gy;
    return Math.floor((Math.floor(Math.sqrt(dx * dx + dy * dy) * SCALE) * g.minCostTenths) / 10);
  };
  // 정수만 담는다(최대 경로 비용도 2^53 아래) — Float64Array 는 Infinity 초기값 때문에 쓴다.
  const best = new Float64Array(g.walkable.length).fill(Infinity),
    parent = new Int32Array(g.walkable.length).fill(-1);
  type Node = { f: number; h: number; id: number };
  // 같은 셀은 더 작은 f 로만 다시 들어가 (f, h, id) 가 항목마다 유일하다 — 어떤 우선순위 큐든 꺼내는 순서가 같다.
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
  const hs = h(s);
  push({ f: hs, h: hs, id: s });
  while (heap.length) {
    const { f, h: hp, id: p } = pop();
    if (f > best[p] + hp) continue; // 낡은 항목
    if (p === e) break;
    for (const [dx, dy] of DIRS) {
      const q = neighbor(g, p, dx, dy);
      if (q < 0) continue;
      const c = best[p] + ceilDiv10((dx && dy ? STEP_DIAG : STEP_STRAIGHT) * g.cost[q]);
      if (c < best[q]) {
        best[q] = c;
        parent[q] = p;
        const hq = h(q);
        push({ f: c + hq, h: hq, id: q });
      }
    }
  }
  if (parent[e] < 0) return null;
  const cells: number[] = [];
  for (let p = e; p !== s; p = parent[p]) cells.push(p);
  return { start: s, goal: e, cost: best[e], cells: cells.reverse() };
}

// 출발 셀을 뺀 셀 중심(월드) 경로. 같은 셀·도달 불가는 [].
export function navPath(g: NavGrid, from: WorldPoint, to: WorldPoint): WorldPoint[] {
  const d = navPathDetailed(g, from, to);
  if (!d) return [];
  return d.cells.map((p) => cellCenterToWorld({ cx: p % g.cols, cy: Math.floor(p / g.cols) }));
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
  const d = navPathDetailed(g, imageToWorld(from, size), imageToWorld(to, size));
  if (!d) return [];
  const toImage = (p: number) =>
    worldToImage(cellCenterToWorld({ cx: p % g.cols, cy: Math.floor(p / g.cols) }), size);
  return [from, ...d.cells.map(toImage)];
}
