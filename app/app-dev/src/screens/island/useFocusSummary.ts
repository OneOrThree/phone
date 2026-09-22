/**
 * 오늘의 집중 요약 훅 (GROMO-2018) — `GET /me/focus-summary`.
 *
 * 서버 모드 홈·사운드 시트의 「오늘 집중」은 이 응답이 정본이다 — 로컬 records 합산으로
 * 지어내지 않는다. 실패를 빈 값으로 접지 않고, 세대/세션 가드로 늦은 응답을 버린다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/services/api/client';
import { getFocusSummary, type FocusSummary } from '@/services/api/home';
import { sessionGeneration } from '@/services/api/session';

export interface FocusSummaryState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: FocusSummary | null;
  error: ApiError | null;
  retry: () => void;
}

// 앱 전역이 Asia/Seoul 축(kstDayStart 계열)이다 — 서버에도 같은 시간대로 「오늘」을 묻는다.
const TIMEZONE = 'Asia/Seoul';

export function useFocusSummary({ active }: { active: boolean }): FocusSummaryState {
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<FocusSummaryState['status']>(active ? 'loading' : 'idle');
  const [data, setData] = useState<FocusSummary | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const req = useRef(0);
  const session = sessionGeneration();

  useEffect(() => {
    if (!active) {
      req.current += 1;
      setStatus('idle');
      setError(null);
      return;
    }
    const gen = ++req.current;
    setStatus('loading');
    setError(null);
    getFocusSummary(undefined, TIMEZONE)
      .then((d) => {
        if (gen !== req.current || session !== sessionGeneration()) return;
        setData(d);
        setStatus('ready');
      })
      .catch((thrown) => {
        if (gen !== req.current || session !== sessionGeneration()) return;
        setError(thrown as ApiError);
        setStatus('error');
      });
    return () => {
      req.current += 1;
    };
  }, [active, nonce, session]);

  return { status, data, error, retry: useCallback(() => setNonce((n) => n + 1), []) };
}
