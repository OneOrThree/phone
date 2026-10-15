export type Point = { x: number; y: number };
export type Grid = {
  w: number;
  h: number;
  cols: number;
  rows: number;
  cells: string;
};
const cell = (g: Grid, p: Point) =>
  Math.floor((p.y / g.h) * g.rows) * g.cols + Math.floor((p.x / g.w) * g.cols);
export function onLand(g: Grid, p: Point) {
  return p.x >= 0 && p.y >= 0 && p.x < g.w && p.y < g.h && g.cells[cell(g, p)] === '1';
}
const point = (g: Grid, c: number): Point => ({
  x: (((c % g.cols) + 0.5) * g.w) / g.cols,
  y: ((Math.floor(c / g.cols) + 0.5) * g.h) / g.rows,
});
export function nearestLand(g: Grid, p: Point): Point {
  let best = p,
    min = Infinity;
  for (let c = 0; c < g.cells.length; c++)
    if (g.cells[c] === '1') {
      const n = point(g, c),
        d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
      if (d < min) {
        min = d;
        best = n;
      }
    }
  return best;
}
// Four-neighbour traversal cannot cut across water, trees, or the corner of a building.
export function landPath(g: Grid, from: Point, to: Point): Point[] {
  if (!onLand(g, to)) return [];
  const start = cell(g, nearestLand(g, from)),
    end = cell(g, to),
    queue = [start],
    prev = new Map<number, number>([[start, -1]]);
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    if (c === end) break;
    const x = c % g.cols,
      y = Math.floor(c / g.cols);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy,
        n = ny * g.cols + nx;
      if (nx < 0 || ny < 0 || nx >= g.cols || ny >= g.rows || g.cells[n] !== '1' || prev.has(n))
        continue;
      prev.set(n, c);
      queue.push(n);
    }
  }
  if (!prev.has(end)) return [];
  const cells = [];
  for (let c = end; c !== -1; c = prev.get(c)!) cells.push(c);
  return cells.reverse().map((c) => point(g, c));
}
