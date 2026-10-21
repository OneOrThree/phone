import React from 'react';
import { act, configure, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { observeAnimatedOnJsDriver } from '../animatedJsDriver.testing';

// 장식 모션은 스크린리더에서 숨기므로 숨김 요소까지 조회한다.
configure({ defaultIncludeHiddenElements: true });
import { MotionContext } from '@/design-system/primitives';
import { VillageObservatoryMotion } from './VillageObservatoryMotion';

type MotionView = Awaited<ReturnType<typeof render>>;

// 프레임은 겹친 레이어의 opacity 로 바뀐다. Jest 에서는 JS 드라이버로 진행을 관찰한다.
const activeFrame = (view: MotionView) =>
  [0, 1, 2, 3].find(
    (index) =>
      StyleSheet.flatten(view.getByTestId(`village-observatory-frame-${index}`).props.style)
        .opacity === 1,
  );

describe('VillageObservatoryMotion', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    observeAnimatedOnJsDriver();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps the door closed at idle and plays one arrival sequence without a rank badge', async () => {
    const view = await render(<VillageObservatoryMotion dayNight="night" />);

    expect(view.getByTestId('village-observatory-motion').props.accessibilityLabel).toContain('밤');
    await act(async () => jest.advanceTimersByTime(1000));
    expect(activeFrame(view)).toBe(0);
    expect(view.queryByTestId('village-observatory-rank-indicator')).toBeNull();

    await view.rerender(
      <VillageObservatoryMotion rankState="rank-updated" generation={1} dayNight="night" />,
    );
    expect(view.queryByTestId('village-observatory-rank-indicator')).toBeNull();
    await act(async () => jest.advanceTimersByTime(220));
    expect(activeFrame(view)).toBe(1);
    await act(async () => jest.advanceTimersByTime(440));
    expect(activeFrame(view)).toBe(3);
    await act(async () => jest.advanceTimersByTime(219));
    expect(activeFrame(view)).toBe(3);
    await act(async () => jest.advanceTimersByTime(1));
    expect(activeFrame(view)).toBe(0);
    await act(async () => jest.advanceTimersByTime(1000));
    expect(activeFrame(view)).toBe(0);

    await view.rerender(
      <VillageObservatoryMotion rankState="rank-changed" generation={2} dayNight="day" />,
    );
    expect(view.getByTestId('village-observatory-motion').props.accessibilityLabel).toContain(
      '주간 순위가 변동되었습니다',
    );
    await view.unmount();
  });

  it('holds on the initial frame when motion is reduced', async () => {
    const view = await render(<VillageObservatoryMotion generation={1} />);
    await act(async () => jest.advanceTimersByTime(220));
    expect(activeFrame(view)).toBe(1);
    await view.rerender(
      <MotionContext.Provider value>
        <VillageObservatoryMotion generation={1} />
      </MotionContext.Provider>,
    );
    expect(activeFrame(view)).toBe(0);
    await act(async () => jest.advanceTimersByTime(1000));
    expect(activeFrame(view)).toBe(0);

    await view.rerender(<VillageObservatoryMotion reduceMotion generation={2} />);
    await act(async () => jest.advanceTimersByTime(1000));
    expect(activeFrame(view)).toBe(0);
    await view.unmount();
  });

  it('테마가 적용되면 현재 프레임 모양 그대로 착색 레이어를 덧입힌다', async () => {
    const view = await render(<VillageObservatoryMotion themed />);
    expect(view.getByTestId('village-observatory-theme-tint-0').props.source).toBe(
      view.getByTestId('village-observatory-frame-0').props.source,
    );
    await view.rerender(<VillageObservatoryMotion themed showFrames={false} />);
    expect(view.queryByTestId('village-observatory-theme-tint-0')).toBeNull();
    await view.unmount();
  });
});
