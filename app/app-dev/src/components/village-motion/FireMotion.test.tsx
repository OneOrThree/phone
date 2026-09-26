import React from 'react';
import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { MotionContext } from '@/design-system/primitives';
import { FireMotion } from './FireMotion';

type MotionView = Awaited<ReturnType<typeof render>>;

describe('FireMotion', () => {
  let onAppStateChange: ((state: AppStateStatus) => void) | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
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

  const activeFrame = (view: MotionView, mode: 'day' | 'evening') =>
    [0, 1, 2, 3].find((index) => {
      return view.getByTestId(`fire-motion-frame-${mode}-${index}`).props.opacity > 0;
    });
  const visibleFrameCount = (view: MotionView, mode: 'day' | 'evening') =>
    [0, 1, 2, 3].filter((index) => {
      return view.getByTestId(`fire-motion-frame-${mode}-${index}`).props.opacity > 0;
    }).length;
  const corePath = (view: MotionView) => view.getByTestId('fire-motion-core-path').props.d;

  it('loops through day smoke frames every 360ms', async () => {
    const view = await render(<FireMotion mode="day" />);
    expect(activeFrame(view, 'day')).toBe(0);
    expect(view.getByTestId('fire-motion-frame-day-0').props.clipPath).toBe('fire-motion-core');
    expect(corePath(view)).toContain('M165 26');
    expect(view.queryByTestId('fire-motion-day-log-cover')).toBeNull();
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
    expect(view.getByTestId('fire-motion-frame-evening-1').props.clipPath).toBe('fire-motion-core');
    expect(corePath(view)).toContain('M165 16');
    expect(view.getByTestId('fire-motion-glow')).toBeTruthy();
    expect(view.queryByTestId('fire-motion-quiet-unlit-core')).toBeNull();
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

  it('residentCount changes the visible ember pace and glow intensity', async () => {
    const empty = await render(<FireMotion mode="evening" residentCount={0} />);
    expect(empty.getByTestId('fire-motion').props.style).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ opacity: 0.68 })]),
    );
    expect(empty.getByTestId('fire-motion-quiet-unlit-core').props.opacity).toBe(1);
    expect(empty.getByTestId('fire-motion-frame-evening-1').props).toMatchObject({
      opacity: 0.52,
      clipPath: 'fire-motion-quiet-core',
      x: 55,
      y: 26,
      width: 220,
      height: 147,
    });
    expect(empty.getByTestId('fire-motion-quiet-core-path').props.d).toContain('M165 16');
    const emptyGlow = empty
      .getByTestId('fire-motion-glow')
      .props.style.find((style: { opacity?: number }) => style?.opacity !== undefined).opacity;
    await act(async () => jest.advanceTimersByTime(210));
    expect(activeFrame(empty, 'evening')).toBe(2);
    await empty.unmount();

    const group = await render(<FireMotion mode="evening" residentCount={5} />);
    const groupGlow = group
      .getByTestId('fire-motion-glow')
      .props.style.find((style: { opacity?: number }) => style?.opacity !== undefined).opacity;
    await act(async () => jest.advanceTimersByTime(155));
    expect(activeFrame(group, 'evening')).toBe(2);
    expect(groupGlow).toBeGreaterThan(emptyGlow);
    await group.unmount();
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

  it('MotionContext의 동작 줄이기 설정이 개별 prop 없이도 애니메이션을 멈춘다', async () => {
    const view = await render(
      <MotionContext.Provider value={true}>
        <FireMotion mode="evening" />
      </MotionContext.Provider>,
    );
    await act(async () => jest.advanceTimersByTime(5_000));
    expect(activeFrame(view, 'evening')).toBe(1);
    await view.unmount();
  });

  it('fills the parent using the 100:71 fire-core box ratio', async () => {
    const view = await render(<FireMotion />);
    expect(view.getByTestId('fire-motion').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          width: '100%',
          height: '100%',
          aspectRatio: 100 / 71,
        }),
      ]),
    );
    await view.unmount();
  });

  it('clears the active frame timeout on unmount', async () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const view = await render(<FireMotion />);
    const frameTimerIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 155);
    expect(frameTimerIndex).toBeGreaterThanOrEqual(0);
    const frameTimer = setTimeoutSpy.mock.results[frameTimerIndex]?.value;
    await view.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(frameTimer);
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });
});
