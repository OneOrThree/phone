/**
 * 전망대 섬 이름 검색 view model (GROMO-2269) — 서버 `GET /islands?q=` 첫 페이지.
 *
 * - 검색어는 앞뒤 공백을 자른 값이다. 비어 있으면 서버를 부르지 않고 `idle` 이다.
 * - 입력이 `SEARCH_DEBOUNCE_MS`(300ms) 멈추면 부른다. 입력이 바뀌어 아직 부르기 전이거나 요청 중이면 `loading` 이다 —
 *   이전 검색어의 결과를 새 검색어 밑에 남겨 두지 않는다.
 * - 늦게 온 옛 검색어 응답은 버린다. 효과가 정리될 때 응답을 끊고, 결과에도 검색어를 실어 지금 검색어와 다르면 쓰지 않는다.
 * - 실패는 빈 결과로 접지 않고 `error` + `retry`(바로 다시 부른다)로 돌려준다 — 빈 결과는 «그 이름의 섬이 없다»는 뜻이다.
 * - 첫 페이지(`SEARCH_LIMIT` 20개)만 읽는다. 더 있으면 `more` 로 알려 화면이 검색어를 좁히라고 안내한다.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/services/api/client';
import { CLIENT_CONTRACT_ERROR } from '@/services/api/home';
import { searchIslands, type IslandSummary } from '@/services/api/islands';
import { sessionGeneration } from '@/services/api/session';

export const SEARCH_DEBOUNCE_MS = 300;
/** 한 번에 읽는 결과 수 — 서버 `limit`. */
export const SEARCH_LIMIT = 20;

type Settled = { q: string; items: IslandSummary[]; more: boolean; error: ApiError | null };

export interface IslandSearchState {
  /** idle = 검색어 없음(호출 안 함) · loading = 입력 직후부터 응답까지 · ready = 결과(빈 목록 포함) · error = 실패. */
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: IslandSummary[];
  /** 첫 페이지 뒤에 결과가 더 있다 — 검색어를 좁혀야 보인다. */
  more: boolean;
  error: ApiError | null;
  /** 같은 검색어로 바로 다시 부른다(디바운스 없음). */
  retry: () => void;
}

export function useIslandSearch(text: string): IslandSearchState {
  const q = text.trim();
  // 디바운스를 통과한 검색어 — 요청은 이 값으로만 나간다.
  const [settled, setSettled] = useState('');
  const [nonce, setNonce] = useState(0);
  const [done, setDone] = useState<Settled | null>(null);
  const session = sessionGeneration();

  useEffect(() => {
    if (q === settled) return;
    // 지우면 기다릴 이유가 없다 — 바로 비운다.
    if (!q) {
      setSettled('');
      return;
    }
    const timer = setTimeout(() => setSettled(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, settled]);

  useEffect(() => {
    // 검색어가 비면 이전 결과를 비운다 — 다시 같은 검색어를 치면 새로 부른다.
    setDone(null);
    if (!settled) return;
    let alive = true;
    const stale = () => !alive || session !== sessionGeneration();
    // ponytail: 무한 스크롤 없음 — 결과가 20개를 넘기면 검색어를 좁히게 한다
    searchIslands(settled, { limit: SEARCH_LIMIT })
      .then((page) => {
        if (stale()) return;
        // 목록이 아닌 응답을 «결과 없음» 으로 읽지 않는다 — 오류로 보내 다시 시도하게 한다.
        // 사용자에게는 한글이 없는 message 를 걸러 내는 errorTextOr 가 «섬을 찾지 못했어요» 로 바꿔 보인다.
        if (!Array.isArray(page?.items))
          throw new ApiError(CLIENT_CONTRACT_ERROR, 'Unexpected island search response.', 0);
        setDone({ q: settled, items: page.items, more: page.nextCursor != null, error: null });
      })
      .catch((thrown) => {
        if (stale()) return;
        setDone({ q: settled, items: [], more: false, error: thrown as ApiError });
      });
    return () => {
      alive = false;
    };
  }, [settled, nonce, session]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  // 결과는 지금 검색어의 것일 때만 쓴다 — 입력이 먼저 바뀌었으면 응답이 와도 loading 이다.
  const current = done && done.q === q ? done : null;
  if (!q) return { status: 'idle', items: [], more: false, error: null, retry };
  if (!current) return { status: 'loading', items: [], more: false, error: null, retry };
  return {
    status: current.error ? 'error' : 'ready',
    items: current.items,
    more: current.more,
    error: current.error,
    retry,
  };
}
