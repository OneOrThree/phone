import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { useIslandSailing } from '@/screens/island/useIslandSailing';
import { initialState } from '@/services/model';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// 훅이 돌려주는 실제 Sailing 을 그린다 — 도착(land)이 AppState 왕복에도 한 번만 불리는지 훅 수준에서 본다.
describe('useIslandSailing', () => {
  let emit: (s: AppStateStatus) => void;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      emit = handler as (s: AppStateStatus) => void;
      return { remove: jest.fn() } as any;
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('도착 land 는 한 번만 — Sailing 이 마운트된 채 background→active 를 거쳐도 END_VISIT·reset 이 1회', async () => {
    const e = {
      state: initialState(true),
      dispatch: jest.fn(),
      reset: jest.fn(),
      notify: jest.fn(),
      backOverride: { current: null },
    };
    let api!: ReturnType<typeof useIslandSailing>;
    const Host = () => {
      api = useIslandSailing(e);
      return api.sailing;
    };
    await render(<Host />);
    await act(async () =>
      api.sail('섬', async () => () => {
        e.dispatch({ type: 'END_VISIT' });
        e.reset('home');
      }),
    );
    await act(async () => jest.advanceTimersByTime(2100));
    expect(e.reset).toHaveBeenCalledTimes(1);
    expect(e.reset).toHaveBeenCalledWith('home');
    expect(e.dispatch).toHaveBeenCalledTimes(1);
    expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
    await act(async () => emit('background'));
    await act(async () => emit('active'));
    await act(async () => jest.advanceTimersByTime(2100));
    expect(e.reset).toHaveBeenCalledTimes(1);
    expect(e.dispatch).toHaveBeenCalledTimes(1);
  });
});
