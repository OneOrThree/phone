import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from '@/i18n';
import { magazineApi } from './usePromotionEditor';

const HOUR = 3_600_000;
const KST = 9 * HOUR;
export const newsSeenKey = (islandId: string) => `islandNewsSeen:${islandId}`;

/**
 * 홍보 소식 문구 키 — 그 홍보가 실릴 호의 발행(신청한 KST 날짜 다음 날 07시) 전이면 문구, 이미 나왔으면 null.
 * 같은 KST 날짜면 「오늘 … 내일 아침」, 자정이 지난 00~07시면 「어제 … 오늘 아침」.
 */
export function promotionNewsKey(createdAt: string, now: number): string | null {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return null;
  const day = (t: number) => Math.floor((t + KST) / (24 * HOUR));
  const publishAt = (day(created) + 1) * 24 * HOUR - KST + 7 * HOUR;
  if (now >= publishAt) return null;
  return day(now) === day(created) ? 'magazine.news.promotion' : 'magazine.news.promotionYesterday';
}

/**
 * 주민 소식 토스트(C3) — 섬 홈에 들어올 때 섬 소식을 읽어, 이 기기에서 아직 안 본 가장 최근 홍보 소식(PROMOTION, 그 호 발행 전)이
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
        const key = news && promotionNewsKey(news.createdAt, nowRef.current());
        if (!alive || !news || !key) return;
        const seen = await AsyncStorage.getItem(newsSeenKey(islandId)).catch(() => null);
        if (!alive || seen === news.id) return;
        // 띄운 뒤에 본 것으로 적는다 — 기다리는 사이 홈을 떠나면 띄우지도, 본 것으로 적지도 않는다
        notifyRef.current(t(key));
        await AsyncStorage.setItem(newsSeenKey(islandId), news.id).catch(() => {});
      } catch {
        // 소식은 덤이다 — 못 읽으면 조용히 넘어간다(홈 화면을 막지 않는다)
      }
    })();
    return () => {
      alive = false;
    };
  }, [active, islandId]);
}
