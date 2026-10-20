/**
 * 홈 섬 지도가 쓸데없이 통째로 다시 그려지지 않는지 본다(GROMO-2369 앱 최적화).
 * 바다(IslandOcean)는 WorldMap 이 그려질 때마다 같이 그려지므로 그 횟수를 지도 전체 렌더 횟수로 센다.
 */
import React from 'react';
import { Animated } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { buildingNames, initialState } from '@/services/model';

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    fontScale: 1,
    compact: false,
    landscape: false,
    tablet: false,
    contentWidth: 402,
    gutter: 20,
    modalWidth: 340,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
  }),
}));
let mockMapRenders = 0;
jest.mock('./IslandOcean', () => {
  const actual = jest.requireActual('./IslandOcean');
  return {
    ...actual,
    IslandOcean: (props: object) => {
      mockMapRenders++;
      return actual.IslandOcean(props);
    },
  };
});
const { FinalIsland } = require('./WorldMap') as typeof import('./WorldMap');

beforeEach(() => {
  jest.useFakeTimers();
  // 떠돌이 고양이 행선지를 고정한다.
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  // 걸음 하나를 95ms 타이머로 끝내 실제처럼 세그먼트마다 콜백이 따로 돈다.
  jest.spyOn(Animated, 'timing').mockImplementation(
    (value, config) =>
      ({
        start: (callback?: Animated.EndCallback) => {
          setTimeout(() => {
            (value as Animated.ValueXY).setValue(config.toValue as never);
            callback?.({ finished: true });
          }, 95);
        },
        stop: jest.fn(),
        reset: jest.fn(),
      }) as unknown as Animated.CompositeAnimation,
  );
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('고양이가 건물까지 걷는 동안 지도 전체를 걸음마다 다시 그리지 않는다(GROMO-2371)', async () => {
  const state = initialState(true);
  state.settings.reduceMotion = false;
  const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
  await act(async () => jest.advanceTimersByTime(500));
  mockMapRenders = 0;

  await fireEvent.press(screen.getByLabelText(buildingNames.hall));
  for (let i = 0; i < 60; i++) await act(async () => jest.advanceTimersByTime(50));

  // 고친 전에는 걸음(약 30칸)마다 한 번씩 32번 그렸다. 걷기 시작·멈춤 상태 전환만 남는다.
  expect(mockMapRenders).toBeLessThanOrEqual(3);
  await screen.unmount();
});
