import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  observatoryRankStorageKey,
  useObservatoryRankIndicator,
} from './useObservatoryRankIndicator';

const base = {
  active: true,
  userId: 'user-1',
  islandId: 'island-1',
  week: '2026-09-20',
  rank: 2 as number | null | undefined,
  viewed: false,
};

describe('useObservatoryRankIndicator', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('이번 주 최초로 순위가 생기면 새 순위 상태를 표시한다', async () => {
    const { result } = await renderHook(() => useObservatoryRankIndicator(base));
    await waitFor(() => expect(result.current).toBe('rank-updated'));
  });

  it('마지막으로 확인한 순위와 다르면 변동 상태를 표시하고 전망대 방문 시 기준점을 저장한다', async () => {
    const key = observatoryRankStorageKey(base.userId, base.islandId, base.week);
    await AsyncStorage.setItem(key, JSON.stringify({ rank: 4 }));
    const { result, rerender } = await renderHook(
      (props: typeof base) => useObservatoryRankIndicator(props),
      { initialProps: base },
    );
    await waitFor(() => expect(result.current).toBe('rank-changed'));

    await act(async () => rerender({ ...base, viewed: true }));
    await waitFor(async () => {
      expect(result.current).toBe('normal');
      expect(await AsyncStorage.getItem(key)).toBe(JSON.stringify({ rank: 2 }));
    });
  });

  it('비활성 또는 방문 중에는 순위 배지를 표시하지 않는다', async () => {
    const { result, rerender } = await renderHook(
      (props: typeof base) => useObservatoryRankIndicator(props),
      { initialProps: { ...base, active: false } },
    );
    expect(result.current).toBe('normal');
    await act(async () => rerender({ ...base, active: true, viewed: true }));
    expect(result.current).toBe('normal');
  });
});
