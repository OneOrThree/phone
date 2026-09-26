import React from 'react';
import { act, render } from '@testing-library/react-native';
import { MotionContext } from '@/design-system/primitives';
import { VillageObservatoryMotion } from './VillageObservatoryMotion';

describe('VillageObservatoryMotion', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps the telescope closed at idle and plays one arrival sequence with day/night rank state', async () => {
    const view = await render(<VillageObservatoryMotion dayNight="night" />);
    const activeFrame = () =>
      [0, 1, 2, 3].find((index) => {
        const style = view.getByTestId(`village-observatory-frame-${index}`, {
          includeHiddenElements: true,
        }).props.style;
        return Array.isArray(style) && style.some((entry) => entry?.opacity === 1);
      });

    expect(
      view.getByTestId('village-observatory-motion', { includeHiddenElements: true }).props
        .accessibilityElementsHidden,
    ).toBe(true);
    await act(async () => jest.advanceTimersByTime(1000));
    expect(activeFrame()).toBe(0);
    expect(
      view.queryByTestId('village-observatory-rank-indicator', { includeHiddenElements: true }),
    ).toBeNull();

    await view.rerender(
      <VillageObservatoryMotion rankState="rank-updated" generation={1} dayNight="night" />,
    );
    expect(
      view.getByTestId('village-observatory-rank-indicator', { includeHiddenElements: true }),
    ).toBeTruthy();
    const rankBadgeStyle = view.getByTestId('village-observatory-rank-indicator', {
      includeHiddenElements: true,
    }).props.style;
    expect(rankBadgeStyle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ width: 25, height: 25, borderRadius: 13 }),
      ]),
    );
    expect(view.getByText('!', { includeHiddenElements: true })).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(220));
    expect(activeFrame()).toBe(1);
    await act(async () => jest.advanceTimersByTime(440));
    expect(activeFrame()).toBe(3);
    await act(async () => jest.advanceTimersByTime(1000));
    expect(activeFrame()).toBe(3);

    await view.rerender(
      <VillageObservatoryMotion rankState="rank-changed" generation={2} dayNight="day" />,
    );
    expect(
      view.getByTestId('village-observatory-motion', { includeHiddenElements: true }).props
        .accessibilityLabel,
    ).toBeUndefined();
    await view.unmount();
  });

  it('holds on the initial frame and clears the interval when motion is reduced', async () => {
    const clearInterval = jest.spyOn(global, 'clearInterval');
    const view = await render(<VillageObservatoryMotion generation={1} />);
    await act(async () => jest.advanceTimersByTime(220));
    expect(
      view.getByTestId('village-observatory-frame-1', { includeHiddenElements: true }),
    ).toBeTruthy();
    await view.rerender(
      <MotionContext.Provider value>
        <VillageObservatoryMotion generation={1} />
      </MotionContext.Provider>,
    );
    await act(async () => jest.advanceTimersByTime(1000));
    expect(
      view.getByTestId('village-observatory-frame-0', { includeHiddenElements: true }).props.style,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ opacity: 1 })]));
    expect(clearInterval).toHaveBeenCalledTimes(1);

    await view.rerender(<VillageObservatoryMotion reduceMotion generation={2} />);
    await act(async () => jest.advanceTimersByTime(1000));
    expect(
      view.getByTestId('village-observatory-frame-0', { includeHiddenElements: true }).props.style,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ opacity: 1 })]));
    await view.unmount();
    expect(clearInterval).toHaveBeenCalledTimes(1);
  });
});
