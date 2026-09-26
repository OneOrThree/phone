import React from 'react';
import { Animated, AppState } from 'react-native';
import { render } from '@testing-library/react-native';
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
