/**
 * 전망대 주간 섬 랭킹 view model (GROMO-2018).
 *
 * 정본은 `GET /rankings/islands?week=<UTC 일요일>` — 로컬 `state.islands` 의 예시 섬·
 * `islandWeeklyAverage` 합산·`n+1` 고정 순위를 쓰지 않는다. 서버가 준 `rank`(동점 공동 순위),
 * `myRank`(전체 모집단 기준, 미참가 null), `asOf`(집계 관측 시각)를 그대로 쓴다.
 * 요청 주는 지금 속한 주의 UTC 일요일 시작일이다.
 *
 * 실패를 빈 순위로 접지 않고 error+retry 로 돌려준다 — `items:[]` 는 「그 주에 순위에 오른
 * 섬이 없다」는 뜻이지 「못 읽었다」가 아니다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/services/api/client';
import { sessionGeneration } from '@/services/api/session';
import { getIslandRankings, utcWeekStart, type IslandRankings } from '@/services/api/rankings';

export interface IslandRankingsState {
  status: 'loading' | 'ready' | 'error';
  error: ApiError | null;
  data: IslandRankings | null;
  /** 요청한 주 시작일(UTC 일요일 `YYYY-MM-DD`). */
  week: string;
  retry: () => void;
}

export function useIslandRankings({ active }: { active: boolean }): IslandRankingsState {
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [data, setData] = useState<IslandRankings | null>(null);
  const [week, setWeek] = useState(() => utcWeekStart());
  const req = useRef(0);
  const lastRequestedWeek = useRef<string | null>(null);
  const session = sessionGeneration();
  const lastRequestedSession = useRef(session);

  useEffect(() => {
    if (!active) {
      req.current += 1;
      return;
    }
    const gen = ++req.current;
    const stale = () => gen !== req.current || session !== sessionGeneration();
    const currentWeek = utcWeekStart();
    const crossedWeekBoundary =
      lastRequestedWeek.current !== null && lastRequestedWeek.current !== currentWeek;
    const changedSession = lastRequestedSession.current !== session;
    lastRequestedWeek.current = currentWeek;
    lastRequestedSession.current = session;
    setWeek(currentWeek);
    // 같은 세션·주 안의 갱신만 직전 결과를 유지한다. 주/세션 경계에선 오래된 정본을 비운다.
    if (crossedWeekBoundary || changedSession) {
      setData(null);
      setStatus('loading');
    } else {
      setStatus((current) => (current === 'ready' ? 'ready' : 'loading'));
    }
    setError(null);
    getIslandRankings({ week: currentWeek })
      .then((rankings) => {
        if (stale()) return;
        setData(rankings);
        setStatus('ready');
      })
      .catch((thrown) => {
        if (stale()) return;
        setError(thrown as ApiError);
        setStatus((current) => (current === 'ready' ? 'ready' : 'error'));
      });
    return () => {
      req.current += 1;
    };
  }, [active, nonce, session]);

  // 홈을 계속 열어 둔 동안 다른 섬의 집중 기록으로 순위가 바뀔 수 있으므로 주기적으로
  // 서버 정본을 새로 읽는다. UTC 주 경계도 같은 갱신으로 처리된다.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNonce((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, [active]);

  return {
    status,
    error,
    data,
    week,
    retry: useCallback(() => setNonce((n) => n + 1), []),
  };
}
