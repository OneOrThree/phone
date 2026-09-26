import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { BuildingTransitionOverlay } from './BuildingTransitionOverlay';
import { BUILDING_TRANSITION_DURATION_MS } from '@/services/buildingTransition';
import { OBSERVATORY_ENTRY_DURATION_MS } from '@/components/village-motion/VillageObservatoryMotion';

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  }),
}));

test('전망대 확대 오버레이는 스프라이트 진입 프레임 뒤에 시작한다', async () => {
  jest.useFakeTimers();
  const timing = jest
    .spyOn(Animated, 'timing')
    .mockImplementation(
      (_value: Animated.Value | Animated.ValueXY, _config: Animated.TimingAnimationConfig) =>
        ({
          start: jest.fn(),
          stop: jest.fn(),
          reset: jest.fn(),
        }) as unknown as Animated.CompositeAnimation,
    );
  try {
    const view = await render(
      <BuildingTransitionOverlay
        state={{ phase: 'entering', target: 'tower', direction: 'enter', generation: 1 }}
        reduceMotion={false}
        origin={{ x: 180, y: 240 }}
      />,
    );
    expect(
      view.getByTestId('building-transition-overlay', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(timing).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(OBSERVATORY_ENTRY_DURATION_MS - 1);
    });
    expect(timing).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: BUILDING_TRANSITION_DURATION_MS }),
    );
    await view.unmount();
  } finally {
    timing.mockRestore();
    jest.useRealTimers();
  }
});
