import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { observeAnimatedOnJsDriver } from '../animatedJsDriver.testing';
import { MotionContext } from '@/design-system/primitives';
import { componentTokens } from '@/design-system/tokens';
import { Text } from '@/design-system/typography';
import { VillageHallMotion } from './VillageHallMotion';

type MotionView = Awaited<ReturnType<typeof render>>;

// 프레임은 겹친 레이어의 opacity 로 바뀐다. Jest 에서는 JS 드라이버로 진행을 관찰한다.
const activeFrame = (view: MotionView) =>
  [0, 1, 2, 3].find(
    (index) =>
      StyleSheet.flatten(view.getByTestId(`village-hall-frame-${index}`).props.style).opacity === 1,
  );

describe('VillageHallMotion', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    observeAnimatedOnJsDriver();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('opens and closes through all four source frames for record and weekly-goal states', async () => {
    const view = await render(<VillageHallMotion state="new-record" />);

    await act(async () => jest.advanceTimersByTime(180));
    expect(activeFrame(view)).toBe(1);
    await act(async () => jest.advanceTimersByTime(180));
    expect(activeFrame(view)).toBe(2);
    await act(async () => jest.advanceTimersByTime(180));
    expect(activeFrame(view)).toBe(3);
    await act(async () => jest.advanceTimersByTime(180));
    expect(activeFrame(view)).toBe(2);
    await view.rerender(<VillageHallMotion state="weekly-goal" />);
    expect(activeFrame(view)).toBe(0);
    await view.unmount();
  });

  it('holds still for normal state without an outline and supports a caller-supplied tooltip', async () => {
    const view = await render(
      <VillageHallMotion state="normal" tooltip={<Text>Weekly goal</Text>} />,
    );
    expect(activeFrame(view)).toBe(0);
    expect(view.queryByTestId('village-hall-highlight')).toBeNull();
    const tooltip = view.getByTestId('village-hall-tooltip');
    expect(tooltip).toBeTruthy();
    expect(tooltip.props.style).toMatchObject({
      paddingVertical: componentTokens.villageNotificationTooltip.paddingVertical,
    });
    await view.unmount();
  });

  it('overlays a translucent tinted alpha mask while preserving the active frame texture', async () => {
    const view = await render(<VillageHallMotion state="arrival" themed />);
    const tintOpacities = () =>
      [0, 1, 2, 3].map(
        (index) =>
          StyleSheet.flatten(view.getByTestId(`village-hall-theme-tint-${index}`).props.style)
            .opacity,
      );
    const { opacity } = componentTokens.villageBuildingThemeTint;
    expect(activeFrame(view)).toBe(0);
    expect(
      StyleSheet.flatten(view.getByTestId('village-hall-theme-tint-0').props.style),
    ).toMatchObject({ tintColor: componentTokens.villageBuildingThemeTint.color });
    [0, 1, 2, 3].forEach((index) =>
      expect(view.getByTestId(`village-hall-theme-tint-${index}`).props.source).toBe(
        view.getByTestId(`village-hall-frame-${index}`).props.source,
      ),
    );
    // 착색은 지금 보이는 프레임의 것 하나만 반투명하게 보인다.
    expect(tintOpacities()).toEqual([opacity, 0, 0, 0]);
    await act(async () => jest.advanceTimersByTime(180));
    expect(activeFrame(view)).toBe(1);
    expect(tintOpacities()).toEqual([0, opacity, 0, 0]);
    await view.unmount();
  });

  it('does not animate with reduce motion from props or MotionContext', async () => {
    const view = await render(<VillageHallMotion state="new-record" />);
    await act(async () => jest.advanceTimersByTime(180));
    expect(activeFrame(view)).toBe(1);
    await view.rerender(<VillageHallMotion state="new-record" reduceMotion />);
    await act(async () => jest.advanceTimersByTime(1000));
    expect(activeFrame(view)).toBe(0);
    await view.rerender(
      <MotionContext.Provider value>
        <VillageHallMotion state="weekly-goal" />
      </MotionContext.Provider>,
    );
    await act(async () => jest.advanceTimersByTime(1000));
    expect(activeFrame(view)).toBe(0);
    await view.unmount();
  });
});
