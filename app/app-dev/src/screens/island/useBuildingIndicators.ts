import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  fetchLibrarySnapshot,
  fetchMailboxUnreadCount,
  libraryStatus,
  loadMailboxReadThrough,
  loadLibrarySeen,
  rolloverLibrarySeen,
  saveLibrarySeen,
  saveMailboxReadThrough,
  type IndicatorScope,
  type MailboxReadThrough,
  type LibrarySnapshot,
} from '@/services/buildingIndicators';
import { getSession, sessionGeneration, subscribeSession } from '@/services/api/session';
import type { LibraryScreen } from '@/services/api/records';

// 게시판 배지는 CurrentScreens 의 useBoardHomeIndicator 가 정본이다. 여기서는 조회하지 않는다.
export type BuildingIndicators = {
  libraryState: 'normal' | 'new-reading';
  showMailboxLetters: boolean;
};

const EMPTY: BuildingIndicators = {
  libraryState: 'normal',
  showMailboxLetters: false,
};

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
  const currentLibrary = useRef<LibrarySnapshot | null>(null);
  const mailboxReadThrough = useRef<MailboxReadThrough>({ id: null });
  const librarySeenRevision = useRef(0);
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
    currentLibrary.current = null;
    mailboxReadThrough.current = { id: null };
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
        const confirmationRevision = librarySeenRevision.current;
        const current = await fetchLibrarySnapshot(requestScope.islandId, alive);
        if (!alive() || !current) return;
        const hasUpdate = await serializeLibraryWrite(scopeKey, async () => {
          if (!alive()) return null;
          const seen = await loadLibrarySeen(requestScope);
          if (!alive()) return null;
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
        const readThrough = mailboxReadThrough.current;
        if (readThrough.id === null) {
          readThrough.id = await loadMailboxReadThrough(requestScope).catch(() => null);
          if (!alive()) return;
        }
        const previous = readThrough.id;
        const unread = await fetchMailboxUnreadCount(requestScope.islandId, alive, readThrough);
        if (alive() && readThrough.id && readThrough.id !== previous)
          await saveMailboxReadThrough(requestScope, readThrough.id).catch(() => {});
        if (!alive()) return;
        setIndicators((value) => ({ ...value, showMailboxLetters: unread > 0 }));
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

  const markLibrarySeen = useCallback(
    async (screen: LibraryScreen) => {
      if (!scope) return;
      const generation = sessionGeneration();
      const requestScope = scope;
      const requestScopeKey = scopeKey;
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
          if (!alive()) return;
          const previous = await loadLibrarySeen(requestScope);
          if (!alive()) return;
          await saveLibrarySeen(requestScope, mergeLibrarySeen(previous, current));
        });
        if (!alive()) return;
        librarySeenRevision.current += 1;
        currentLibrary.current = current;
        setIndicators((value) => ({ ...value, libraryState: 'normal' }));
      } catch {
        // 방 조회 실패·잠김·세션 전환은 확인으로 기록하지 않는다.
      }
    },
    [scope, scopeKey],
  );

  return { ...indicators, markLibrarySeen };
}
