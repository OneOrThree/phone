import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  boardSnapshot,
  boardStatus,
  fetchBoardSnapshot,
  fetchLibrarySnapshot,
  fetchMailboxUnreadCount,
  libraryStatus,
  loadBoardSeen,
  loadLibrarySeen,
  reconcileBoardSeen,
  saveBoardSeen,
  saveLibrarySeen,
  type BoardSnapshot,
  type IndicatorScope,
  type LibrarySnapshot,
} from '@/services/buildingIndicators';
import { getSession, sessionGeneration, subscribeSession } from '@/services/api/session';
import type { BoardLoadedSnapshot } from '@/screens/interiors/useBoardNotices';

export type BuildingIndicators = {
  boardStatus: 'unread' | 'new-comment' | null;
  libraryState: 'normal' | 'new-reading';
  showMailboxLetters: boolean;
};

const EMPTY: BuildingIndicators = {
  boardStatus: null,
  libraryState: 'normal',
  showMailboxLetters: false,
};

/**
 * 홈 건물 배지는 서버의 현재 값과 이 기기에서 마지막으로 확인한 값을 비교한다.
 * 확인 마커는 사용자·섬별로 격리하며, 계정/섬 전환 중 늦게 온 응답은 적용하지 않는다.
 */
export function useBuildingIndicators({
  active,
  islandId,
  onHome,
  refreshKey,
}: {
  active: boolean;
  islandId: string | null;
  onHome: boolean;
  refreshKey: number;
}) {
  const [userId, setUserId] = useState(() => getSession()?.userId ?? null);
  const [indicators, setIndicators] = useState<BuildingIndicators>(EMPTY);
  const [liveRefresh, setLiveRefresh] = useState(0);
  const epoch = useRef(0);
  const activeScopeKey = useRef('');
  const currentBoard = useRef<BoardSnapshot | null>(null);
  const currentLibrary = useRef<LibrarySnapshot | null>(null);

  useEffect(() => subscribeSession((session) => setUserId(session?.userId ?? null)), []);

  const scope: IndicatorScope | null = useMemo(
    () => (active && userId && islandId ? { userId, islandId } : null),
    [active, userId, islandId],
  );
  const scopeKey = scope ? `${scope.userId}\n${scope.islandId}` : '';
  activeScopeKey.current = scopeKey;

  useEffect(() => {
    epoch.current += 1;
    currentBoard.current = null;
    currentLibrary.current = null;
    setIndicators(EMPTY);
  }, [scopeKey]);

  useEffect(() => {
    if (!scope || !onHome) return;
    const interval = setInterval(() => setLiveRefresh((value) => value + 1), 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setLiveRefresh((value) => value + 1);
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [scope, onHome]);

  useEffect(() => {
    const requestEpoch = ++epoch.current;
    if (!scope || !onHome) return;

    const generation = sessionGeneration();
    const requestScope = scope;
    const alive = () =>
      requestEpoch === epoch.current &&
      activeScopeKey.current === scopeKey &&
      generation === sessionGeneration() &&
      getSession()?.userId === requestScope.userId;

    Promise.all([
      (async () => {
        const [current, seen] = await Promise.all([
          fetchBoardSnapshot(requestScope.islandId, alive),
          loadBoardSeen(requestScope),
        ]);
        if (!alive()) return;
        currentBoard.current = current;
        const effectiveSeen = seen ? reconcileBoardSeen(current, seen) : null;
        if (!seen) {
          await saveBoardSeen(requestScope, current);
          if (!alive()) return;
        } else if (JSON.stringify(effectiveSeen) !== JSON.stringify(seen)) {
          await saveBoardSeen(requestScope, effectiveSeen!);
          if (!alive()) return;
        }
        setIndicators((value) => ({
          ...value,
          boardStatus: boardStatus(current, effectiveSeen),
        }));
      })().catch(() => {}),
      (async () => {
        const [current, seen] = await Promise.all([
          fetchLibrarySnapshot(requestScope.islandId, alive),
          loadLibrarySeen(requestScope),
        ]);
        if (!alive() || !current) return;
        currentLibrary.current = current;
        // 첫 관측과 UTC 주 변경은 새 콘텐츠로 세지 않고 새 기준점으로 삼는다.
        if (!seen || seen.periodKey !== current.periodKey) {
          await saveLibrarySeen(requestScope, current);
          if (!alive()) return;
        }
        setIndicators((value) => ({
          ...value,
          libraryState: libraryStatus(current, seen) ? 'new-reading' : 'normal',
        }));
      })().catch(() => {}),
      (async () => {
        const unread = await fetchMailboxUnreadCount(requestScope.islandId, alive);
        if (!alive()) return;
        setIndicators((value) => ({ ...value, showMailboxLetters: unread > 0 }));
      })().catch(() => {}),
    ]);

    return () => {
      epoch.current += 1;
    };
  }, [scope, scopeKey, onHome, refreshKey, liveRefresh]);

  const markBoardSeen = useCallback(
    async (loaded: BoardLoadedSnapshot) => {
      if (!scope || loaded.islandId !== scope.islandId) return;
      try {
        const generation = sessionGeneration();
        const requestScope = scope;
        const requestScopeKey = scopeKey;
        const previous = await loadBoardSeen(requestScope);
        if (
          activeScopeKey.current !== requestScopeKey ||
          generation !== sessionGeneration() ||
          getSession()?.userId !== requestScope.userId
        )
          return;
        const merged = { ...(previous ?? {}), ...boardSnapshot(loaded.items) };
        await saveBoardSeen(requestScope, merged);
        if (
          activeScopeKey.current !== requestScopeKey ||
          generation !== sessionGeneration() ||
          getSession()?.userId !== requestScope.userId
        )
          return;
        const current = currentBoard.current;
        setIndicators((value) => ({
          ...value,
          boardStatus: current ? boardStatus(current, merged) : null,
        }));
      } catch {
        // 저장 실패는 확인 성공으로 보이지 않는다. 다음 홈 조회에서 다시 표시한다.
      }
    },
    [scope, scopeKey],
  );

  const markLibrarySeen = useCallback(async () => {
    if (!scope) return;
    const generation = sessionGeneration();
    const requestScope = scope;
    const requestScopeKey = scopeKey;
    const alive = () =>
      activeScopeKey.current === requestScopeKey &&
      generation === sessionGeneration() &&
      getSession()?.userId === requestScope.userId;
    try {
      const current = await fetchLibrarySnapshot(requestScope.islandId, alive);
      if (!current || !alive()) return;
      await saveLibrarySeen(requestScope, current);
      if (!alive()) return;
      currentLibrary.current = current;
      setIndicators((value) => ({ ...value, libraryState: 'normal' }));
    } catch {
      // 방 조회 실패·잠김·세션 전환은 확인으로 기록하지 않는다.
    }
  }, [scope, scopeKey]);

  return { ...indicators, markBoardSeen, markLibrarySeen };
}
