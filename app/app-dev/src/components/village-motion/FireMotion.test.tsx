import React from 'react';
import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
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
      const style = view.getByTestId(`fire-motion-frame-${mode}-${index}`).props.style;
      return Array.isArray(style) && style.some((entry) => entry?.opacity === 1);
    });
  const visibleFrameCount = (view: MotionView, mode: 'day' | 'evening') =>
    [0, 1, 2, 3].filter((index) => {
      const style = view.getByTestId(`fire-motion-frame-${mode}-${index}`).props.style;
      return Array.isArray(style) && style.some((entry) => entry?.opacity === 1);
    }).length;

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
