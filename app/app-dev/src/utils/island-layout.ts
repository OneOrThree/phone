import type { BuildingId, IslandLayout } from '@/services/api/home';
import bundledMapMeta from '@/assets/village-world/v1/home.map.json';
import placement from '@/assets/backgrounds/island/placement.json';
import { type MapAssetSource, readMapJson } from '@/services/mapAssets';
import { cellCenterToWorld, worldToImage } from './worldCoords';

/** 알 수 없는 스키마·맵·범위 밖 셀이면 서버 배치를 무시한다(구서버 호환 — 동작 차이 0). */
function usableLayout(layout: IslandLayout | undefined): layout is IslandLayout {
  const inRange = (n: number) => Number.isInteger(n) && n >= 0 && n <= 99;
  return (
    !!layout?.buildings?.length &&
    layout.schemaVersion === 1 &&
    layout.mapId === 'home' &&
    layout.buildings.every((b) => inRange(b.cell?.x) && inRange(b.cell?.y))
  );
}

/**
 * 서버 배치(layout.buildings[].cell)가 있으면 해당 건물 오브젝트의 발밑 x·y 를 셀 중심 px 로 덮어쓴다.
 * layout 이 없거나 건물이 없으면 입력 배열을 그대로(같은 참조) 돌려준다 — 구서버와 동작 차이 0.
 */
export function applyLayout<T extends { building?: string | null; x: number; y: number }>(
  objects: T[],
  layout: IslandLayout | undefined,
  assets: MapAssetSource,
): T[] {
  // 새 마을 미리보기(map.json) 오브젝트용. templateVersion 2 행은 기존 마을 좌표라 새 마을에 덮어쓰면 엉뚱한 곳에 그린다.
  if (!usableLayout(layout) || layout.templateVersion === LEGACY_VILLAGE_TEMPLATE_VERSION)
    return objects;
  const mapMeta = readMapJson('home.map.json', bundledMapMeta, assets); // 화면 스냅샷이 cache 면 캐시본(GROMO-2233)
  const cells = new Map(layout.buildings.map((b) => [b.id as string, b.cell]));
  return objects.map((o) => {
    const cell = o.building ? cells.get(o.building) : undefined;
    if (!cell) return o;
    const p = worldToImage(cellCenterToWorld({ cx: cell.x, cy: cell.y }), mapMeta);
    return { ...o, x: p.x, y: p.y };
  });
}

// 기존 마을 건물 ↔ placement.json 시설 id.
const PLACEMENT_ID: Record<BuildingId, string> = {
  hall: 'town-hall',
  board: 'noticeboard',
  gram: 'gramophone',
  library: 'library',
  mail: 'mailbox',
  tower: 'observatory',
  shop: 'shop',
};
const [CANVAS_W, CANVAS_H] = placement.canvas;
const cellCenterPx = (c: { x: number; y: number }) => ({
  x: ((c.x + 0.5) * CANVAS_W) / 100,
  y: ((c.y + 0.5) * CANVAS_H) / 100,
});

/**
 * 기존 마을 서버 기본 템플릿 세대. 이 키가 없는 구 `island_layouts` 행은 새 마을(map.json) 템플릿의
 * 셀 좌표를 담고 있어 기존 마을에 적용하면 건물이 엉뚱하게 밀린다 — 일치할 때만 적용한다.
 */
export const LEGACY_VILLAGE_TEMPLATE_VERSION = 2;

/**
 * 타일 섬(기존 마을)용 — 서버 배치를 건물별 평행이동(이미지 px)으로 바꾼다. 건물 레이어가 전체 캔버스
 * 이미지라 자르지 않고 통째로 옮긴다. 기본 셀은 서버 기본 템플릿과 같은 식(placement rect 의 발밑
 * bottom-center → 100×100 셀)이라 기본 배치면 모든 값이 정확히 0 이다.
 * 쓸 수 없는 layout 이면 빈 객체(= 전부 0).
 */
export function legacyLayoutOffsets(
  layout: IslandLayout | undefined,
): Partial<Record<BuildingId, { x: number; y: number }>> {
  if (!usableLayout(layout) || layout.templateVersion !== LEGACY_VILLAGE_TEMPLATE_VERSION)
    return {};
  const out: Partial<Record<BuildingId, { x: number; y: number }>> = {};
  for (const b of layout.buildings) {
    const rect = placement.assets.find((a) => a.id === PLACEMENT_ID[b.id])?.rect;
    if (!rect) continue;
    const [x, y, w, h] = rect;
    const from = cellCenterPx({
      x: Math.floor(((x + w / 2) * 100) / CANVAS_W),
      y: Math.floor(((y + h) * 100) / CANVAS_H),
    });
    const to = cellCenterPx(b.cell);
    out[b.id] = { x: to.x - from.x, y: to.y - from.y };
  }
  return out;
}
