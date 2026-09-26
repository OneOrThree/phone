import React from 'react';
import { act, render } from '@testing-library/react-native';
import { MotionContext } from '@/design-system/primitives';
import { componentTokens } from '@/design-system/tokens';
import { Text } from '@/design-system/typography';
import { VillageHallMotion } from './VillageHallMotion';

describe('VillageHallMotion', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('opens and closes through all four source frames for record and weekly-goal states', async () => {
    const view = await render(<VillageHallMotion state="new-record" />);
    const activeFrame = () =>
      [0, 1, 2, 3].find((index) => {
        const style = view.getByTestId(`village-hall-frame-${index}`).props.style;
        return Array.isArray(style) && style.some((entry) => entry?.opacity === 1);
      });

    await act(async () => jest.advanceTimersByTime(180));
    expect(activeFrame()).toBe(1);
    await act(async () => jest.advanceTimersByTime(180));
    expect(activeFrame()).toBe(2);
    await act(async () => jest.advanceTimersByTime(180));
    expect(activeFrame()).toBe(3);
    await act(async () => jest.advanceTimersByTime(180));
    expect(activeFrame()).toBe(2);
    await view.rerender(<VillageHallMotion state="weekly-goal" />);
    expect(activeFrame()).toBe(0);
    await view.unmount();
  });

  it('holds still for normal state and supports highlight and caller-supplied tooltip', async () => {
    const view = await render(
      <VillageHallMotion state="normal" highlighted tooltip={<Text>Weekly goal</Text>} />,
    );
    expect(view.getByTestId('village-hall-frame-0').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
    );
    expect(view.getByTestId('village-hall-highlight')).toBeTruthy();
    const tooltip = view.getByTestId('village-hall-tooltip');
    expect(tooltip).toBeTruthy();
    expect(tooltip.props.style).toMatchObject({
      paddingVertical: componentTokens.villageNotificationTooltip.paddingVertical,
    });
    await view.unmount();
  });

  it('overlays a translucent tinted alpha mask while preserving the active frame texture', async () => {
    const view = await render(<VillageHallMotion state="arrival" themed />);
    expect(view.getByTestId('village-hall-frame-0').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
    );
    expect(view.getByTestId('village-hall-theme-tint').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tintColor: componentTokens.villageBuildingThemeTint.color,
          opacity: componentTokens.villageBuildingThemeTint.opacity,
        }),
      ]),
    );
    await view.unmount();
  });

  it('does not animate with reduce motion from props or MotionContext and clears its interval', async () => {
    const clearInterval = jest.spyOn(global, 'clearInterval');
    const view = await render(<VillageHallMotion state="new-record" />);
    await act(async () => jest.advanceTimersByTime(180));
    expect(view.getByTestId('village-hall-frame-1')).toBeTruthy();
    await view.rerender(<VillageHallMotion state="new-record" reduceMotion />);
    await act(async () => jest.advanceTimersByTime(1000));
    expect(view.getByTestId('village-hall-frame-0').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
    );
    await view.rerender(
      <MotionContext.Provider value>
        <VillageHallMotion state="weekly-goal" />
      </MotionContext.Provider>,
    );
    await act(async () => jest.advanceTimersByTime(1000));
    expect(clearInterval).toHaveBeenCalled();
    await view.unmount();
  });
});
