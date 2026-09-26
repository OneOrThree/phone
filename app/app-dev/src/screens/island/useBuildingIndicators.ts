import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  boardSnapshot,
  boardStatus,
  fetchBoardPollPage,
  fetchBoardSnapshot,
  fetchLibrarySnapshot,
  fetchMailboxPollPage,
  fetchMailboxUnreadLetterIds,
  libraryStatus,
  loadBoardSeen,
  loadLibrarySeen,
  reconcileBoardSeen,
  rolloverLibrarySeen,
  saveBoardSeen,
  saveLibrarySeen,
  type BoardSnapshot,
  type IndicatorScope,
  type LibrarySnapshot,
} from '@/services/buildingIndicators';
import { getSession, sessionGeneration, subscribeSession } from '@/services/api/session';
import type { LibraryScreen } from '@/services/api/records';
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

// 홈 기준점 갱신과 게시판 화면 확인은 같은 AsyncStorage 키를 수정하므로
// 읽기-병합-저장 전체를 scope 단위로 직렬화한다.
const boardWrites = new Map<string, Promise<unknown>>();
function serializeBoardWrite<T>(key: string, write: () => Promise<T>): Promise<T> {
  const previous = boardWrites.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(write);
  boardWrites.set(key, next);
  void next
    .finally(() => {
      if (boardWrites.get(key) === next) boardWrites.delete(key);
    })
    .catch(() => {});
  return next;
}

const libraryWrites = new Map<string, Promise<unknown>>();
function serializeLibraryWrite<T>(key: string, write: () => Promise<T>): Promise<T> {
  const previous = libraryWrites.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(write);
  libraryWrites.set(key, next);
  void next
    .finally(() => {
      if (libraryWrites.get(key) === next) libraryWrites.delete(key);
    })
    .catch(() => {});
  return next;
}

function mergeLibrarySeen(
  previous: LibrarySnapshot | null,
  next: LibrarySnapshot,
): LibrarySnapshot {
  if (!previous) return next;
  const fishEarnings = { ...previous.fishEarnings };
  for (const [userId, amount] of Object.entries(next.fishEarnings))
    fishEarnings[userId] = Math.max(fishEarnings[userId] ?? 0, amount);
  return next.periodKey < previous.periodKey
    ? { ...previous, fishEarnings }
    : { ...next, fishEarnings };
}

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
  const librarySeenRevision = useRef(0);
  const boardPagesByScope = useRef(new Map<string, Map<string, BoardSnapshot>>());
  const boardCyclePagesByScope = useRef(new Map<string, Set<string>>());
  const boardPollCursors = useRef(new Map<string, string | null>());
  const mailboxPollCursors = useRef(new Map<string, string | null>());
  const mailboxUnreadIds = useRef(new Map<string, Set<string>>());
  const mailboxConfirmedReadIds = useRef(new Map<string, Set<string>>());
  const mailboxPollReady = useRef(new Set<string>());
  const refreshInFlight = useRef(0);
  const queuedLiveRefresh = useRef(false);
  const requestLiveRefresh = useCallback(() => {
    if (refreshInFlight.current > 0) queuedLiveRefresh.current = true;
    else setLiveRefresh((value) => value + 1);
  }, []);

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
    librarySeenRevision.current += 1;
    setIndicators(EMPTY);
  }, [scopeKey]);

  useEffect(() => {
    if (!scope || !onHome) return;
    const interval = setInterval(requestLiveRefresh, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') requestLiveRefresh();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [scope, onHome, requestLiveRefresh]);

  useEffect(() => {
    const requestEpoch = ++epoch.current;
    if (!scope || !onHome) return;

    const generation = sessionGeneration();
    const requestScope = scope;
    refreshInFlight.current += 1;
    const alive = () =>
      requestEpoch === epoch.current &&
      activeScopeKey.current === scopeKey &&
      generation === sessionGeneration() &&
      getSession()?.userId === requestScope.userId;

    Promise.all([
      (async () => {
        const hasBaseline = currentBoard.current !== null;
        const pollPage = hasBaseline
          ? await fetchBoardPollPage(
              requestScope.islandId,
              boardPollCursors.current.get(scopeKey) ?? null,
              alive,
            )
          : null;
        const snapshot = pollPage
          ? pollPage.snapshot
          : await fetchBoardSnapshot(requestScope.islandId, alive, (pages) => {
              boardPagesByScope.current.set(
                scopeKey,
                new Map(pages.map(({ key, snapshot: pageSnapshot }) => [key, pageSnapshot])),
              );
            });
        if (!alive()) return;
        // 과거 공지는 고정 페이지 예산으로 순환 점검한다. 매분 최신 페이지와 과거
        // 페이지 하나만 요청하고, 나머지 기존 관측값은 메모리에 보존한다.
        let current = snapshot;
        if (pollPage) {
          boardPollCursors.current.set(scopeKey, pollPage.nextCursor);
          const pages = boardPagesByScope.current.get(scopeKey) ?? new Map();
          pages.set('latest', pollPage.latestSnapshot);
          const cyclePages = boardCyclePagesByScope.current.get(scopeKey) ?? new Set<string>();
          if (pollPage.historyPageKey) {
            pages.set(pollPage.historyPageKey, pollPage.historySnapshot);
            cyclePages.add(pollPage.historyPageKey);
          }
          if (pollPage.cycleComplete) {
            for (const key of pages.keys())
              if (key !== 'latest' && !cyclePages.has(key)) pages.delete(key);
            cyclePages.clear();
          }
          boardCyclePagesByScope.current.set(scopeKey, cyclePages);
          boardPagesByScope.current.set(scopeKey, pages);
          current = {};
          for (const [key, pageSnapshot] of pages)
            if (key !== 'latest') Object.assign(current, pageSnapshot);
          Object.assign(current, pages.get('latest') ?? {});
        }
        currentBoard.current = current;
        const effectiveSeen = await serializeBoardWrite(scopeKey, async () => {
          if (!alive()) return null;
          // 직렬화 대기 중 게시판 화면이 더 최신 기록을 저장했을 수 있으므로 재조회한다.
          const seen = await loadBoardSeen(requestScope);
          if (!alive()) return null;
          if (!seen) {
            await saveBoardSeen(requestScope, current);
            return null;
          }
          const reconciled = reconcileBoardSeen(current, seen);
          if (JSON.stringify(reconciled) !== JSON.stringify(seen))
            await saveBoardSeen(requestScope, reconciled);
          return reconciled;
        });
        if (!alive()) return;
        setIndicators((value) => ({
          ...value,
          boardStatus: boardStatus(current, effectiveSeen),
        }));
      })().catch(() => {}),
      (async () => {
        const confirmationRevision = librarySeenRevision.current;
        const latestOnly = currentLibrary.current !== null;
        const current = await fetchLibrarySnapshot(
          requestScope.islandId,
          alive,
          new Date(),
          undefined,
          latestOnly,
        );
        if (!alive() || !current) return;
        const hasUpdate = await serializeLibraryWrite(scopeKey, async () => {
          if (!alive() || confirmationRevision !== librarySeenRevision.current) return null;
          const seen = await loadLibrarySeen(requestScope);
          if (!alive() || confirmationRevision !== librarySeenRevision.current) return null;
          const updated = libraryStatus(current, seen);
          // 첫 관측은 전체 기준점, 주 변경은 누적 어획 기준을 보존하며 주간 기준만 이동한다.
          if (!seen || seen.periodKey !== current.periodKey) {
            const candidate = seen && updated ? rolloverLibrarySeen(current, seen) : current;
            await saveLibrarySeen(requestScope, mergeLibrarySeen(seen, candidate));
          }
          return updated;
        });
        if (!alive() || hasUpdate === null || confirmationRevision !== librarySeenRevision.current)
          return;
        currentLibrary.current = current;
        setIndicators((value) => ({
          ...value,
          libraryState: hasUpdate ? 'new-reading' : 'normal',
        }));
      })().catch(() => {}),
      (async () => {
        if (mailboxPollReady.current.has(scopeKey)) {
          const page = await fetchMailboxPollPage(
            requestScope.islandId,
            mailboxPollCursors.current.get(scopeKey) ?? null,
            alive,
          );
          if (!alive()) return;
          mailboxPollCursors.current.set(scopeKey, page.nextCursor);
          const unread = new Set(mailboxUnreadIds.current.get(scopeKey) ?? []);
          const confirmedRead = mailboxConfirmedReadIds.current.get(scopeKey) ?? new Set();
          for (const letter of [...page.latestItems, ...page.historyItems]) {
            if (letter.isRead || confirmedRead.has(letter.id)) unread.delete(letter.id);
            else unread.add(letter.id);
          }
          mailboxUnreadIds.current.set(scopeKey, unread);
          setIndicators((value) => ({ ...value, showMailboxLetters: unread.size > 0 }));
          return;
        }
        const unread = await fetchMailboxUnreadLetterIds(requestScope.islandId, alive);
        if (!alive()) return;
        mailboxPollReady.current.add(scopeKey);
        const confirmedRead = mailboxConfirmedReadIds.current.get(scopeKey) ?? new Set();
        const currentUnread = new Set(unread.filter((id) => !confirmedRead.has(id)));
        mailboxUnreadIds.current.set(scopeKey, currentUnread);
        setIndicators((value) => ({ ...value, showMailboxLetters: currentUnread.size > 0 }));
      })().catch(() => {}),
    ]).finally(() => {
      refreshInFlight.current = Math.max(0, refreshInFlight.current - 1);
      if (refreshInFlight.current === 0 && queuedLiveRefresh.current) {
        queuedLiveRefresh.current = false;
        setLiveRefresh((value) => value + 1);
      }
    });

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
        const merged = await serializeBoardWrite(requestScopeKey, async () => {
          if (
            activeScopeKey.current !== requestScopeKey ||
            generation !== sessionGeneration() ||
            getSession()?.userId !== requestScope.userId
          )
            return null;
          const previous = await loadBoardSeen(requestScope);
          if (
            activeScopeKey.current !== requestScopeKey ||
            generation !== sessionGeneration() ||
            getSession()?.userId !== requestScope.userId
          )
            return null;
          const next = { ...(previous ?? {}), ...boardSnapshot(loaded.items) };
          await saveBoardSeen(requestScope, next);
          return next;
        });
        if (!merged) return;
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

  const markLibrarySeen = useCallback(
    async (screen: LibraryScreen) => {
      if (!scope) return;
      const generation = sessionGeneration();
      const requestScope = scope;
      const requestScopeKey = scopeKey;
      const confirmationRevision = ++librarySeenRevision.current;
      const alive = () =>
        activeScopeKey.current === requestScopeKey &&
        generation === sessionGeneration() &&
        getSession()?.userId === requestScope.userId;
      try {
        const current = await fetchLibrarySnapshot(
          requestScope.islandId,
          alive,
          new Date(),
          screen,
        );
        if (!current || !alive()) return;
        await serializeLibraryWrite(requestScopeKey, async () => {
          if (!alive() || confirmationRevision !== librarySeenRevision.current) return;
          const previous = await loadLibrarySeen(requestScope);
          if (!alive() || confirmationRevision !== librarySeenRevision.current) return;
          await saveLibrarySeen(requestScope, mergeLibrarySeen(previous, current));
        });
        if (!alive() || confirmationRevision !== librarySeenRevision.current) return;
        currentLibrary.current = current;
        setIndicators((value) => ({ ...value, libraryState: 'normal' }));
      } catch {
        // 방 조회 실패·잠김·세션 전환은 확인으로 기록하지 않는다.
      }
    },
    [scope, scopeKey],
  );

  const markMailboxLetterRead = useCallback(
    (letterId: string) => {
      if (
        !scope ||
        !letterId ||
        activeScopeKey.current !== scopeKey ||
        getSession()?.userId !== scope.userId
      )
        return;
      const unread = new Set(mailboxUnreadIds.current.get(scopeKey) ?? []);
      unread.delete(letterId);
      mailboxUnreadIds.current.set(scopeKey, unread);
      const confirmedRead = new Set(mailboxConfirmedReadIds.current.get(scopeKey) ?? []);
      confirmedRead.add(letterId);
      mailboxConfirmedReadIds.current.set(scopeKey, confirmedRead);
      setIndicators((value) => ({ ...value, showMailboxLetters: unread.size > 0 }));
    },
    [scope, scopeKey],
  );

  return { ...indicators, markBoardSeen, markLibrarySeen, markMailboxLetterRead };
}
