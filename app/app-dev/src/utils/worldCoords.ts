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

// 입력 계약: 모든 숫자는 유한값. 제스처 중 scale=0 같은 순간값이 와도 앱이 죽지 않도록
// 유한하지 않은 결과(NaN·±Infinity)는 throw 하지 않고 0 으로 clamp 한다.
const finite = (v: number) => (Number.isFinite(v) ? v : 0);
export const screenToImage = (p: ScreenPoint, v: ViewTransform): ImagePoint => ({
  x: finite((p.x - v.offsetX) / v.scale),
  y: finite((p.y - v.offsetY) / v.scale),
});
export const imageToWorld = (p: ImagePoint, s: ImageSize): WorldPoint => ({
  x: p.x / (s.imageWidth / WORLD_SIZE),
  y: p.y / (s.imageHeight / WORLD_SIZE),
});
export const worldToImage = (p: WorldPoint, s: ImageSize): ImagePoint => ({
  x: p.x * (s.imageWidth / WORLD_SIZE),
  y: p.y * (s.imageHeight / WORLD_SIZE),
});
// NaN·±Infinity 는 0 으로 보내 「차단 셀」로 조용히 흐르지 않게 한다(입력 계약: 유한값).
const cell = (v: number) => Math.max(0, Math.min(WORLD_SIZE - 1, Math.floor(finite(v))));
export const worldToCell = (p: WorldPoint): CellIndex => ({ cx: cell(p.x), cy: cell(p.y) });
export const cellCenterToWorld = (c: CellIndex): WorldPoint => ({ x: c.cx + 0.5, y: c.cy + 0.5 });
const wire = (v: number) => Math.max(0, Math.min(WORLD_SIZE * 100, Math.round(finite(v) * 100)));
export const worldToWire = (p: WorldPoint): WirePoint => ({ x: wire(p.x), y: wire(p.y) });
export const wireToWorld = (p: WirePoint): WorldPoint => ({ x: p.x / 100, y: p.y / 100 });
