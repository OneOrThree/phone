import { useEffect, useState } from 'react';
import type { IslandNewsItem } from '@/services/api/magazine';
import { magazineApi } from './usePromotionEditor';

/**
 * 마을회관 「섬 소식」 목록(GROMO-2282) — 서버가 최신순(createdAt desc·id desc)으로 준 순서를 그대로 쓴다(앱 재정렬 없음).
 * - 서버 kind 는 열린 문자열이라 앱이 그릴 줄 아는 PROMOTION 만 남기고 나머지는 건너뛴다.
 *   `===` 로만 비교한다 — 맵 조회는 `constructor` 같은 kind 가 통과한다.
 * - 비주민·떠난 주민의 403 FORBIDDEN(소식은 주민 전용)이나 그 밖의 실패는 빈 목록으로 두어 칸을 숨긴다(재시도 UI 없음).
 * - 홈 토스트(usePromotionNewsToast)의 「본 소식」 저장 키는 읽지도 쓰지도 않는다.
 */
export function useIslandNews(active: boolean, islandId: string | null): IslandNewsItem[] {
  const [items, setItems] = useState<IslandNewsItem[]>([]);
  useEffect(() => {
    setItems([]);
    if (!active || !islandId) return;
    let alive = true;
    magazineApi()
      .getIslandNews(islandId, 20)
      .then((list) => {
        if (alive) setItems(list.filter((n) => n.kind === 'PROMOTION'));
      })
      .catch(() => {
        // 소식은 덤이다 — 못 읽거나 403 이면 목록은 비어 있고 섹션은 그려지지 않는다
      });
    return () => {
      alive = false;
    };
  }, [active, islandId]);
  return items;
}
