/**
 * 망원경 목록 view model (GROMO-2266) — `GET /me/telescope` + 「새 섬까지 N분」 카운트다운.
 *
 * - 로딩·오류 화면은 첫 조회와 오류 뒤 재시도에서만 보인다. 목록이 이미 있으면 다시 읽는 동안(카운트다운 0·가입 뒤)
 *   이전 목록을 그대로 두고, 다시 읽기가 실패해도 보던 목록은 남는다(1분 뒤 다시 시도한다).
 * - 카운트다운은 서버가 준 `nextRefreshMinutes` 에서 시작해 1분마다 줄고, 0 이 되면 다시 읽는다. 남은 분은 틱마다 «갱신 시각 − 지금»
 *   으로 다시 계산한다 — 앱이 백그라운드에 있는 동안 타이머가 멈춰도 돌아온 뒤 첫 틱에 따라잡고, 이미 지났으면 바로 다시 읽는다.
 * - `active=false`(목업·서버 세션 없음)면 아무것도 부르지 않고 빈 목록이다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/services/api/client';
import { sessionGeneration } from '@/services/api/session';
import { getTelescope, type Telescope, type TelescopeItem } from '@/services/api/telescope';

const MINUTE_MS = 60_000;

export interface TelescopeState {
  status: 'loading' | 'ready' | 'error';
  error: ApiError | null;
  items: TelescopeItem[];
  /** 새 섬(다음 버킷)까지 남은 분. 목록을 받기 전에는 null. */
  minutes: number | null;
  /** 목록을 다시 읽는다 — 오류 화면의 「다시 시도」와 가입 뒤 갱신이 같이 쓴다. */
  reload: () => void;
}

export function useTelescope({ active }: { active: boolean }): TelescopeState {
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [data, setData] = useState<Telescope | null>(null);
  const [minutes, setMinutes] = useState(0);
  const req = useRef(0);
  const loaded = useRef(false);
  const refreshAt = useRef(0);
  const session = sessionGeneration();

  useEffect(() => {
    if (!active) {
      req.current += 1;
      return;
    }
    const gen = ++req.current;
    const stale = () => gen !== req.current || session !== sessionGeneration();
    if (!loaded.current) setStatus('loading');
    getTelescope()
      .then((next) => {
        if (stale()) return;
        loaded.current = true;
        setData(next);
        // 0 이하를 받으면 곧바로 다시 읽는 고리가 되니 최소 1분으로 둔다.
        const wait = Math.max(1, next.nextRefreshMinutes);
        refreshAt.current = Date.now() + wait * MINUTE_MS;
        setMinutes(wait);
        setError(null);
        setStatus('ready');
      })
      .catch((thrown) => {
        if (stale() || loaded.current) return;
        setError(thrown as ApiError);
        setStatus('error');
      });
    return () => {
      req.current += 1;
    };
  }, [active, nonce, session]);

  // 목록을 받을 때마다 카운트다운을 새로 시작한다.
  useEffect(() => {
    if (!data) return;
    const timer = setInterval(
      () => setMinutes(Math.ceil((refreshAt.current - Date.now()) / MINUTE_MS)),
      MINUTE_MS,
    );
    return () => clearInterval(timer);
  }, [data]);
  // 0 이 되면 다시 읽는다. 읽기가 실패하면 데이터가 그대로라 분이 계속 줄고, 그때마다 다시 시도한다.
  useEffect(() => {
    if (data && minutes <= 0) setNonce((n) => n + 1);
  }, [data, minutes]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  if (!active) return { status: 'ready', error: null, items: [], minutes: null, reload };
  return {
    status,
    error,
    items: data?.items ?? [],
    minutes: data ? Math.max(0, minutes) : null,
    reload,
  };
}
