import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { endServerVisit, useIslandSailing } from '@/screens/island/useIslandSailing';
import { initialState } from '@/services/model';

// 재생 수명은 HarborCutscene.test 가 검사한다. 여기서는 실제 도착 명령과 계정 격리를 본다.
jest.mock('@/screens/world/HarborCutscene', () => ({
  HarborCutscene: ({ onFinish }: any) => {
    const finished = require('react').useRef(false);
    const { Pressable } = require('react-native');
    return (
      <Pressable
        testID="arrival"
        onPress={() => {
          if (finished.current) return;
          finished.current = true;
          onFinish();
        }}
      />
    );
  },
}));
let mockGeneration = 0;
jest.mock('@/services/api/session', () => ({ sessionGeneration: () => mockGeneration }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('useIslandSailing', () => {
  beforeEach(() => {
    mockGeneration = 0;
  });

  it('접안 장면 완료 뒤 END_VISIT·reset 이 1회 호출된다', async () => {
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
    const screen = await render(<Host />);
    await act(async () =>
      api.sail('섬', async () => () => {
        e.dispatch({ type: 'END_VISIT' });
        e.reset('home');
      }),
    );
    await fireEvent.press(screen.getByTestId('arrival'));
    expect(e.reset).toHaveBeenCalledTimes(1);
    expect(e.reset).toHaveBeenCalledWith('home');
    expect(e.dispatch).toHaveBeenCalledTimes(1);
    expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
    await fireEvent.press(screen.getByTestId('arrival'));
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
    const screen = await render(<Host />);
    await act(async () => api.sail('섬', async () => () => e.reset('home')));
    expect(api.busy).toBe(true);
    mockGeneration = 1;
    await fireEvent.press(screen.getByTestId('arrival'));
    expect(e.reset).not.toHaveBeenCalled();
    expect(api.sailing).toBeNull();
    expect(api.busy).toBe(false);
  });
});

test.each([
  ['KICKED', 'sea'],
  [null, 'sea'],
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
