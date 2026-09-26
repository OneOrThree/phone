import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { createWorldProjector, FinalIsland } from '@/screens/island/WorldMap';
import { buildingNames, initialState } from '@/services/model';
import { BUILDING_TRANSITION_DURATION_MS } from '@/services/buildingTransition';

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

afterEach(cleanup);

test('걷는 중 카메라가 바뀌면 보관된 진입 콜백도 최신 건물 좌표를 투영한다', () => {
  let viewport = { left: -120, top: -80, scale: 0.7 };
  const projectAtArrival = createWorldProjector(() => viewport);
  const savedEnterCallback = () => projectAtArrival({ x: 1030, y: 268 });

  expect(savedEnterCallback()).toEqual({ x: 601, y: 107.6 });
  viewport = { left: -52, top: -31, scale: 0.84 };
  expect(savedEnterCallback().x).toBeCloseTo(813.2);
  expect(savedEnterCallback().y).toBeCloseTo(194.12);
});

test('방문 섬에서는 축음기를 터치 대상으로 노출하지 않는다', async () => {
  const state = initialState(true);
  const visited = state.islands.find((island) => island.id === 'cloud')!;
  if (!visited.buildings.includes('gram')) visited.buildings.push('gram');
  state.visitingIslandId = visited.id;

  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      notify={jest.fn()}
      showHud={false}
      showActions={false}
    />,
  );

  expect(screen.queryByLabelText(buildingNames.gram)).toBeNull();
});

test('내 섬에서는 축음기를 열 수 있다', async () => {
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('gram')) island.buildings.push('gram');

  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showHud={false}
      showActions={false}
    />,
  );

  screen.getByLabelText(buildingNames.gram);
});

test('내 섬에서도 미완공 축음기는 터치 대상으로 노출하지 않는다', async () => {
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  island.buildings = island.buildings.filter((building) => building !== 'gram');

  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showHud={false}
      showActions={false}
    />,
  );

  expect(screen.queryByLabelText(buildingNames.gram)).toBeNull();
});

test('건물을 연타해도 걷기와 확대 전환을 한 번만 실행하고 완료 뒤 route를 연다', async () => {
  jest.useFakeTimers();
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(
    (_value: Animated.Value | Animated.ValueXY, _config: Animated.TimingAnimationConfig) =>
      ({
        start: (callback?: Animated.EndCallback) => callback?.({ finished: true }),
        stop: jest.fn(),
        reset: jest.fn(),
      }) as unknown as Animated.CompositeAnimation,
  );
  const state = initialState(true);
  const go = jest.fn();
  try {
    const screen = await render(
      <FinalIsland state={state} go={go} build={jest.fn()} showHud={false} showActions={false} />,
    );
    const hall = screen.getByLabelText(buildingNames.hall);

    await fireEvent.press(hall);
    await fireEvent.press(hall);

    expect(go).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('building-transition-overlay', { includeHiddenElements: true }),
    ).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(BUILDING_TRANSITION_DURATION_MS);
    });
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith('hall');

    await act(async () => {
      jest.advanceTimersByTime(900);
    });
  } finally {
    timing.mockRestore();
    jest.useRealTimers();
  }
});

test('reduceMotion에서는 건물 도착 직후 overlay 없이 route를 연다', async () => {
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(
    (_value: Animated.Value | Animated.ValueXY, _config: Animated.TimingAnimationConfig) =>
      ({
        start: (callback?: Animated.EndCallback) => callback?.({ finished: true }),
        stop: jest.fn(),
        reset: jest.fn(),
      }) as unknown as Animated.CompositeAnimation,
  );
  const state = initialState(true);
  state.settings.reduceMotion = true;
  const go = jest.fn();
  try {
    const screen = await render(
      <FinalIsland state={state} go={go} build={jest.fn()} showHud={false} showActions={false} />,
    );

    await fireEvent.press(screen.getByLabelText(buildingNames.hall));

    expect(go).toHaveBeenCalledWith('hall');
    expect(screen.queryByTestId('building-transition-overlay')).toBeNull();
  } finally {
    timing.mockRestore();
  }
});
