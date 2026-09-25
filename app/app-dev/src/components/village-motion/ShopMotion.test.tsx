import React from 'react';
import { act, render } from '@testing-library/react-native';
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
      const style = view.getByTestId(`shop-motion-frame-${index}`).props.style;
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

  it('plays the storefront frames immediately on building entry and holds the open frame', async () => {
    const view = await render(<ShopMotion />);
    await view.rerender(<ShopMotion trigger={1} entryActive />);

    await act(async () => jest.advanceTimersByTime(150));
    expect(activeFrame(view)).toBe(1);
    await act(async () => jest.advanceTimersByTime(300));
    expect(activeFrame(view)).toBe(3);
    await act(async () => jest.advanceTimersByTime(20_000));
    expect(activeFrame(view)).toBe(3);

    await view.rerender(<ShopMotion trigger={1} entryActive={false} />);
    expect(activeFrame(view)).toBe(0);
    await view.unmount();
  });

  it.each([
    ['normal', '상점'],
    ['new-product', '상점, 새 상품'],
    ['purchasable', '상점, 구매 가능'],
  ] as const)('exposes the %s state without outlining the storefront', async (state, label) => {
    const view = await render(<ShopMotion state={state} />);
    expect(view.getByTestId('shop-motion').props.accessibilityLabel).toBe(label);
    expect(view.queryByTestId('shop-motion-highlight')).toBeNull();
    if (state === 'normal') {
      expect(view.queryByTestId('shop-motion-tooltip')).toBeNull();
    } else {
      expect(view.getByTestId('shop-motion-tooltip')).toBeTruthy();
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
