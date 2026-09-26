import React from 'react';
import { act, render } from '@testing-library/react-native';
import { LibraryMotion } from './LibraryMotion';

type MotionView = Awaited<ReturnType<typeof render>>;

describe('LibraryMotion', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const activeFrame = (view: MotionView) =>
    [0, 1, 2, 3].find((index) => {
      const style = view.getByTestId(`library-motion-frame-${index}`).props.style;
      return Array.isArray(style) && style.some((entry) => entry?.opacity === 1);
    });

  it('plays every door frame in order when triggered and returns to still', async () => {
    const view = await render(<LibraryMotion />);
    await view.rerender(<LibraryMotion trigger={1} />);
    expect(activeFrame(view)).toBe(0);

    await act(async () => jest.advanceTimersByTime(120));
    expect(activeFrame(view)).toBe(1);
    await act(async () => jest.advanceTimersByTime(120));
    expect(activeFrame(view)).toBe(2);
    await act(async () => jest.advanceTimersByTime(120));
    expect(activeFrame(view)).toBe(3);
    await act(async () => jest.advanceTimersByTime(120));
    expect(activeFrame(view)).toBe(0);
    await view.unmount();
  });

  it.each([
    ['normal', '도서관'],
    ['new-quest', '도서관, 새 퀘스트'],
    ['new-reading', '도서관, 새 읽을거리'],
  ] as const)('exposes the %s state', async (state, label) => {
    const view = await render(<LibraryMotion state={state} />);
    expect(view.getByTestId('library-motion').props.accessibilityLabel).toBe(label);
    expect(Boolean(view.queryByTestId('library-motion-indicator'))).toBe(state !== 'normal');
    if (state !== 'normal') {
      expect(view.getByTestId('library-motion-indicator').props.style).toEqual(
        expect.objectContaining({
          top: '12%',
          left: -39,
          width: 35,
          height: 35,
        }),
      );
    }
    await view.unmount();
  });

  it('keeps the closed still frame and schedules no sequence under reduce motion', async () => {
    const view = await render(<LibraryMotion trigger={1} reduceMotion />);
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(activeFrame(view)).toBe(0);
    await view.unmount();
  });

  it('keeps the night building layer and renders only the status indicator', async () => {
    const view = await render(<LibraryMotion showFrames={false} state="new-quest" />);
    expect(view.queryByTestId('library-motion-frame-0')).toBeNull();
    expect(view.getByTestId('library-motion-indicator')).toBeTruthy();
    await view.unmount();
  });

  it('does not replay when the parent clears the active trigger', async () => {
    const view = await render(<LibraryMotion trigger={1} />);
    await view.rerender(<LibraryMotion trigger={0} />);
    await act(async () => jest.advanceTimersByTime(240));
    expect(activeFrame(view)).toBe(0);
    await view.unmount();
  });
});
