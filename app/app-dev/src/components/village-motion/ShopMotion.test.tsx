import React from 'react';
import { act, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { componentTokens } from '@/design-system/tokens';
import { ShopMotion } from './ShopMotion';

type MotionView = Awaited<ReturnType<typeof render>>;

describe('ShopMotion', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const activeFrame = (view: MotionView) =>
    [0, 1, 2, 3].find((index) => {
      const style = view.getByTestId(`shop-motion-frame-${index}`, { includeHiddenElements: true })
        .props.style;
      return Array.isArray(style) && style.some((entry) => entry?.opacity === 1);
    });

  it('plays four frames and waits exactly 20 seconds after a run ends', async () => {
    const view = await render(<ShopMotion />);

    await act(async () => jest.advanceTimersByTime(20_000));
    expect(activeFrame(view)).toBe(0);
    await act(async () => jest.advanceTimersByTime(230));
    expect(activeFrame(view)).toBe(1);
    await act(async () => jest.advanceTimersByTime(230));
    expect(activeFrame(view)).toBe(2);
    await act(async () => jest.advanceTimersByTime(230));
    expect(activeFrame(view)).toBe(3);

    await act(async () => jest.advanceTimersByTime(19_999));
    expect(activeFrame(view)).toBe(3);
    await act(async () => jest.advanceTimersByTime(1));
    expect(activeFrame(view)).toBe(0);
    await view.unmount();
  });

  it.each([
    ['normal', '상점'],
    ['new-product', '상점, 새 상품'],
    ['purchasable', '상점, 구매 가능'],
  ] as const)('exposes the %s state and its highlight', async (state, label) => {
    const view = await render(<ShopMotion state={state} />);
    expect(
      view.getByTestId('shop-motion', { includeHiddenElements: true }).props
        .accessibilityElementsHidden,
    ).toBe(true);
    expect(
      view.getByTestId('shop-motion', { includeHiddenElements: true }).props
        .importantForAccessibility,
    ).toBe('no-hide-descendants');
    expect(view.queryByLabelText(label)).toBeNull();
    if (state === 'normal') {
      expect(
        view.queryByTestId('shop-motion-highlight', { includeHiddenElements: true }),
      ).toBeNull();
      expect(view.queryByTestId('shop-motion-tooltip', { includeHiddenElements: true })).toBeNull();
    } else {
      expect(
        view.getByTestId('shop-motion-highlight', { includeHiddenElements: true }),
      ).toBeTruthy();
      expect(view.getByTestId('shop-motion-tooltip', { includeHiddenElements: true })).toBeTruthy();
      expect(
        StyleSheet.flatten(
          view.getByTestId('shop-motion-highlight', { includeHiddenElements: true }).props.style,
        ),
      ).toMatchObject({
        borderRadius: componentTokens.shopStatusLabel.highlightRadius,
        borderWidth: componentTokens.shopStatusLabel.highlightBorderWidth,
      });
    }
    await view.unmount();
  });

  it('holds the still frame when reduce motion is enabled', async () => {
    const view = await render(<ShopMotion reduceMotion />);
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(activeFrame(view)).toBe(0);
    await view.unmount();
  });
});
