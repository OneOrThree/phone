import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { endServerVisit, useIslandSailing } from '@/screens/island/useIslandSailing';
import { initialState } from '@/services/model';

// 실제 VideoCutscene 을 그리되 영상 종료 이벤트만 직접 보낸다.
const mockListeners: Record<string, () => void> = {};
jest.mock('expo', () => ({
  useEventListener: (_player: unknown, event: string, listener: () => void) => {
    mockListeners[event] = listener;
  },
}));
let mockGeneration = 0;
jest.mock('@/services/api/session', () => ({ sessionGeneration: () => mockGeneration }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// 훅이 돌려주는 실제 도착 영상을 그린다 — 도착(land)이 AppState 왕복에도 한 번만 불리는지 훅 수준에서 본다.
describe('useIslandSailing', () => {
  let emit: (s: AppStateStatus) => void;
  beforeEach(() => {
    jest.useFakeTimers();
    mockGeneration = 0;
    for (const event of Object.keys(mockListeners)) delete mockListeners[event];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      emit = handler as (s: AppStateStatus) => void;
      return { remove: jest.fn() } as any;
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('도착 land 는 한 번만 — 영상이 마운트된 채 background→active 를 거쳐도 END_VISIT·reset 이 1회', async () => {
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
    await act(async () => mockListeners.playToEnd());
    expect(e.reset).toHaveBeenCalledTimes(1);
    expect(e.reset).toHaveBeenCalledWith('home');
    expect(e.dispatch).toHaveBeenCalledTimes(1);
    expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
    await act(async () => emit('background'));
    await act(async () => emit('active'));
    await act(async () => mockListeners.playToEnd());
    expect(e.reset).toHaveBeenCalledTimes(1);
    expect(e.dispatch).toHaveBeenCalledTimes(1);
  });

  it('영상 도중 세션 세대가 바뀌면 land 를 부르지 않고 영상·busy 만 거둔다', async () => {
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
    await act(async () => api.sail('섬', async () => () => e.reset('home')));
    expect(api.busy).toBe(true);
    mockGeneration = 1;
    await act(async () => mockListeners.playToEnd());
    expect(e.reset).not.toHaveBeenCalled();
    expect(api.sailing).toBeNull();
    expect(api.busy).toBe(false);
  });
});

test.each([
  ['KICKED', 'sea'],
  [null, 'chooseIsland'],
] as const)(
  '현재 섬 없이 구경을 끝내면 상실 사유 %s 는 %s 로 간다(GROMO-2366)',
  (lossReason, to) => {
    const e = {
      dispatch: jest.fn(),
      reset: jest.fn(),
      state: { serverIslands: { currentIslandId: null, lossReason } },
    };
    endServerVisit(e);
    expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
    expect(e.reset).toHaveBeenCalledWith(to);
  },
);
