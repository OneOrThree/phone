/**
 * 홈 섬 지도가 쓸데없이 통째로 다시 그려지지 않는지 본다(GROMO-2369 앱 최적화).
 * 바다(IslandOcean)는 WorldMap 이 그려질 때마다 같이 그려지므로 그 횟수를 지도 전체 렌더 횟수로 센다.
 */
import React from 'react';
import { Animated, PanResponder, StyleSheet } from 'react-native';
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
const { FinalIsland, WorldMap } = require('./WorldMap') as typeof import('./WorldMap');
const { islandTerrain } = require('./IslandOcean') as typeof import('./IslandOcean');

beforeEach(() => {
  jest.useFakeTimers();
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
        // Animated.loop 이 감싸도 JS 쪽으로 반복하게 한다(건물 모션 반복).
        _isUsingNativeDriver: () => false,
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

test('지도를 끌고 집는 동안에는 지도를 다시 그리지 않고, 손을 떼면 한 번만 같은 자리로 다시 배치한다(GROMO-2373)', async () => {
  const createPan = jest.spyOn(PanResponder, 'create');
  const shifts: number[] = [];
  const setValue = Animated.Value.prototype.setValue;
  jest.spyOn(Animated.Value.prototype, 'setValue').mockImplementation(function (
    this: Animated.Value,
    value: number,
  ) {
    shifts.push(value);
    return setValue.call(this, value);
  });
  const screen = await render(
    <FinalIsland state={initialState(true)} go={jest.fn()} build={jest.fn()} />,
  );
  await act(async () => jest.advanceTimersByTime(500));
  const pan = createPan.mock.calls[0][0];
  const hall = () => StyleSheet.flatten(screen.getByTestId('world-hall-motion').props.style);
  // 홈 카메라 기본 배율(WorldMap: 세로 화면 402×874)과 회관 모션 원점(949, 21).
  const base = (((874 / 874) * 402) / 1536) * 2.8;
  const hallAt = (camera: { x: number; y: number; z: number }) => {
    const scale = base * camera.z;
    return {
      left: 201 - camera.x * scale + 949 * scale,
      top: 437 - camera.y * scale + 21 * scale,
      width: 242 * scale,
    };
  };
  const touch = (...points: [number, number][]) =>
    ({ nativeEvent: { touches: points.map(([pageX, pageY]) => ({ pageX, pageY })) } }) as any;
  const expectHall = (camera: { x: number; y: number; z: number }) => {
    const expected = hallAt(camera);
    expect(hall().left).toBeCloseTo(expected.left);
    expect(hall().top).toBeCloseTo(expected.top);
    expect(hall().width).toBeCloseTo(expected.width);
  };
  // 마지막 손가락 변환(가운데 기준 이동·배율)이 커밋된 회관 자리를 새 카메라 자리로 옮기는지 본다.
  const expectShiftMoves = (from: { x: number; y: number; z: number }, to: typeof from) => {
    const [x, y, k] = shifts.slice(-3);
    const a = hallAt(from),
      b = hallAt(to);
    expect(201 + x + k * (a.left - 201)).toBeCloseTo(b.left);
    expect(437 + y + k * (a.top - 437)).toBeCloseTo(b.top);
    expect(k * a.width).toBeCloseTo(b.width);
  };
  const home = { x: 585, y: 430, z: 1 };
  expectHall(home);

  // 한 손가락 끌기 30번
  mockMapRenders = 0;
  await act(async () => pan.onPanResponderGrant!(touch([200, 400]), {} as any));
  for (let i = 1; i <= 30; i++)
    await act(async () =>
      pan.onPanResponderMove!(touch([200 - 2 * i, 400 - i]), { dx: -2 * i, dy: -i } as any),
    );
  const dragRenders = mockMapRenders;
  const dragged = { x: 585 + 60 / base, y: 430 + 30 / base, z: 1 };
  expect(dragRenders).toBeLessThanOrEqual(1);
  expectHall(home);
  expectShiftMoves(home, dragged);
  await act(async () => pan.onPanResponderRelease!(touch(), {} as any));
  expect(mockMapRenders - dragRenders).toBe(1);
  expectHall(dragged);
  // 손을 떼면 변환은 항등으로 돌아간다(쉬는 동안 터치·배치가 그대로 맞는다).
  expect(shifts.slice(-3)).toEqual([0, 0, 1]);

  // 두 손가락 집기 30번 — 두 손가락 가운데(200, 400)를 고정점으로 1.5배
  mockMapRenders = 0;
  await act(async () => pan.onPanResponderGrant!(touch([100, 400], [300, 400]), {} as any));
  for (let i = 1; i <= 30; i++)
    await act(async () =>
      pan.onPanResponderMove!(touch([100 - (50 * i) / 30, 400], [300 + (50 * i) / 30, 400]), {
        dx: 0,
        dy: 0,
      } as any),
    );
  const pinchRenders = mockMapRenders;
  const anchor = { x: dragged.x + (200 - 201) / base, y: dragged.y + (400 - 437) / base };
  const pinched = {
    x: anchor.x - (200 - 201) / (base * 1.5),
    y: anchor.y - (400 - 437) / (base * 1.5),
    z: 1.5,
  };
  expect(pinchRenders).toBeLessThanOrEqual(1);
  expectHall(dragged);
  expectShiftMoves(dragged, pinched);
  await act(async () => pan.onPanResponderTerminate!(touch(), {} as any));
  expect(mockMapRenders - pinchRenders).toBe(1);
  expectHall(pinched);
  expect(shifts.slice(-3)).toEqual([0, 0, 1]);
  await screen.unmount();
});

test('집었다 손을 떼면 땅 누르기는 커밋된 배율로 같은 월드 점을 고른다(GROMO-2373)', async () => {
  const createPan = jest.spyOn(PanResponder, 'create');
  const onSpot = jest.fn();
  const screen = await render(
    <WorldMap state={initialState(true)} dayNight="day" onSpot={onSpot} />,
  );
  const pan = createPan.mock.calls[0][0];
  const pinch = (distance: number) =>
    ({
      nativeEvent: {
        touches: [
          { pageX: 100, pageY: 400 },
          { pageX: 100 + distance, pageY: 400 },
        ],
      },
    }) as any;
  await act(async () => {
    pan.onPanResponderGrant!(pinch(200), {} as any);
    pan.onPanResponderMove!(pinch(300), {} as any);
    pan.onPanResponderRelease!(pinch(300), {} as any);
  });
  await act(async () => jest.advanceTimersByTime(100));
  // 쉬는 동안 transform 은 항등이라 땅 Pressable 의 로컬 좌표 = 커밋된 배치(1.5배) 좌표다.
  const scale = (((874 / 874) * 402) / 1536) * 2.8 * 1.5;
  const [terrain] = screen.container.queryAll((n) => n.props.source === islandTerrain.day);
  await fireEvent.press(terrain, {
    nativeEvent: { locationX: 585 * scale, locationY: 430 * scale },
  });
  expect(onSpot).toHaveBeenCalledTimes(1);
  expect(onSpot.mock.calls[0][0].x).toBeCloseTo(585);
  expect(onSpot.mock.calls[0][0].y).toBeCloseTo(430);
  await screen.unmount();
});
