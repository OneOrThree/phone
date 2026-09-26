import React from 'react';
import { act, render } from '@testing-library/react-native';
import { MotionContext } from '@/design-system/primitives';
import { VillageObservatoryMotion } from './VillageObservatoryMotion';

describe('VillageObservatoryMotion', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps the door closed at idle and plays one arrival sequence without a rank badge', async () => {
    const view = await render(<VillageObservatoryMotion dayNight="night" />);
    const activeFrame = () =>
      [0, 1, 2, 3].find((index) => {
        const style = view.getByTestId(`village-observatory-frame-${index}`).props.style;
        return Array.isArray(style) && style.some((entry) => entry?.opacity === 1);
      });

    expect(view.getByTestId('village-observatory-motion').props.accessibilityLabel).toContain('밤');
    await act(async () => jest.advanceTimersByTime(1000));
    expect(activeFrame()).toBe(0);
    expect(view.queryByTestId('village-observatory-rank-indicator')).toBeNull();

    await view.rerender(
      <VillageObservatoryMotion rankState="rank-updated" generation={1} dayNight="night" />,
    );
    expect(view.queryByTestId('village-observatory-rank-indicator')).toBeNull();
    await act(async () => jest.advanceTimersByTime(220));
    expect(activeFrame()).toBe(1);
    await act(async () => jest.advanceTimersByTime(440));
    expect(activeFrame()).toBe(3);
    await act(async () => jest.advanceTimersByTime(220));
    expect(activeFrame()).toBe(0);

    await view.rerender(
      <VillageObservatoryMotion rankState="rank-changed" generation={2} dayNight="day" />,
    );
    expect(view.getByTestId('village-observatory-motion').props.accessibilityLabel).toContain(
      '주간 순위가 변동되었습니다',
    );
    await view.unmount();
  });

  it('holds on the initial frame and clears the interval when motion is reduced', async () => {
    const clearTimeout = jest.spyOn(global, 'clearTimeout');
    const view = await render(<VillageObservatoryMotion generation={1} />);
    await act(async () => jest.advanceTimersByTime(220));
    expect(view.getByTestId('village-observatory-frame-1')).toBeTruthy();
    await view.rerender(
      <MotionContext.Provider value>
        <VillageObservatoryMotion generation={1} />
      </MotionContext.Provider>,
    );
    await act(async () => jest.advanceTimersByTime(1000));
    expect(view.getByTestId('village-observatory-frame-0').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
    );
    expect(clearTimeout).toHaveBeenCalled();

    await view.rerender(<VillageObservatoryMotion reduceMotion generation={2} />);
    await act(async () => jest.advanceTimersByTime(1000));
    expect(view.getByTestId('village-observatory-frame-0').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
    );
    await view.unmount();
    expect(clearTimeout).toHaveBeenCalled();
  });
});
