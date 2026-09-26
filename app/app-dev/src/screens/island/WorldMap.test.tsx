import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { FinalIsland, WorldMap } from '@/screens/island/WorldMap';
import { buildingNames, initialState } from '@/services/model';
import { BUILDING_TRANSITION_DURATION_MS } from '@/services/buildingTransition';
import { OBSERVATORY_ENTRY_DURATION_MS } from '@/components/village-motion/VillageObservatoryMotion';
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

afterEach(cleanup);

test('홈 회관 모션은 실제 월드 배율에 맞춰 정적 레이어를 대체하고 전환 세대마다 재생한다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
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
  expect(screen.getByTestId('world-hall-motion').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: 402 / 2 - 585 * worldScale + 950 * worldScale,
        top: 874 / 2 - 430 * worldScale + 20 * worldScale,
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
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('board')) island.buildings.push('board');
  const screen = await render(<WorldMap state={state} />);

  expect(screen.queryByTestId('world-static-building-board')).toBeNull();
  expect(screen.queryByTestId('village-board-new-indicator')).toBeNull();
  const worldScale = (((874 / 874) * 402) / 1536) * 2.8;
  expect(screen.getByTestId('world-board-indicator').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: 402 / 2 - 585 * worldScale + 858 * worldScale,
        top: 874 / 2 - 430 * worldScale + 158 * worldScale,
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
  jest.useRealTimers();
});

test('전망대는 기본 상태에서 닫힌 채 정지하고 진입 세대에서만 프레임을 연다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('tower')) island.buildings.push('tower');
  const screen = await render(<WorldMap state={state} />);
  const activeFrame = () =>
    [0, 1, 2, 3].find((index) => {
      const style = screen.getByTestId(`village-observatory-frame-${index}`, {
        includeHiddenElements: true,
      }).props.style;
      return Array.isArray(style) && style.some((entry) => entry?.opacity === 1);
    });

  await act(async () => jest.advanceTimersByTime(2000));
  expect(activeFrame()).toBe(0);
  expect(
    screen.getByTestId('world-observatory-motion', { includeHiddenElements: true }).props
      .accessibilityElementsHidden,
  ).toBe(true);
  const worldScale = (((874 / 874) * 402) / 1536) * 2.8;
  expect(
    screen.getByTestId('world-observatory-motion', { includeHiddenElements: true }).props.style,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: 201 - 585 * worldScale + 152 * worldScale,
        top: 437 - 430 * worldScale + 23 * worldScale,
      }),
    ]),
  );
  await screen.rerender(<WorldMap state={state} towerArrivalActive towerArrivalGeneration={1} />);
  await act(async () => jest.advanceTimersByTime(220));
  expect(activeFrame()).toBe(1);
  await act(async () => jest.advanceTimersByTime(440));
  expect(activeFrame()).toBe(3);
  await screen.unmount();
  jest.useRealTimers();
});

test('주간 전망대 테마는 대기 중 유지하고 진입 모션 중에만 숨긴다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  island.buildingThemes = { ...island.buildingThemes, tower: 'rose' };
  const screen = await render(<WorldMap state={state} />);

  expect(screen.getByTestId('world-themed-building-tower')).toBeTruthy();
  await screen.rerender(<WorldMap state={state} towerArrivalActive towerArrivalGeneration={1} />);

  expect(screen.queryByTestId('world-themed-building-tower')).toBeNull();
  expect(
    screen.getByTestId('world-observatory-motion', { includeHiddenElements: true }),
  ).toBeTruthy();
  await screen.rerender(<WorldMap state={state} />);
  expect(screen.getByTestId('world-themed-building-tower')).toBeTruthy();

  jest.setSystemTime(new Date('2026-06-15T22:00:00'));
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(screen.getByTestId('world-themed-building-tower')).toBeTruthy();
  await screen.unmount();
  jest.useRealTimers();
});

test('야간 건물 진입은 주간 스프라이트 없이도 강조 피드백을 제공한다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 5, 15, 22));
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  for (const building of ['hall', 'board', 'tower'] as const) {
    if (!island.buildings.includes(building)) island.buildings.push(building);
  }
  const screen = await render(
    <WorldMap
      state={state}
      hallMotionActive
      hallMotionGeneration={1}
      towerArrivalActive
      towerArrivalGeneration={1}
    />,
  );

  expect(screen.getByTestId('world-static-building-hall')).toBeTruthy();
  const worldScale = (((874 / 874) * 402) / 1536) * 2.8;
  const worldLeft = 402 / 2 - 585 * worldScale;
  const worldTop = 874 / 2 - 430 * worldScale;
  expect(screen.getByTestId('world-hall-motion').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 950 * worldScale,
        top: worldTop + 20 * worldScale,
      }),
    ]),
  );
  expect(screen.queryByTestId('village-hall-frame-0')).toBeNull();
  expect(screen.getByTestId('village-hall-highlight')).toBeTruthy();
  expect(screen.getByText('마을 회관에 들어가는 중')).toBeTruthy();
  expect(screen.getByTestId('world-static-building-board')).toBeTruthy();
  expect(screen.getByTestId('world-board-indicator').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 858 * worldScale,
        top: worldTop + 158 * worldScale,
      }),
    ]),
  );

  expect(screen.getByTestId('world-static-building-tower')).toBeTruthy();
  expect(
    screen.queryByTestId('village-observatory-frame-0', { includeHiddenElements: true }),
  ).toBeNull();
  expect(
    screen.getByTestId('village-observatory-entry-highlight', { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(
    screen.getByTestId('village-observatory-entry-feedback', { includeHiddenElements: true }),
  ).toBeTruthy();
  await screen.unmount();
  jest.useRealTimers();
});

test('랭킹 상태는 전망대 건물 버튼의 접근성 라벨에만 포함한다', async () => {
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('tower')) island.buildings.push('tower');
  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      observatoryRankState="rank-changed"
      showHud={false}
      showActions={false}
    />,
  );

  expect(screen.getByLabelText(`${buildingNames.tower}, 주간 순위가 변동되었습니다`)).toBeTruthy();
  expect(
    screen.getByTestId('world-observatory-motion', { includeHiddenElements: true }).props
      .accessibilityElementsHidden,
  ).toBe(true);
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

test('레이어드 마을 전망대에도 순위 알림과 진입 모션을 전달한다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const state = initialState(true);
  const screen = await render(
    <WorldMap
      state={state}
      village={villageScene(['tower'])}
      observatoryRankState="rank-updated"
      towerArrivalActive
      towerArrivalGeneration={4}
    />,
  );

  expect(
    screen.getByTestId('village-observatory-motion', { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(
    screen.getByTestId('village-observatory-rank-indicator', { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(
    screen.getByTestId('village-observatory-frame-0', { includeHiddenElements: true }),
  ).toBeTruthy();
  await screen.unmount();
  jest.useRealTimers();
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

test('전망대 진입 전환은 마지막 프레임 노출을 마친 뒤 route를 연다', async () => {
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
    await fireEvent.press(screen.getByLabelText(buildingNames.tower));
    expect(
      screen.getByTestId('final-island-content', { includeHiddenElements: true }).props
        .accessibilityElementsHidden,
    ).toBe(true);
    expect(screen.getByLabelText('전망대에 들어가는 중')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(OBSERVATORY_ENTRY_DURATION_MS);
    });
    expect(go).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(BUILDING_TRANSITION_DURATION_MS);
    });
    expect(go).toHaveBeenCalledWith('tower');
    expect(
      screen.getByTestId('final-island-content', { includeHiddenElements: true }).props
        .accessibilityElementsHidden,
    ).toBe(false);
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
