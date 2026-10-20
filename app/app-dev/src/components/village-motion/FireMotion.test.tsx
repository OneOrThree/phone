import React, { Profiler } from 'react';
import { act, configure, render } from '@testing-library/react-native';

// 장식 모션은 스크린리더에서 숨기므로 숨김 요소까지 조회한다.
configure({ defaultIncludeHiddenElements: true });
import { Animated, AppState, StyleSheet, type AppStateStatus } from 'react-native';
import { observeAnimatedOnJsDriver } from '../animatedJsDriver.testing';
import { FireMotion } from './FireMotion';

type MotionView = Awaited<ReturnType<typeof render>>;

describe('FireMotion', () => {
  let onAppStateChange: ((state: AppStateStatus) => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    observeAnimatedOnJsDriver();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event, listener) => {
      onAppStateChange = listener as (state: AppStateStatus) => void;
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    onAppStateChange = undefined;
  });

  // 프레임은 겹친 레이어의 opacity 로 바뀐다. Jest 에서는 JS 드라이버로 진행을 관찰한다.
  const isShown = (view: MotionView, mode: 'day' | 'evening', index: number) =>
    StyleSheet.flatten(view.getByTestId(`fire-motion-frame-${mode}-${index}`).props.style)
      .opacity === 1;
  const activeFrame = (view: MotionView, mode: 'day' | 'evening') =>
    [0, 1, 2, 3].find((index) => isShown(view, mode, index));
  const visibleFrameCount = (view: MotionView, mode: 'day' | 'evening') =>
    [0, 1, 2, 3].filter((index) => isShown(view, mode, index)).length;

  it('loops through day smoke frames every 360ms', async () => {
    const view = await render(<FireMotion mode="day" />);
    expect(activeFrame(view, 'day')).toBe(0);
    await act(async () => jest.advanceTimersByTime(360));
    expect(activeFrame(view, 'day')).toBe(1);
    expect(visibleFrameCount(view, 'day')).toBe(1);
    await act(async () => jest.advanceTimersByTime(360));
    expect(activeFrame(view, 'day')).toBe(2);
    await view.unmount();
  });

  it('loops through evening flame frames every 155ms', async () => {
    const view = await render(<FireMotion mode="evening" residentCount={1} />);
    expect(activeFrame(view, 'evening')).toBe(1);
    expect(view.queryByTestId('fire-motion-glow')).toBeNull();
    expect(view.getByTestId('fire-motion').props.accessibilityLabel).toContain('주민 1명');
    await act(async () => jest.advanceTimersByTime(155));
    expect(activeFrame(view, 'evening')).toBe(2);
    expect(visibleFrameCount(view, 'evening')).toBe(1);
    await view.unmount();
  });

  it.each([
    [0, '주민 없음'],
    [1, '주민 1명'],
    [5, '주민 5명'],
  ])('supports the resident count state %i', async (residentCount, label) => {
    const view = await render(<FireMotion residentCount={residentCount} />);
    expect(view.getByTestId('fire-motion').props.accessibilityLabel).toContain(label);
    await view.unmount();
  });

  it('hides the resident count when presence has not loaded', async () => {
    const view = await render(<FireMotion residentCount={null} />);
    expect(view.getByTestId('fire-motion').props.accessibilityLabel).toBe('모닥불, 저녁, 불꽃');
    await view.unmount();
  });

  it('pauses in background and holds still when reduce motion is enabled', async () => {
    const view = await render(<FireMotion mode="evening" />);
    await act(async () => jest.advanceTimersByTime(155));
    expect(activeFrame(view, 'evening')).toBe(2);
    await act(async () => onAppStateChange?.('background'));
    expect(activeFrame(view, 'evening')).toBe(1);
    await act(async () => jest.advanceTimersByTime(5_000));
    expect(activeFrame(view, 'evening')).toBe(1);
    await act(async () => onAppStateChange?.('active'));
    await act(async () => jest.advanceTimersByTime(155));
    expect(activeFrame(view, 'evening')).toBe(2);

    await view.rerender(<FireMotion mode="evening" reduceMotion />);
    await act(async () => jest.advanceTimersByTime(5_000));
    expect(activeFrame(view, 'evening')).toBe(1);
    await view.unmount();
  });

  it('fills the parent using the 116:77 phone box ratio', async () => {
    const view = await render(<FireMotion />);
    expect(view.getByTestId('fire-motion').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          width: '100%',
          height: '100%',
          aspectRatio: 116 / 77,
        }),
      ]),
    );
    await view.unmount();
  });

  it('switches frames on the native driver without React commits', async () => {
    // JS 드라이버 관찰을 풀고 실제 설정(네이티브 드라이버·선형 반복)으로 돌린다.
    jest.mocked(Animated.timing).mockRestore();
    const timing = jest.spyOn(Animated, 'timing');
    const onRender = jest.fn();
    const view = await render(
      <Profiler id="fire" onRender={onRender}>
        <FireMotion mode="evening" />
      </Profiler>,
    );
    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ useNativeDriver: true, duration: 155 * 4, iterations: -1 }),
    );
    const commits = onRender.mock.calls.length;
    expect(commits).toBeGreaterThan(0);
    // 프레임마다 act 를 따로 닫아야 setState 타이머였다면 프레임마다 커밋이 잡힌다.
    for (let frame = 0; frame < 6; frame += 1) {
      await act(async () => jest.advanceTimersByTime(155));
    }
    expect(onRender).toHaveBeenCalledTimes(commits);
    await view.unmount();
  });
});
