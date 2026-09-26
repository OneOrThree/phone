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
      const style = view.getByTestId(`library-motion-frame-${index}`, {
        includeHiddenElements: true,
      }).props.style;
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

  it.each(['normal', 'new-quest', 'new-reading'] as const)(
    'renders the %s state as decoration',
    async (state) => {
      const view = await render(<LibraryMotion state={state} />);
      expect(view.queryByTestId('library-motion')).toBeNull();
      const layer = view.getByTestId('library-motion', { includeHiddenElements: true });
      expect(layer.props.accessible).toBe(false);
      expect(layer.props.accessibilityElementsHidden).toBe(true);
      expect(layer.props.importantForAccessibility).toBe('no-hide-descendants');
      expect(layer.props['aria-hidden']).toBe(true);
      expect(
        Boolean(view.queryByTestId('library-motion-indicator', { includeHiddenElements: true })),
      ).toBe(state !== 'normal');
      if (state !== 'normal') {
        expect(
          view.getByTestId('library-motion-indicator', { includeHiddenElements: true }).props.style,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ width: 18, height: 18 }),
            expect.objectContaining({ top: -4, left: 75 }),
          ]),
        );
      }
      await view.unmount();
    },
  );

  it('keeps the closed still frame and schedules no sequence under reduce motion', async () => {
    const view = await render(<LibraryMotion trigger={1} reduceMotion />);
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(activeFrame(view)).toBe(0);
    await view.unmount();
  });

  it('keeps the night building layer and renders only the status indicator', async () => {
    const view = await render(<LibraryMotion showFrames={false} state="new-quest" />);
    expect(
      view.queryByTestId('library-motion-frame-0', { includeHiddenElements: true }),
    ).toBeNull();
    expect(
      view.getByTestId('library-motion-indicator', { includeHiddenElements: true }),
    ).toBeTruthy();
    await view.unmount();
  });

  it('does not replay when the parent clears the active trigger', async () => {
    const view = await render(<LibraryMotion trigger={1} />);
    await view.rerender(<LibraryMotion trigger={0} />);
    await act(async () => jest.advanceTimersByTime(240));
    expect(activeFrame(view)).toBe(0);
    await view.unmount();
  });

  it.each([0, 1])(
    'restores the closed frame when trigger decreases to %s during entry',
    async (trigger) => {
      const view = await render(<LibraryMotion entryActive />);
      await view.rerender(<LibraryMotion entryActive trigger={2} />);
      await act(async () => jest.advanceTimersByTime(240));
      expect(activeFrame(view)).toBe(2);
      await view.rerender(<LibraryMotion entryActive trigger={trigger} />);
      expect(activeFrame(view)).toBe(0);
      await act(async () => jest.advanceTimersByTime(1_000));
      expect(activeFrame(view)).toBe(0);
      await view.rerender(<LibraryMotion entryActive trigger={trigger + 1} />);
      await act(async () => jest.advanceTimersByTime(240));
      expect(activeFrame(view)).toBe(2);
      await view.unmount();
    },
  );
});
