import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getMyTier, getMySchedule } from '@/services/leagueApi';
import type { LeagueTierResponse } from '@/types/api';
import { MY_TIER } from './mock';

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
// 실패/게스트/미배정 시 mock 티어·null 마감으로 폴백(화면은 mock 라벨 유지).
// 랭킹 리스트는 별도(useLeagueRanking) — 백엔드 응답 필드 확정 전까지 mock.
export function useLeagueMeta() {
  const [tier, setTier] = useState<LeagueTierResponse>(MY_TIER);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  // 화면 포커스마다 서버에서 티어·마감 재조회.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const [t, sch] = await Promise.all([getMyTier(), getMySchedule()]);
          if (cancelled) return;
          if (t.assigned) setTier(t);
          setRemainingSeconds(sch.remainingSeconds);
        } catch {
          // 네트워크/인증 실패·미배정 → mock 티어·null 마감 유지
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
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

  return { tier, remainingSeconds, deadlineLabel };
}
