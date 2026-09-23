/**
 * 친구 관리·친구 찾기 화면 view model (GROMO-2015).
 *
 * 정본은 `GET /screens/friends` — 로컬 `state.friends`·`friendDirectory` 목업과 무관하다.
 * 명령(요청·수락·거절·취소·삭제)은 2xx 를 받은 뒤에만 목록을 재조회한다 — optimistic
 * 성공 없이 화면이 바뀌는 시점은 서버가 확인한 뒤다. 실패를 빈 목록으로 접지 않는다:
 * `items: []` 는 「없다」이지 「못 읽었다」가 아니다.
 *
 * 경합: route·계정이 바뀌면 요청 세대를 올리고, 응답·에러 적용 전에 세대와
 * `sessionGeneration()` 을 다시 본다 — 늦은 옛 계정 응답은 버린다.
 * 검색은 입력 300ms 디바운스로 `GET /friends/search?type=NICKNAME&q=` 를 친다 —
 * 서버 계약이 대소문자 무시 전체 일치라 로컬 필터를 다시 돌리지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';
import { sessionGeneration } from '@/services/api/session';
import {
  getFriendsScreen,
  searchFriends,
  type FriendSearchItem,
  type FriendsScreen,
} from '@/services/api/friends';

const SEARCH_DEBOUNCE_MS = 300;

export type LoadStatus = 'loading' | 'ready' | 'error';
export type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface FriendsScreenState {
  status: LoadStatus;
  error: ApiError | null;
  data: FriendsScreen | null;
  /** 명령이 하나라도 진행 중이면 true — 중복 탭으로 같은 의도를 두 번 만들지 않는다. */
  busy: boolean;
  /** 목록 재조회. retry·refresh·명령 성공 후처리가 모두 이것이다. */
  refresh: () => void;
  retry: () => void;
  /**
   * 명령 실행기 — 성공하면 목록·검색을 재조회하고 resolve, 실패하면 그대로 reject 한다.
   * 오류 분기(guest·privacy·duplicate·already-handled·network)는 호출부가
   * `friendErrorKind` 로 판정한다. 세션이 갈린 뒤 도착한 성공은 재조회도 건너뛴다.
   */
  command: (fn: () => Promise<unknown>) => Promise<void>;
  query: string;
  setQuery: (text: string) => void;
  searchStatus: SearchStatus;
  searchError: ApiError | null;
  searchItems: FriendSearchItem[];
}

export function useFriendsScreen({
  active,
  searchActive,
  date,
}: {
  /** friends·friendSearch route 에 있고 서버 세션이 있을 때만 true. */
  active: boolean;
  /** 검색 입력이 보일 때만 true — 목록 route 에서는 질의를 보내지 않는다. */
  searchActive: boolean;
  /** 친구 당일 집중 분의 KST 기준일 `YYYY-MM-DD`. */
  date: string;
}): FriendsScreenState {
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [data, setData] = useState<FriendsScreen | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  const [searchError, setSearchError] = useState<ApiError | null>(null);
  const [searchItems, setSearchItems] = useState<FriendSearchItem[]>([]);
  const req = useRef(0);
  const searchReq = useRef(0);
  const session = sessionGeneration();

  useEffect(() => {
    if (!active) {
      req.current += 1;
      return;
    }
    const gen = ++req.current;
    const stale = () => gen !== req.current || session !== sessionGeneration();
    setStatus('loading');
    setError(null);
    getFriendsScreen(date)
      .then((screen) => {
        if (stale()) return;
        setData(screen);
        setStatus('ready');
      })
      .catch((thrown) => {
        if (stale()) return;
        // 세션 교체 fence — 화면에는 아무 오류도 적지 않는다
        if (thrown instanceof ApiError && thrown.code === CLIENT_STALE_SESSION) return;
        setError(thrown as ApiError);
        setStatus('error');
      });
    return () => {
      req.current += 1;
    };
  }, [active, nonce, date, session]);

  useEffect(() => {
    const q = query.trim();
    if (!active || !searchActive || !q) {
      searchReq.current += 1;
      setSearchStatus('idle');
      setSearchError(null);
      setSearchItems([]);
      return;
    }
    const gen = ++searchReq.current;
    const stale = () => gen !== searchReq.current || session !== sessionGeneration();
    setSearchStatus('loading');
    setSearchError(null);
    const timer = setTimeout(() => {
      searchFriends(q)
        .then((items) => {
          if (stale()) return;
          setSearchItems(items);
          setSearchStatus('ready');
        })
        .catch((thrown) => {
          if (stale()) return;
          if (thrown instanceof ApiError && thrown.code === CLIENT_STALE_SESSION) return;
          setSearchItems([]);
          setSearchError(thrown as ApiError);
          setSearchStatus('error');
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      searchReq.current += 1;
    };
  }, [active, searchActive, query, nonce, session]);

  // single-flight 가드는 ref 다 — 같은 프레임의 연타는 setBusy 반영 전에 들어와 state 만으로는 못 막는다
  const busyRef = useRef(false);
  const command = useCallback(
    async (fn: () => Promise<unknown>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await fn();
        // 성공 확인 뒤에만 목록이 바뀐다 — 세션이 갈렸으면 재조회조차 옛 계정으로 가지 않게 멈춘다
        if (session === sessionGeneration()) setNonce((n) => n + 1);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [session],
  );

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return {
    status,
    error,
    data,
    busy,
    refresh,
    retry: refresh,
    command,
    query,
    setQuery,
    searchStatus,
    searchError,
    searchItems,
  };
}
