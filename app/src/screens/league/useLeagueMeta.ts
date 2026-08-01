import { useCallback, useEffect, useRef, useState } from 'react';
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

// 초 → "마감 N일 HH:MM" (주간 정산 마감 카운트다운 라벨).
function fmtDeadline(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  return d > 0 ? `마감 ${d}일 ${hh}:${mm}` : `마감 ${hh}:${mm}`;
}

// 리그 메타(내 티어 + 마감 스케줄) 실 API 조회 — GROMO-538.
//   티어 : GET /api/v1/league/me/tier
//   마감 : GET /api/v1/league/me/schedule (remainingSeconds → 1초 로컬 카운트다운)
// 실패/게스트/미배정 시 중립 티어·null 마감 유지(mock 폴백 없음).
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

  // 마감 1초 카운트다운 — 서버 remainingSeconds 확보 후 로컬 감소.
  const hasDeadline = remainingSeconds != null;
  useEffect(() => {
    if (!hasDeadline) return;
    const id = setInterval(() => {
      setRemainingSeconds((s) => (s == null ? s : Math.max(0, s - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [hasDeadline]);

  const deadlineLabel = remainingSeconds != null ? fmtDeadline(remainingSeconds) : null;

  return { tier, remainingSeconds, deadlineLabel, refetch };
}
