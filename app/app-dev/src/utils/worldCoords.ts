// 타일 섬 좌표 변환: 화면 → 이미지 px → 월드(0~100) → 통행 셀 → 와이어(×100 정수).
// 규칙 정본: docs/prd/fishcat/island-movement/high-level-design.md §2.
export const WORLD_SIZE = 100; // 월드 범위 [0,100]², 통행 셀도 100×100
export type ScreenPoint = { x: number; y: number };
export type ImagePoint = { x: number; y: number };
export type WorldPoint = { x: number; y: number };
export type CellIndex = { cx: number; cy: number };
export type WirePoint = { x: number; y: number };
export type ViewTransform = { offsetX: number; offsetY: number; scale: number };
export type ImageSize = { imageWidth: number; imageHeight: number };

export const screenToImage = (p: ScreenPoint, v: ViewTransform): ImagePoint => ({
  x: (p.x - v.offsetX) / v.scale,
  y: (p.y - v.offsetY) / v.scale,
});
export const imageToWorld = (p: ImagePoint, s: ImageSize): WorldPoint => ({
  x: p.x / (s.imageWidth / WORLD_SIZE),
  y: p.y / (s.imageHeight / WORLD_SIZE),
});
export const worldToImage = (p: WorldPoint, s: ImageSize): ImagePoint => ({
  x: p.x * (s.imageWidth / WORLD_SIZE),
  y: p.y * (s.imageHeight / WORLD_SIZE),
});
const cell = (v: number) => Math.max(0, Math.min(WORLD_SIZE - 1, Math.floor(v)));
export const worldToCell = (p: WorldPoint): CellIndex => ({ cx: cell(p.x), cy: cell(p.y) });
export const cellCenterToWorld = (c: CellIndex): WorldPoint => ({ x: c.cx + 0.5, y: c.cy + 0.5 });
const wire = (v: number) => Math.max(0, Math.min(WORLD_SIZE * 100, Math.round(v * 100)));
export const worldToWire = (p: WorldPoint): WirePoint => ({ x: wire(p.x), y: wire(p.y) });
export const wireToWorld = (p: WirePoint): WorldPoint => ({ x: p.x / 100, y: p.y / 100 });
