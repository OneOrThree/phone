import React from 'react';
import { act, render } from '@testing-library/react-native';
import { MotionContext } from '@/design-system/primitives';
import { VillageObservatoryMotion } from './VillageObservatoryMotion';

describe('VillageObservatoryMotion', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('cycles four telescope frames and exposes day/night rank states', async () => {
    const view = await render(<VillageObservatoryMotion rankState="rank-updated" dayNight="night" />);
    const activeFrame = () =>
      [0, 1, 2, 3].find((index) => {
        const style = view.getByTestId(`village-observatory-frame-${index}`).props.style;
        return Array.isArray(style) && style.some((entry) => entry?.opacity === 1);
      });

    expect(view.getByTestId('village-observatory-rank-indicator')).toBeTruthy();
    expect(view.getByTestId('village-observatory-motion').props.accessibilityLabel).toContain('밤');
    await act(async () => jest.advanceTimersByTime(220));
    expect(activeFrame()).toBe(1);
    await act(async () => jest.advanceTimersByTime(660));
    expect(activeFrame()).toBe(0);

    await view.rerender(<VillageObservatoryMotion rankState="rank-changed" dayNight="day" />);
    expect(view.getByTestId('village-observatory-motion').props.accessibilityLabel).toContain(
      '주간 순위가 변동되었습니다',
    );
    await view.unmount();
  });

  it('holds on the initial frame and clears the interval when motion is reduced', async () => {
    const clearInterval = jest.spyOn(global, 'clearInterval');
    const view = await render(<VillageObservatoryMotion />);
    await act(async () => jest.advanceTimersByTime(220));
    expect(view.getByTestId('village-observatory-frame-1')).toBeTruthy();
    await view.rerender(
      <MotionContext.Provider value>
        <VillageObservatoryMotion />
      </MotionContext.Provider>,
    );
    await act(async () => jest.advanceTimersByTime(1000));
    expect(view.getByTestId('village-observatory-frame-0').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
    );
    expect(clearInterval).toHaveBeenCalledTimes(1);

    await view.rerender(<VillageObservatoryMotion reduceMotion />);
    await act(async () => jest.advanceTimersByTime(1000));
    expect(view.getByTestId('village-observatory-frame-0').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
    );
    await view.unmount();
    expect(clearInterval).toHaveBeenCalledTimes(1);
  });
});
