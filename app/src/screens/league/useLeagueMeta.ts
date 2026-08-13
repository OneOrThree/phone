import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getMyTier, getMySchedule } from '@/services/leagueApi';
import type { LeagueTierResponse } from '@/types/api';

// 미배정/로딩 전 중립 티어 — 서버 응답 전까지 이 값(화면은 tierLevel ?? 1로 기본 배지).
const UNASSIGNED_TIER: LeagueTierResponse = {
  assigned: false,
  tierLevel: null,
  arenaId: null,
  weekStartAt: null,
  status: null,
  badgeId: null,
};

// 리그 메타(내 티어 + 마감 스케줄) 실 API 조회 — GROMO-538.
//   티어 : GET /api/v1/league/me/tier
//   마감 : GET /api/v1/league/me/schedule (remainingSeconds)
// 실패/게스트/미배정 시 중립 티어·null 마감 유지(mock 폴백 없음).
//
// ⚠️ 마감 1초 카운트다운은 여기 두지 않는다 — 이 훅은 리그 화면 본체와 홈 탭이 함께 쓰는데,
//    틱 state를 여기 두면 두 화면 전체가 매초 리렌더된다(GROMO-1572). 틱은 라벨을 그리는
//    components/LeagueDeadline.tsx 안에 갇혀 있고, 이 훅은 서버가 준 remainingSeconds만 넘긴다.
export function useLeagueMeta() {
  const [tier, setTier] = useState<LeagueTierResponse>(UNASSIGNED_TIER);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  // 요청 시퀀스 — 당겨서 새로고침(GROMO-887)과 포커스 재조회가 겹칠 때, 늦게 온 이전 응답이
  // 최신 상태를 덮지 않게 최신 요청만 반영한다(useFriends 패턴).
  const requestSeqRef = useRef(0);

  // 티어·마감 재조회 — 포커스 effect와 당겨서 새로고침(GROMO-887)이 공유한다.
  const refetch = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    try {
      const [t, sch] = await Promise.all([getMyTier(), getMySchedule()]);
      // 이 응답을 기다리는 동안 더 새로운 요청이 시작됐으면 stale 결과라 버린다
      if (seq !== requestSeqRef.current) return;
      if (t.assigned) setTier(t);
      setRemainingSeconds(sch.remainingSeconds);
    } catch {
      // 네트워크/인증 실패·미배정 → 중립 티어·null 마감 유지
    }
  }, []);

  // 화면 포커스마다 서버에서 티어·마감 재조회.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  return { tier, remainingSeconds, refetch };
}
