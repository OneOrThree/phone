import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { FinalIsland, WorldMap } from '@/screens/island/WorldMap';
import { buildingNames, initialState } from '@/services/model';
import { BUILDING_ENTRY_DURATION_MS } from '@/services/buildingTransition';

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
  const worldLeft = 402 / 2 - 585 * worldScale;
  const worldTop = 874 / 2 - 430 * worldScale;
  expect(screen.getByTestId('world-hall-motion').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 950 * worldScale,
        top: worldTop + 20 * worldScale,
        width: 242 * worldScale,
        height: 244 * worldScale,
      }),
    ]),
  );
  expect(screen.queryByTestId('village-hall-highlight')).toBeNull();
  expect(screen.queryByText('마을 회관에 들어가는 중')).toBeNull();

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
  const worldLeft = 402 / 2 - 585 * worldScale;
  const worldTop = 874 / 2 - 430 * worldScale;
  expect(screen.getByTestId('world-board-indicator').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 858 * worldScale,
        top: worldTop + 158 * worldScale,
        width: 80 * worldScale,
        height: 80 * worldScale,
      }),
    ]),
  );

  await screen.rerender(<WorldMap state={state} boardStatus="new-comment" />);
  expect(screen.getByTestId('village-board-new-indicator').props.accessibilityLabel).toBe(
    '새 댓글이 있습니다',
  );
  expect(screen.getByTestId('village-board-new-indicator').props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ top: 0, left: -29 * worldScale })]),
  );
  expect(screen.queryByTestId('village-board-tooltip')).toBeNull();
  await screen.unmount();
  jest.useRealTimers();
});

test('새 편지가 있으면 우편함은 그대로 두고 ! 배지만 표시한다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const state = initialState(true);
  const friend = state.friends?.find((item) => item.status === 'friend');
  friend?.messages.push({
    id: 'new-letter',
    memberId: friend.id,
    name: friend.name,
    color: friend.color,
    text: '새 편지',
    at: Date.now(),
    status: 'sent',
  });

  const screen = await render(<WorldMap state={state} />);
  const worldScale = (((874 / 874) * 402) / 1536) * 2.8;
  const worldLeft = 402 / 2 - 585 * worldScale;
  const worldTop = 874 / 2 - 430 * worldScale;
  expect(screen.getByTestId('world-static-building-mail')).toBeTruthy();
  expect(screen.queryByTestId('mailbox-pelican')).toBeNull();
  expect(screen.getByTestId('mailbox-new-indicator').props.accessibilityLabel).toBe(
    '친구에게 받은 새 편지가 있습니다',
  );
  expect(screen.getByTestId('mailbox-new-indicator').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 348 * worldScale,
        top: worldTop + 520 * worldScale,
      }),
    ]),
  );
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
      const style = screen.getByTestId(`village-observatory-frame-${index}`).props.style;
      return Array.isArray(style) && style.some((entry) => entry?.opacity === 1);
    });
  const worldScale = (((874 / 874) * 402) / 1536) * 2.8;
  const worldLeft = 402 / 2 - 585 * worldScale;
  const worldTop = 874 / 2 - 430 * worldScale;

  await act(async () => jest.advanceTimersByTime(2000));
  expect(activeFrame()).toBe(0);
  expect(screen.getByTestId('world-observatory-motion').props.accessibilityLabel).toContain('낮');
  expect(screen.getByTestId('world-observatory-motion').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 152 * worldScale,
        top: worldTop + 23 * worldScale,
        width: 112 * worldScale,
        height: 193 * worldScale,
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

test('홈 상점은 실제 월드 배율로 놓이고 상태 입력이 없으면 강조를 숨긴다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('shop')) island.buildings.push('shop');
  const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
  const worldScale = (((874 / 874) * 402) / 1536) * 2.8;
  const worldLeft = 402 / 2 - 585 * worldScale;
  const worldTop = 874 / 2 - 430 * worldScale;

  expect(screen.queryByTestId('world-static-building-shop')).toBeNull();
  expect(screen.getByTestId('world-shop-motion').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 456 * worldScale,
        top: worldTop + 580 * worldScale,
        width: 262 * worldScale,
        height: 199 * worldScale,
      }),
    ]),
  );
  expect(screen.getByTestId('world-shop-motion').props.accessibilityLabel).toBe('상점');
  expect(screen.queryByTestId('shop-motion-tooltip')).toBeNull();
  expect(screen.getByTestId('building-name-shop')).toBeTruthy();
  expect(screen.getByText(buildingNames.shop)).toBeTruthy();

  await screen.rerender(
    <FinalIsland state={state} go={jest.fn()} build={jest.fn()} shopState="purchasable" />,
  );
  screen.getByLabelText(`${buildingNames.shop}, 구매 가능한 상품이 있어요`);
  expect(screen.queryByTestId('shop-motion-tooltip')).toBeNull();
  await screen.unmount();
  jest.useRealTimers();
});

test('완공된 각 건물에 상태와 무관한 건물명 라벨을 표시한다', async () => {
  const state = initialState(true);
  const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);

  for (const building of ['hall', 'board', 'gram', 'library', 'mail', 'tower', 'shop'] as const) {
    expect(screen.getByTestId(`building-name-${building}`)).toBeTruthy();
    expect(screen.getByText(buildingNames[building])).toBeTruthy();
  }
  for (const building of ['hall', 'library', 'shop'] as const) {
    expect(screen.getByTestId(`building-name-${building}`).props.style).toEqual(
      expect.objectContaining({ alignItems: 'flex-end' }),
    );
  }
  const worldScale = (((874 / 874) * 402) / 1536) * 2.8;
  expect(screen.getByTestId('building-name-shop').props.style).toEqual(
    expect.objectContaining({
      right: (577 - 60 + 120 - (456 + 262)) * worldScale,
      top: (603 - (783 - 95)) * worldScale,
      alignItems: 'flex-end',
    }),
  );
  await screen.unmount();
});

test('상점 진입 세대가 시작되면 대기 없이 문 프레임을 재생한다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const state = initialState(true);
  const screen = await render(<WorldMap state={state} />);

  await screen.rerender(<WorldMap state={state} shopArrivalActive shopArrivalGeneration={1} />);
  await act(async () => jest.advanceTimersByTime(150));
  expect(screen.getByTestId('shop-motion-frame-1').props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
  );

  await screen.unmount();
  jest.useRealTimers();
});

test('홈 도서관은 월드 배율로 놓이고 새 퀘스트 상태를 느낌표와 접근성 문구로 알린다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('library')) island.buildings.push('library');
  const screen = await render(
    <FinalIsland state={state} go={jest.fn()} build={jest.fn()} libraryState="new-quest" />,
  );
  const worldScale = (((874 / 874) * 402) / 1536) * 2.8;
  const worldLeft = 402 / 2 - 585 * worldScale;
  const worldTop = 874 / 2 - 430 * worldScale;

  expect(screen.queryByTestId('world-static-building-library')).toBeNull();
  expect(screen.getByTestId('world-library-motion').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 1120 * worldScale,
        top: worldTop + 289 * worldScale,
        width: 239 * worldScale,
        height: 323 * worldScale,
      }),
    ]),
  );
  expect(screen.getByTestId('library-motion-indicator')).toBeTruthy();
  screen.getByLabelText(`${buildingNames.library}, 새 퀘스트가 있어요`);
  await screen.unmount();
  jest.useRealTimers();
});

test('홈 모닥불은 실제 화덕 경계에서 낮 연기와 밤 불꽃을 재생한다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const state = initialState(true);
  const screen = await render(<WorldMap state={state} />);
  const worldScale = (((874 / 874) * 402) / 1536) * 2.8;
  const worldLeft = 402 / 2 - 585 * worldScale;
  const worldTop = 874 / 2 - 430 * worldScale;

  expect(screen.getByTestId('world-fire-motion').props.accessibilityLabel).toBe('모닥불, 낮, 연기');
  expect(screen.getByTestId('world-fire-motion').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 402 * worldScale,
        top: worldTop + 425 * worldScale,
        width: 116 * worldScale,
        height: 77 * worldScale,
      }),
    ]),
  );
  await act(async () => jest.advanceTimersByTime(360));
  expect(screen.getByTestId('fire-motion-frame-day-1').props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
  );

  await screen.unmount();
  jest.setSystemTime(new Date('2026-06-15T21:00:00'));
  const night = await render(<WorldMap state={state} />);
  expect(night.getByTestId('world-fire-motion').props.accessibilityLabel).toBe(
    '모닥불, 저녁, 불꽃',
  );
  expect(night.queryByTestId('fire-motion-glow')).toBeNull();
  await night.unmount();
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
      jest.advanceTimersByTime(BUILDING_ENTRY_DURATION_MS);
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
