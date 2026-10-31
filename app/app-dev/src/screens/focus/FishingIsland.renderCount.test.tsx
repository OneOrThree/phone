import { FishingFocusHud } from './FishingFocusHud';
/**
 * 집중섬 지도를 끌고 집는 동안 지도를 통째로 다시 그리지 않는지 본다(GROMO-2373).
 * 바다(IslandOcean)는 FishingIsland 가 그려질 때마다 같이 그려지므로 그 횟수를 지도 렌더 횟수로 센다.
 */
import React from 'react';
import { Animated, PanResponder, StyleSheet } from 'react-native';
import { act, render, within } from '@testing-library/react-native';

let mockFontScale = 1;
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    fontScale: mockFontScale,
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
      {(size, sizeY) => (
        <FishingFocusHud subject="영어 공부" seconds={123} size={size} sizeY={sizeY} />
      )}
    </FishingIsland>,
  );
  const pan = createPan.mock.calls[0][0];
  const map = () => StyleSheet.flatten(screen.getByTestId('fishing-map').props.style);
  const start = fishingCamera(402, 874, 1, { x: 50, y: 50 });
  expect(map().left).toBe(start.left);
  const hud = () => within(screen.getByTestId('fishing-map')).getByTestId('fishing-focus-hud');
  const localAnchor = hud().props.style;
  expect(within(hud()).getByText('00:02:03')).toBeTruthy();

  mockMapRenders = 0;
  await act(async () => pan.onPanResponderGrant!(touch([200, 400]), {} as any));
  // 첫 이동은 기준점만 잡는다. 이후 29번 끌어 왼쪽으로 58pt.
  for (let i = 0; i < 30; i++)
    await act(async () =>
      pan.onPanResponderMove!(touch([200 - 2 * i, 400]), { dx: -2 * i, dy: 0 } as any),
    );
  const dragRenders = mockMapRenders;
  expect(dragRenders).toBeLessThanOrEqual(1);
  expect(map().left).toBe(start.left);
  // 가운데 기준 이동·배율: 배율 그대로 58pt 왼쪽.
  expect(shifts.slice(-3)).toEqual([-58, 0, 1]);
  await act(async () => pan.onPanResponderRelease!(touch(), {} as any));
  expect(mockMapRenders - dragRenders).toBe(1);
  expect(map().left).toBe(start.left - 58);
  expect(hud().props.style).toEqual(localAnchor);
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

test.each([0.8, 1.8])(
  '핀치 %s배 중과 손을 뗀 뒤에도 과목·시간의 표시 크기는 고정이고 앵커만 섬을 따른다',
  async (zoom) => {
    const createPan = jest.spyOn(PanResponder, 'create');
    const divide = jest.spyOn(Animated, 'divide');
    const screen = await render(
      <FishingIsland focus={{ x: 50, y: 50 }} spots={[]} onRaft={jest.fn()}>
        {(size, sizeY) => (
          <FishingFocusHud subject="영어 공부" seconds={123} size={size} sizeY={sizeY} />
        )}
      </FishingIsland>,
    );
    const pan = createPan.mock.calls[0][0];
    const mapScale = divide.mock.calls[0][1] as Animated.Value & { __getValue: () => number };
    const inverseScale = divide.mock.results[0].value;
    expect(divide.mock.calls[0][0]).toBe(1);
    const subjectFont = StyleSheet.flatten(screen.getByText('영어 공부').props.style).fontSize;
    const timerFont = StyleSheet.flatten(screen.getByText('00:02:03').props.style).fontSize;
    const checkFont = () => {
      const combinedScale = mapScale.__getValue() * inverseScale.__getValue();
      expect(screen.getByTestId('fishing-focus-hud-content')).toBeTruthy();
      const subject = StyleSheet.flatten(screen.getByText('영어 공부').props.style);
      const timer = StyleSheet.flatten(screen.getByText('00:02:03').props.style);
      expect(subject.fontSize * combinedScale).toBeCloseTo(subjectFont);
      expect(timer.fontSize * combinedScale).toBeCloseTo(timerFont);
    };
    checkFont();
    await act(async () => pan.onPanResponderGrant!(touch([100, 400], [300, 400]), {} as any));
    await act(async () =>
      pan.onPanResponderMove!(touch([100, 400], [300, 400]), { dx: 0, dy: 0 } as any),
    );
    await act(async () =>
      pan.onPanResponderMove!(touch([100, 400], [300, 400]), { dx: 0, dy: 0 } as any),
    );
    mockMapRenders = 0;
    await act(async () =>
      pan.onPanResponderMove!(touch([200 - 100 * zoom, 400], [200 + 100 * zoom, 400]), {
        dx: 0,
        dy: 0,
      } as any),
    );
    expect(mapScale.__getValue()).toBeCloseTo(zoom);
    expect(mockMapRenders).toBeLessThanOrEqual(1);
    checkFont();
    await act(async () => pan.onPanResponderRelease!(touch(), {} as any));
    checkFont();
    const hud = StyleSheet.flatten(screen.getByTestId('fishing-focus-hud').props.style);
    expect(hud.width).toBeCloseTo(256);
    expect(hud.left + hud.width / 2).toBeCloseTo((640 * zoom) / 2);
    expect(hud.top).toBeCloseTo(((640 * zoom * 1024) / 1536) * -0.18);
    await screen.unmount();
  },
);

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

  // 접근성 글자 배율만큼 이름이 넓어지므로 더 많이 민다
  mockFontScale = 2;
  try {
    const large = await render(
      <FishingIsland focus={{ x: 50, y: 50 }} spots={[]} onRaft={jest.fn()}>
        {(size, sizeY) => [actor(20, '민지')(size, sizeY)]}
      </FishingIsland>,
    );
    const [largeName] = large
      .getAllByTestId('fishing-actor-name')
      .map((node) => StyleSheet.flatten(node.props.style).left);
    expect(largeName).toBeGreaterThan(edgeName);
    await large.unmount();
  } finally {
    mockFontScale = 1;
  }
});

test('세로 화면에서도 섬을 아래로 끌어 위쪽 바다를 보고 과목·시간도 같이 옮긴다', async () => {
  const createPan = jest.spyOn(PanResponder, 'create');
  const screen = await render(
    <FishingIsland focus={{ x: 50, y: 50 }} spots={[]} onRaft={jest.fn()}>
      {(size, sizeY) => (
        <FishingFocusHud subject="영어 공부" seconds={123} size={size} sizeY={sizeY} />
      )}
    </FishingIsland>,
  );
  const pan = createPan.mock.calls[0][0];
  const map = () => StyleSheet.flatten(screen.getByTestId('fishing-map').props.style);
  const initialTop = map().top as number;
  const hud = () => within(screen.getByTestId('fishing-map')).getByTestId('fishing-focus-hud');
  const anchor = hud().props.style;
  await act(async () => pan.onPanResponderGrant!(touch([200, 400]), {} as any));
  await act(async () => pan.onPanResponderMove!(touch([200, 400]), { dx: 0, dy: 0 } as any));
  mockMapRenders = 0;
  for (let n = 1; n <= 16; n++)
    await act(async () =>
      pan.onPanResponderMove!(touch([200, 400 + n * 10]), { dx: 0, dy: n * 10 } as any),
    );
  expect(mockMapRenders).toBeLessThanOrEqual(1);
  await act(async () => pan.onPanResponderRelease!(touch(), {} as any));
  expect(map().top).toBeCloseTo(initialTop + 160);
  expect(hud().props.style).toEqual(anchor);
  // 넓어진 위쪽 바다도 타일로 덮는다.
  const visit = (node: any): any[] =>
    !node || typeof node !== 'object'
      ? []
      : Array.isArray(node)
        ? node.flatMap(visit)
        : [
            ...(node.type === 'Image' &&
            node.props.source === require('@/assets/backgrounds/island/ocean/day.png')
              ? [node]
              : []),
            ...visit(node.children),
          ];
  const tiles = visit(screen.toJSON());
  const boxes = tiles.map((node) => StyleSheet.flatten(node.props.style));
  expect(Math.min(...boxes.map((box) => box.top))).toBeLessThanOrEqual(0);
  expect(Math.max(...boxes.map((box) => box.top + box.height))).toBeGreaterThanOrEqual(874);
  await screen.unmount();
});
