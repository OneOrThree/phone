import React from 'react';
import { Animated, AppState, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { assets } from '@/constants/assets';
import { RaftWaterMotion } from './RaftWaterMotion';

test('뗏목 주변 물결은 동작 줄이기 설정을 존중한다', async () => {
  const previousAppState = AppState.currentState;
  (AppState as { currentState: string | null }).currentState = 'active';
  const loopStart = jest.fn();
  const loopStop = jest.fn();
  const loop = jest.spyOn(Animated, 'loop').mockReturnValue({
    start: loopStart,
    stop: loopStop,
    reset: jest.fn(),
  } as unknown as Animated.CompositeAnimation);

  const screen = await render(<RaftWaterMotion />);
  expect(screen.getByTestId('raft-water-motion-left')).toBeTruthy();
  expect(screen.getByTestId('raft-water-motion-right')).toBeTruthy();
  expect(screen.getByTestId('raft-water-motion-bottom')).toBeTruthy();
  expect(loopStart).toHaveBeenCalledTimes(1);

  await screen.rerender(<RaftWaterMotion reduceMotion />);
  expect(loopStop).toHaveBeenCalled();
  await screen.unmount();
  loop.mockRestore();
  (AppState as { currentState: string | null }).currentState = previousAppState;
});

test.each([0.25, 0.5, 1, 2])(
  '뗏목 내부 물결 위치와 크기는 월드 배율 %s를 따른다',
  async (scale) => {
    const screen = await render(
      <RaftWaterMotion
        reduceMotion
        style={{ left: 185 * scale, top: 835 * scale, width: 210 * scale, height: 92 * scale }}
      />,
    );
    const left = StyleSheet.flatten(screen.getByTestId('raft-water-motion-left').props.style);
    const right = StyleSheet.flatten(screen.getByTestId('raft-water-motion-right').props.style);
    const bottom = StyleSheet.flatten(screen.getByTestId('raft-water-motion-bottom').props.style);
    const back = screen.getByTestId('raft-water-motion-raft-back');
    const front = screen.getByTestId('raft-water-motion-raft-front');
    expect(back.props.source).toBe(assets['boats/raft/layers/back-day.png']);
    expect(front.props.source).toBe(assets['boats/raft/layers/front-day.png']);
    expect(StyleSheet.flatten(back.props.style)).toMatchObject({
      left: (-48 * (210 * scale)) / 928,
      top: (-307 * (92 * scale)) / 669,
      width: (1024 * (210 * scale)) / 928,
      height: (1024 * (92 * scale)) / 669,
    });
    expect(StyleSheet.flatten(front.props.style)).toEqual(StyleSheet.flatten(back.props.style));
    expect(left).toMatchObject({
      left: 0,
      top: 45 * scale,
      width: 44 * scale,
      height: 12 * scale,
      borderBottomWidth: 2 * scale,
    });
    expect(right).toMatchObject({
      right: 0,
      top: 35 * scale,
      width: 46 * scale,
      height: 12 * scale,
    });
    expect(bottom).toMatchObject({
      left: 70 * scale,
      bottom: 0,
      width: 70 * scale,
      height: 12 * scale,
    });
    expect(left.top + left.height).toBeLessThanOrEqual(92 * scale);
    expect(bottom.left + bottom.width).toBeLessThanOrEqual(210 * scale);
    await screen.unmount();
  },
);

test('뗏목은 야간 팔레트 레이어를 사용한다', async () => {
  const screen = await render(<RaftWaterMotion reduceMotion dayNight="night" />);
  expect(screen.getByTestId('raft-water-motion-raft-back').props.source).toBe(
    assets['boats/raft/layers/back-night.png'],
  );
  expect(screen.getByTestId('raft-water-motion-raft-front').props.source).toBe(
    assets['boats/raft/layers/front-night.png'],
  );
  await screen.unmount();
});
