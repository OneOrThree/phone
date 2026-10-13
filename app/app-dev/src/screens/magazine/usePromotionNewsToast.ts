import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from '@/i18n';
import { magazineApi } from './usePromotionEditor';

const DAY = 86_400_000;
export const newsSeenKey = (islandId: string) => `islandNewsSeen:${islandId}`;

/**
 * 주민 소식 토스트(C3) — 섬 홈에 들어올 때 섬 소식을 읽어, 이 기기에서 아직 안 본 가장 최근 홍보 소식(PROMOTION, 하루 안)이
 * 있으면 한 번 알린다. 문구는 서버 body(한국어 고정)가 아니라 kind 로 앱이 고른다. 섬장 본인은 접수 완료(C2)를 이미 봐서,
 * 방문자는 소식이 주민 전용(403)이라 부르지 않는다 — active 로 막는다. 「본 소식」은 기기에만 둔다(다른 기기에서 또 볼 수 있다).
 */
export function usePromotionNewsToast({
  active,
  islandId,
  notify,
  now = Date.now,
}: {
  active: boolean;
  islandId: string | null;
  notify: (message: string) => void;
  now?: () => number;
}) {
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const nowRef = useRef(now);
  nowRef.current = now;
  useEffect(() => {
    if (!active || !islandId) return;
    let alive = true;
    (async () => {
      try {
        const items = await magazineApi().getIslandNews(islandId, 5);
        const news = items.find((item) => item.kind === 'PROMOTION');
        if (!alive || !news || nowRef.current() - Date.parse(news.createdAt) > DAY) return;
        const seen = await AsyncStorage.getItem(newsSeenKey(islandId)).catch(() => null);
        if (!alive || seen === news.id) return;
        await AsyncStorage.setItem(newsSeenKey(islandId), news.id).catch(() => {});
        notifyRef.current(t('magazine.news.promotion'));
      } catch {
        // 소식은 덤이다 — 못 읽으면 조용히 넘어간다(홈 화면을 막지 않는다)
      }
    })();
    return () => {
      alive = false;
    };
  }, [active, islandId]);
}
