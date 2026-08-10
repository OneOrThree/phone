import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { LeagueMemberResponse } from '@/types/api';
import { todayStrKst } from '@/utils/localDate';
import {
  GroupCardSummaryAdapter,
  type GroupCardSummarySnapshot,
  type SharedFocusDependency,
} from './groupCardSummary';
import { GroupFocusPollingController, groupFocusStatusStore } from './groupFocusStatus';

const sharedFocus: SharedFocusDependency<LeagueMemberResponse[]> = {
  getState: (userId, date) => groupFocusStatusStore.getState(userId, date),
  ensure: (userId, date) => groupFocusStatusStore.ensure(userId, date),
  retry: (userId, date) => groupFocusStatusStore.retry(userId, date),
  subscribe: (listener) => groupFocusStatusStore.subscribeAll(listener),
};

interface Params {
  userId: string | null;
  groupIds: readonly string[];
  screenFocused: boolean;
  reloadToken?: number;
}

export interface GroupCardData {
  snapshots: Record<string, GroupCardSummarySnapshot<LeagueMemberResponse[]>>;
  ensureBack: (groupId: string) => void;
  retry: (groupId: string, dependency: 'detail' | 'announcements' | 'challenges' | 'focus') => void;
}

/** 카드 화면 하나가 소유하는 adapter와 60초 polling 수명을 React에 연결한다. */
export function useGroupCardData({
  userId,
  groupIds,
  screenFocused,
  reloadToken = 0,
}: Params): GroupCardData {
  const adapter = useMemo(() => new GroupCardSummaryAdapter(sharedFocus), []);
  const openedGroupIdsRef = useRef(new Set<string>());
  const openedUserIdRef = useRef<string | null>(userId);
  const previousReloadTokenRef = useRef(reloadToken);
  const [date, setDate] = useState(todayStrKst);
  const [appActive, setAppActive] = useState(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const [, render] = useState(0);
  const groupKey = JSON.stringify(groupIds);

  const controller = useMemo(
    () =>
      userId ? new GroupFocusPollingController({ store: groupFocusStatusStore, userId }) : null,
    [userId],
  );

  useEffect(() => {
    const reloadChanged = previousReloadTokenRef.current !== reloadToken;
    previousReloadTokenRef.current = reloadToken;
    if (openedUserIdRef.current !== userId) {
      openedGroupIdsRef.current.clear();
      openedUserIdRef.current = userId;
    }
    const currentGroupIds = new Set(groupIds);
    for (const openedGroupId of openedGroupIdsRef.current) {
      if (!currentGroupIds.has(openedGroupId)) openedGroupIdsRef.current.delete(openedGroupId);
    }
    adapter.setScope(userId ? { userId, date, groupIds } : null);
    // 이미 뒷면을 연 카드는 KST 날짜가 바뀌어 날짜별 detail/challenge cache가 idle로
    // 교체되더라도 사용자 조작을 다시 기다리지 않고 새 날짜 dependency를 시작한다.
    for (const openedGroupId of openedGroupIdsRef.current) {
      const request = reloadChanged
        ? adapter.refreshBack(openedGroupId)
        : adapter.ensureBack(openedGroupId);
      request.catch(() => undefined);
    }
    render((value) => value + 1);
  }, [adapter, date, groupIds, groupKey, reloadToken, userId]);

  useEffect(() => {
    return adapter.subscribe(() => render((value) => value + 1));
  }, [adapter]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      setAppActive(active);
      // 백그라운드에서 KST 날짜가 바뀐 경우 60초 tick을 기다리지 않고 새 날짜 scope로
      // 교체한다. 열린 카드의 날짜별 dependency도 scope effect에서 즉시 다시 시작된다.
      if (active) {
        const next = todayStrKst();
        setDate((current) => (current === next ? current : next));
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    controller?.setLifecycle({
      screenFocused,
      appActive,
      hasGroups: groupIds.length > 0,
    });
  }, [appActive, controller, groupIds.length, screenFocused]);

  useEffect(() => {
    if (!screenFocused || !appActive) return;
    const timer = setInterval(() => {
      const next = todayStrKst();
      setDate((current) => (current === next ? current : next));
    }, 60_000);
    return () => clearInterval(timer);
  }, [appActive, screenFocused]);

  useEffect(
    () => () => {
      controller?.dispose();
      if (userId) groupFocusStatusStore.clearUser(userId);
    },
    [controller, userId],
  );

  useEffect(() => () => adapter.dispose(), [adapter]);

  const ensureBack = useCallback(
    (groupId: string) => {
      openedGroupIdsRef.current.add(groupId);
      controller?.activate();
      adapter.ensureBack(groupId).catch(() => undefined);
    },
    [adapter, controller],
  );

  const retry = useCallback(
    (groupId: string, dependency: 'detail' | 'announcements' | 'challenges' | 'focus') => {
      adapter.retry(groupId, dependency).catch(() => undefined);
    },
    [adapter],
  );

  const snapshots = Object.fromEntries(
    groupIds.flatMap((groupId) => {
      const snapshot = adapter.getSnapshot(groupId);
      return snapshot ? [[groupId, snapshot] as const] : [];
    }),
  );

  return { snapshots, ensureBack, retry };
}
