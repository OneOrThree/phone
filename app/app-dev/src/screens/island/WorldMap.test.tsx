import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { createWorldProjector, FinalIsland, WorldMap } from '@/screens/island/WorldMap';
import { buildingNames, initialState } from '@/services/model';
import { BUILDING_TRANSITION_DURATION_MS } from '@/services/buildingTransition';
import { villageScene } from '@/utils/village-world';

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

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const serverConstructionState = (
  state: ReturnType<typeof initialState>,
  clientConstruction: Record<string, unknown> | null,
  completedBuildings: string[] = ['hall'],
) => {
  state.serverIslands = {
    currentIslandId: 'srv1',
    home: {
      islandId: 'srv1',
      home: {
        island: {
          id: 'srv1',
          name: '공사섬',
          intro: '',
          approvalRequired: false,
          maxMembers: 15,
          role: 'host',
        },
        wallets: { villagePoints: 100 },
        focusSummary: { totalSeconds: 0 },
      },
      completedBuildings,
      members: [],
    },
    clientConstruction,
  } as any;
};

test('홈 회관 모션은 실제 월드 배율에 맞춰 정적 레이어를 대체하고 전환 세대마다 재생한다', async () => {
  jest.useFakeTimers();
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('hall')) island.buildings.push('hall');
  const screen = await render(<WorldMap state={state} hallMotionActive hallMotionGeneration={1} />);

  expect(screen.queryByTestId('world-static-building-hall')).toBeNull();
  const frame = screen.getByTestId('village-hall-frame-0');
  expect(frame.props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
  );
  const worldScale = (((874 / 874) * 402) / 1536) * 2.8;
  const cameraLeft = 402 / 2 - 585 * worldScale;
  const cameraTop = 874 / 2 - 430 * worldScale;
  expect(screen.getByTestId('world-hall-motion').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: cameraLeft + 950 * worldScale,
        top: cameraTop + 20 * worldScale,
        width: 242 * worldScale,
        height: 244 * worldScale,
      }),
    ]),
  );
  expect(screen.getByTestId('village-hall-highlight')).toBeTruthy();
  expect(screen.getByText('마을 회관에 들어가는 중')).toBeTruthy();

  await act(async () => jest.advanceTimersByTime(360));
  expect(screen.getByTestId('village-hall-frame-2').props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
  );
  await screen.rerender(<WorldMap state={state} hallMotionActive hallMotionGeneration={2} />);
  expect(screen.getByTestId('village-hall-frame-0').props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
  );
  await screen.unmount();
  jest.useRealTimers();
});

test('홈 게시판은 월드 배율로 정지 렌더링하고 명시적 상태가 없으면 표시를 숨긴다', async () => {
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('board')) island.buildings.push('board');
  const screen = await render(<WorldMap state={state} />);

  expect(screen.queryByTestId('world-static-building-board')).toBeNull();
  expect(screen.queryByTestId('village-board-new-indicator')).toBeNull();
  const worldScale = (((874 / 874) * 402) / 1536) * 2.8;
  const cameraLeft = 402 / 2 - 585 * worldScale;
  const cameraTop = 874 / 2 - 430 * worldScale;
  expect(screen.getByTestId('world-board-indicator').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: cameraLeft + 858 * worldScale,
        top: cameraTop + 158 * worldScale,
        width: 80 * worldScale,
        height: 80 * worldScale,
      }),
    ]),
  );

  await screen.rerender(<WorldMap state={state} boardStatus="new-comment" />);
  expect(screen.getByTestId('village-board-new-indicator').props.accessibilityLabel).toBe(
    '새 댓글이 있습니다',
  );
  expect(screen.getByTestId('village-board-tooltip')).toBeTruthy();
  await screen.unmount();
});

test('레이어드 마을에서도 게시판 상태를 VillageScenery 알림에 전달한다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('board')) island.buildings.push('board');
  const screen = await render(
    <WorldMap state={state} village={villageScene(['board'])} boardStatus="new-comment" />,
  );

  expect(screen.queryByTestId('world-board-indicator')).toBeNull();
  expect(screen.getByTestId('village-board-scene-indicator')).toBeTruthy();
  expect(screen.getByTestId('village-board-new-indicator').props.accessibilityLabel).toBe(
    '새 댓글이 있습니다',
  );
  expect(screen.getByTestId('village-board-tooltip')).toBeTruthy();
  await screen.unmount();
  jest.useRealTimers();
});

test('레이어드 마을에서도 회관 진입 문 모션을 표시한다', async () => {
  jest.useFakeTimers();
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('hall')) island.buildings.push('hall');
  const screen = await render(
    <WorldMap
      state={state}
      village={villageScene(['hall'])}
      hallMotionActive
      hallMotionGeneration={3}
    />,
  );

  expect(screen.getByTestId('village-hall-scene-motion')).toBeTruthy();
  expect(screen.getByTestId('village-hall-highlight')).toBeTruthy();
  await act(async () => jest.advanceTimersByTime(180));
  expect(screen.getByTestId('village-hall-frame-1').props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
  );
  await screen.unmount();
  jest.useRealTimers();
});

test('테마 회관 진입 중에는 닫힌 문 테마 레이어 대신 현재 모션 프레임을 착색한다', async () => {
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('hall')) island.buildings.push('hall');
  island.buildingThemes = { ...island.buildingThemes, hall: 'pink' } as any;
  const screen = await render(<WorldMap state={state} hallMotionActive />);

  expect(screen.queryByTestId('world-building-theme-hall')).toBeNull();
  expect(screen.getByTestId('village-hall-theme-tint').props.source).toBe(
    screen.getByTestId('village-hall-frame-0').props.source,
  );
  await screen.unmount();
});

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

test('서버 공사 진행률에 해당하는 건물 sprite 단계를 섬 위에 표시한다', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-21T00:10:00Z'));
  const state = initialState(true);
  serverConstructionState(state, {
    islandId: 'srv1',
    building: 'library',
    startedAt: Date.parse('2026-09-21T00:00:00Z'),
    endsAt: Date.parse('2026-09-21T01:00:00Z'),
  });

  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showHud={false}
      showActions={false}
    />,
  );

  screen.getByTestId('village-construction-library');
  screen.getByTestId('construction-sprite-library-structure');
  expect(screen.queryByLabelText(buildingNames.library)).toBeNull();
});

test('클라이언트 계산이 완료 시각에 도달하면 completion sprite를 한 번 표시한다', async () => {
  jest.useFakeTimers();
  let now = Date.parse('2026-09-21T00:59:59Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const state = initialState(true);
  state.settings.reduceMotion = true;
  const active = {
    islandId: 'srv1',
    building: 'library',
    startedAt: Date.parse('2026-09-21T00:00:00Z'),
    endsAt: Date.parse('2026-09-21T01:00:00Z'),
  };
  serverConstructionState(state, active);
  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showHud={false}
      showActions={false}
    />,
  );

  now = Date.parse('2026-09-21T01:00:00Z');
  await screen.rerender(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showHud={false}
      showActions={false}
    />,
  );

  screen.getByTestId('construction-sprite-library-completion');

  // 연출 중 설정 변경으로 effect가 다시 실행돼도 기존 종료 타이머는 살아 있어야 한다.
  state.settings.reduceMotion = false;
  await screen.rerender(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showHud={false}
      showActions={false}
    />,
  );
  await act(async () => jest.advanceTimersByTime(601));
  expect(screen.queryByTestId('construction-sprite-library-completion')).toBeNull();
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
