/**
 * 집중섬 지도를 끌고 집는 동안 지도를 통째로 다시 그리지 않는지 본다(GROMO-2373).
 * 바다(IslandOcean)는 FishingIsland 가 그려질 때마다 같이 그려지므로 그 횟수를 지도 렌더 횟수로 센다.
 */
import React from 'react';
import { Animated, PanResponder, StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';

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
jest.mock('@/screens/island/IslandOcean', () => {
  const actual = jest.requireActual('@/screens/island/IslandOcean');
  return {
    ...actual,
    IslandOcean: (props: object) => {
      mockMapRenders++;
      return actual.IslandOcean(props);
    },
  };
});
const { FishingActor, FishingIsland, fishingCamera } =
  require('./FishingIsland') as typeof import('./FishingIsland');

afterEach(() => jest.restoreAllMocks());

const touch = (...points: [number, number][]) =>
  ({ nativeEvent: { touches: points.map(([pageX, pageY]) => ({ pageX, pageY })) } }) as any;

test('집중섬 지도를 끄는 동안에는 다시 그리지 않고, 손을 떼면 한 번만 같은 자리로 다시 배치한다', async () => {
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
    <FishingIsland focus={{ x: 50, y: 50 }} spots={[]} onRaft={jest.fn()}>
      {() => null}
    </FishingIsland>,
  );
  const pan = createPan.mock.calls[0][0];
  const map = () => StyleSheet.flatten(screen.getByTestId('fishing-map').props.style);
  const start = fishingCamera(402, 874, 1, { x: 50, y: 50 });
  expect(map().left).toBe(start.left);

  mockMapRenders = 0;
  await act(async () => pan.onPanResponderGrant!(touch([200, 400]), {} as any));
  // 첫 이동은 기준점만 잡는다. 이후 29번 끌어 왼쪽으로 58pt.
  for (let i = 0; i < 30; i++)
    await act(async () =>
      pan.onPanResponderMove!(touch([200 - 2 * i, 400]), { dx: -2 * i } as any),
    );
  const dragRenders = mockMapRenders;
  expect(dragRenders).toBeLessThanOrEqual(1);
  expect(map().left).toBe(start.left);
  // 가운데 기준 이동·배율: 배율 그대로 58pt 왼쪽.
  expect(shifts.slice(-3)).toEqual([-58, 0, 1]);
  await act(async () => pan.onPanResponderRelease!(touch(), {} as any));
  expect(mockMapRenders - dragRenders).toBe(1);
  expect(map().left).toBe(start.left - 58);
  expect(shifts.slice(-3)).toEqual([0, 0, 1]);
  await screen.unmount();
});

test('집중섬 지도를 두 손가락으로 집어도 손을 뗄 때 한 번만 다시 배치한다', async () => {
  const createPan = jest.spyOn(PanResponder, 'create');
  const screen = await render(
    <FishingIsland focus={{ x: 50, y: 50 }} spots={[]} onRaft={jest.fn()}>
      {() => null}
    </FishingIsland>,
  );
  const pan = createPan.mock.calls[0][0];
  const map = () => StyleSheet.flatten(screen.getByTestId('fishing-map').props.style);

  mockMapRenders = 0;
  await act(async () => pan.onPanResponderGrant!(touch([100, 400], [300, 400]), {} as any));
  // 첫 이동은 손가락 수, 둘째는 처음 거리(202)를 잡고, 마지막엔 260 → 260/202배.
  for (let i = 0; i <= 30; i++)
    await act(async () =>
      pan.onPanResponderMove!(touch([100 - i, 400], [300 + i, 400]), { dx: 0, dy: 0 } as any),
    );
  const pinchRenders = mockMapRenders;
  expect(pinchRenders).toBeLessThanOrEqual(1);
  await act(async () => pan.onPanResponderRelease!(touch(), {} as any));
  expect(mockMapRenders - pinchRenders).toBe(1);
  const zoomed = fishingCamera(402, 874, 260 / 202, { x: 50, y: 50 });
  expect(map().width).toBeCloseTo(zoomed.size);
  expect(map().left).toBeCloseTo(zoomed.left);
  await screen.unmount();
});

test('화면 가장자리 자리의 머리 위 말풍선·이름은 보이는 범위 안으로 밀린다(GROMO-2409)', async () => {
  const actor = (x: number, name: string) => (size: number, sizeY: number) => (
    <FishingActor
      key={name}
      spot={{ x, y: 40, face: 1 }}
      size={size}
      sizeY={sizeY}
      color="white"
      name={name}
      subject="수학"
      seconds={60}
      reduce
    />
  );
  const screen = await render(
    <FishingIsland focus={{ x: 50, y: 50 }} spots={[]} onRaft={jest.fn()}>
      {(size, sizeY) => [actor(20, '민지')(size, sizeY), actor(50, '두부')(size, sizeY)]}
    </FishingIsland>,
  );
  const view = fishingCamera(402, 874, 1, { x: 50, y: 50 });
  const a = view.size * 0.077,
    centered = a / 2 - 100,
    left = (id: string) =>
      screen.getAllByTestId(id).map((node) => StyleSheet.flatten(node.props.style).left);
  const [edgeLabel, middleLabel] = left('fishing-actor-label');
  const [edgeName, middleName] = left('fishing-actor-name');
  // 가운데 자리는 그대로
  expect(middleLabel).toBe(centered);
  expect(middleName).toBe(centered);
  // 왼쪽 가장자리 자리: 말풍선(폭 66) 왼쪽 끝이 화면 왼쪽(지도 x = sx)에 맞고, 이름도 안쪽으로 밀린다
  const labelCenter = (view.size * 20) / 100 + edgeLabel - centered;
  expect(labelCenter - 33).toBeCloseTo(view.sx);
  expect(edgeName).toBeGreaterThan(centered);
  await screen.unmount();
});
