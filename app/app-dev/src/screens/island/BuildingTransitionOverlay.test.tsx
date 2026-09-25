import React from 'react';
import { render } from '@testing-library/react-native';
import { Animated, StyleSheet } from 'react-native';
import { BuildingTransitionOverlay } from './BuildingTransitionOverlay';
import type { BuildingTransitionState } from '@/services/buildingTransition';

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({ width: 300, height: 400 }),
}));

const state = (overrides: Partial<BuildingTransitionState> = {}): BuildingTransitionState => ({
  phase: 'entering',
  target: 'hall',
  direction: 'enter',
  generation: 1,
  ...overrides,
});

test('idle 상태에서는 전환 덮개를 렌더링하지 않는다', async () => {
  const screen = await render(
    <BuildingTransitionOverlay
      state={state({ phase: 'idle', target: null, direction: null })}
      reduceMotion={false}
      origin={{ x: 10, y: 20 }}
    />,
  );

  expect(screen.queryByTestId('building-transition-overlay')).toBeNull();
});

test('reduceMotion이면 진행 상태여도 애니메이션 덮개를 생략한다', async () => {
  const timing = jest.spyOn(Animated, 'timing');
  try {
    const screen = await render(
      <BuildingTransitionOverlay
        state={state()}
        reduceMotion
        origin={{ x: 10, y: 20 }}
      />,
    );

    expect(screen.queryByTestId('building-transition-overlay')).toBeNull();
    expect(timing).not.toHaveBeenCalled();
  } finally {
    timing.mockRestore();
  }
});

test('진입 시 선택한 원점을 중심으로 화면 전체를 덮는 확대 애니메이션을 시작한다', async () => {
  const timing = jest.spyOn(Animated, 'timing');
  try {
    const screen = await render(
      <BuildingTransitionOverlay
        state={state()}
        reduceMotion={false}
        origin={{ x: 75, y: 125 }}
      />,
    );
    const overlay = screen.getByTestId('building-transition-overlay', {
      includeHiddenElements: true,
    });
    const circle = overlay.children[0] as any;
    const style = StyleSheet.flatten(circle.props.style);

    expect(style).toMatchObject({
      width: 1000,
      height: 1000,
      left: -425,
      top: -375,
      borderRadius: 500,
    });
    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 1, duration: 620, useNativeDriver: true }),
    );
  } finally {
    timing.mockRestore();
  }
});

test('복귀 시 축소 방향 애니메이션을 시작한다', async () => {
  const timing = jest.spyOn(Animated, 'timing');
  try {
    await render(
      <BuildingTransitionOverlay
        state={state({ phase: 'returning', direction: 'return' })}
        reduceMotion={false}
        origin={{ x: 75, y: 125 }}
      />,
    );

    expect(timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toValue: 0, duration: 620, useNativeDriver: true }),
    );
  } finally {
    timing.mockRestore();
  }
});
