import { useCallback, useEffect, useMemo, useState } from 'react';
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
};

interface Params {
  userId: string | null;
  groupIds: readonly string[];
  screenFocused: boolean;
}

export interface GroupCardData {
  snapshots: Record<string, GroupCardSummarySnapshot<LeagueMemberResponse[]>>;
  ensureBack: (groupId: string) => void;
  retry: (groupId: string, dependency: 'detail' | 'announcements' | 'challenges' | 'focus') => void;
}

/** 카드 화면 하나가 소유하는 adapter와 60초 polling 수명을 React에 연결한다. */
export function useGroupCardData({ userId, groupIds, screenFocused }: Params): GroupCardData {
  const adapter = useMemo(() => new GroupCardSummaryAdapter(sharedFocus), []);
  const [date, setDate] = useState(todayStrKst);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [, render] = useState(0);
  const groupKey = JSON.stringify(groupIds);

  const controller = useMemo(
    () =>
      userId ? new GroupFocusPollingController({ store: groupFocusStatusStore, userId }) : null,
    [userId],
  );

  useEffect(() => {
    adapter.setScope(userId ? { userId, date, groupIds } : null);
    render((value) => value + 1);
  }, [adapter, date, groupIds, groupKey, userId]);

  useEffect(() => {
    if (!userId) return adapter.subscribe(() => render((value) => value + 1));
    const unsubscribeSummary = adapter.subscribe(() => render((value) => value + 1));
    const unsubscribeFocus = groupFocusStatusStore.subscribe(userId, date, () =>
      render((value) => value + 1),
    );
    return () => {
      unsubscribeSummary();
      unsubscribeFocus();
    };
  }, [adapter, date, userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
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

  useEffect(() => () => controller?.dispose(), [controller]);

  const ensureBack = useCallback(
    (groupId: string) => {
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
