import type { IslandLayout } from '@/services/api/home';
import mapMeta from '@/assets/village-world/v1/home.map.json';
import { cellCenterToWorld, worldToImage } from './worldCoords';

/**
 * 서버 배치(layout.buildings[].cell)가 있으면 해당 건물 오브젝트의 발밑 x·y 를 셀 중심 px 로 덮어쓴다.
 * layout 이 없거나 건물이 없으면 입력 배열을 그대로(같은 참조) 돌려준다 — 구서버와 동작 차이 0.
 */
export function applyLayout<T extends { building?: string | null; x: number; y: number }>(
  objects: T[],
  layout: IslandLayout | undefined,
): T[] {
  if (!layout?.buildings?.length) return objects;
  const cells = new Map(layout.buildings.map((b) => [b.id as string, b.cell]));
  return objects.map((o) => {
    const cell = o.building ? cells.get(o.building) : undefined;
    if (!cell) return o;
    const p = worldToImage(cellCenterToWorld({ cx: cell.x, cy: cell.y }), mapMeta);
    return { ...o, x: p.x, y: p.y };
  });
}
