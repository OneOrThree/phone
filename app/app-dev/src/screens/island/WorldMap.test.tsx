import React from 'react';
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  renderHook,
} from '@testing-library/react-native';
import { Animated, Platform } from 'react-native';
import {
  constructionPlacement,
  createWorldProjector,
  FinalIsland,
  useVillageDayNight,
  WorldMap,
} from '@/screens/island/WorldMap';
import { buildingNames, initialState } from '@/services/model';
import {
  BUILDING_ENTRY_DURATION_MS,
  BUILDING_TRANSITION_DURATION_MS,
} from '@/services/buildingTransition';
import { villageScene } from '@/utils/village-world';
import { assets } from '@/constants/assets';

// 건물 모션·알림 배지는 장식 레이어라 스크린리더에서 숨긴다. 배치 검증을 위해 숨김 요소까지 조회한다.
configure({ defaultIncludeHiddenElements: true });

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

test('홈 우체통의 서버 상태는 로컬 상태보다 우선하고 배지와 접근성 라벨을 함께 갱신한다', async () => {
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('mail')) island.buildings.push('mail');
  state.friends?.forEach((friend) => {
    friend.messages = [];
  });
  const renderHome = (showMailboxLetters?: boolean) => (
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showMailboxLetters={showMailboxLetters}
    />
  );
  const screen = await render(renderHome(true));
  expect(screen.getByTestId('mailbox-new-indicator', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByLabelText('우체통, 친구에게 받은 새 편지가 있어요')).toBeTruthy();

  const friend = state.friends!.find((item) => item.status === 'friend')!;
  friend.messages.push({
    id: 'local-unread',
    memberId: friend.id,
    name: friend.name,
    color: friend.color,
    text: '로컬 편지',
    at: Date.now(),
    status: 'sent',
  });
  await screen.rerender(renderHome(false));
  expect(screen.queryByTestId('mailbox-new-indicator')).toBeNull();
  expect(screen.queryByLabelText('우체통, 친구에게 받은 새 편지가 있어요')).toBeNull();

  await screen.rerender(renderHome());
  expect(screen.getByTestId('mailbox-new-indicator', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByLabelText('우체통, 친구에게 받은 새 편지가 있어요')).toBeTruthy();
});

test('방문 섬에는 서버 미읽음 상태가 있어도 내 편지 배지와 안내를 표시하지 않는다', async () => {
  const state = initialState(true);
  const visited = state.islands.find((island) => island.id === 'cloud')!;
  if (!visited.buildings.includes('mail')) visited.buildings.push('mail');
  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      viewingIslandId={visited.id}
      showMailboxLetters
    />,
  );
  expect(screen.queryByTestId('mailbox-new-indicator')).toBeNull();
  expect(screen.queryByLabelText('우체통, 친구에게 받은 새 편지가 있어요')).toBeNull();
});

test('방문 섬에는 내 섬 게시판과 도서관 알림을 표시하지 않는다', async () => {
  const state = initialState(true);
  const visited = state.islands.find((island) => island.id === 'cloud')!;
  if (!visited.buildings.includes('board')) visited.buildings.push('board');
  if (!visited.buildings.includes('library')) visited.buildings.push('library');

  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      viewingIslandId={visited.id}
      boardStatus="new-comment"
      libraryState="new-reading"
    />,
  );

  expect(
    screen.queryByTestId('village-board-new-indicator', { includeHiddenElements: true }),
  ).toBeNull();
  expect(
    screen.queryByTestId('library-motion-indicator', { includeHiddenElements: true }),
  ).toBeNull();
});

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
        left: worldLeft + 949 * worldScale,
        top: worldTop + 21 * worldScale,
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
  expect(
    screen.getByTestId('village-board-new-indicator', { includeHiddenElements: true }).props
      .accessibilityLabel,
  ).toBe('새 댓글이 있습니다');
  expect(
    screen.getByTestId('village-board-new-indicator', { includeHiddenElements: true }).props.style,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ top: -20 * worldScale, right: 12 * worldScale }),
    ]),
  );
  const boardBadgeSize = screen
    .getByTestId('village-board-new-indicator', { includeHiddenElements: true })
    .props.style.find((entry: { width?: number }) => entry?.width != null);
  expect(boardBadgeSize.width).toBeCloseTo(25 * worldScale * 0.72);
  expect(boardBadgeSize.height).toBeCloseTo(25 * worldScale * 0.72);
  expect(screen.queryByTestId('village-board-tooltip')).toBeNull();
  await screen.unmount();
  jest.useRealTimers();
});

test('새 편지가 있으면 정적 우체통을 펠리컨으로 교체하고 공용 ! 배지를 표시한다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const state = initialState(true);
  const friend = state.friends?.find((item) => item.status === 'friend');
  const island = state.islands.find((item) => item.id === state.islandId)!;
  island.buildingThemes = { ...island.buildingThemes, mail: 'rose' };
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
  expect(screen.queryByTestId('world-static-building-mail')).toBeNull();
  expect(screen.getByTestId('mailbox-pelican')).toBeTruthy();
  expect(screen.queryByTestId('world-themed-building-mail')).toBeNull();
  expect(
    screen.getByTestId('mailbox-new-indicator', { includeHiddenElements: true }).props
      .accessibilityLabel,
  ).toBe('친구에게 받은 새 편지가 있습니다');
  expect(
    screen.getByTestId('mailbox-new-indicator', { includeHiddenElements: true }).props.style,
  ).toEqual(
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

test('마을 미리보기 우체통도 미읽음 때 펠리컨으로 교체하고 배지를 유지한다', async () => {
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('mail')) island.buildings.push('mail');
  const scene = villageScene(island.buildings);
  const screen = await render(<WorldMap state={state} village={scene} showMailboxLetters />);
  expect(screen.getByTestId('village-mailbox-pelican').props.source).toBe(
    assets['characters/pelican/npc/on-mailbox.png'],
  );
  expect(
    screen.getByTestId('village-mailbox-new-indicator', { includeHiddenElements: true }),
  ).toBeTruthy();
  await screen.rerender(<WorldMap state={state} village={scene} showMailboxLetters={false} />);
  expect(screen.queryByTestId('village-mailbox-pelican')).toBeNull();
  expect(screen.queryByTestId('village-mailbox-new-indicator')).toBeNull();
});

test.each([
  ['purchasable', 'rank-updated'],
  ['new-product', 'rank-changed'],
  ['normal', 'normal'],
] as const)(
  '상점 %s와 전망대 %s는 이름표 없이 상태를 접근성 문구로 안내한다',
  async (shopState, observatoryRankState) => {
    const state = initialState(true);
    const island = state.islands.find((item) => item.id === state.islandId)!;
    for (const building of ['shop', 'tower'] as const)
      if (!island.buildings.includes(building)) island.buildings.push(building);
    const screen = await render(
      <FinalIsland
        state={state}
        go={jest.fn()}
        build={jest.fn()}
        shopState={shopState}
        observatoryRankState={observatoryRankState}
      />,
    );
    for (const building of ['shop', 'tower']) {
      expect(screen.queryByTestId(`building-name-${building}`)).toBeNull();
    }
    // 장식 모션은 스크린리더에서 숨기므로 순위 변동은 실제 전망대 버튼이 읽어 준다.
    const rankText =
      observatoryRankState === 'rank-updated'
        ? '주간 순위가 갱신되었어요'
        : observatoryRankState === 'rank-changed'
          ? '주간 순위가 바뀌었어요'
          : null;
    const towerButtons = screen
      .getAllByRole('button')
      .filter((node) => String(node.props.accessibilityLabel ?? '').includes('전망대'));
    expect(towerButtons.length).toBeGreaterThan(0);
    for (const button of towerButtons) {
      if (rankText) {
        expect(button.props.accessibilityLabel).toContain(rankText);
        expect(button.props.accessibilityHint).toBe('전망대에서 주간 순위를 확인하세요');
      } else expect(button.props.accessibilityLabel).not.toContain('주간 순위');
    }
  },
);

test.each(['board'] as const)(
  '진입 스프라이트가 없는 %s는 620ms 뒤 라우트를 연다',
  async (building) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-15T12:00:00'));
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(
      () =>
        ({
          start: (callback?: Animated.EndCallback) => callback?.({ finished: true }),
          stop: jest.fn(),
          reset: jest.fn(),
        }) as unknown as Animated.CompositeAnimation,
    );
    try {
      const state = initialState(true);
      const island = state.islands.find((item) => item.id === state.islandId)!;
      if (!island.buildings.includes(building)) island.buildings.push(building);
      const go = jest.fn();
      const screen = await render(<FinalIsland state={state} go={go} build={jest.fn()} />);
      await fireEvent.press(screen.getByLabelText(buildingNames[building]));
      await act(async () => jest.advanceTimersByTime(BUILDING_TRANSITION_DURATION_MS - 1));
      expect(go).not.toHaveBeenCalled();
      await act(async () => jest.advanceTimersByTime(1));
      expect(go).toHaveBeenCalledWith(building);
      await screen.unmount();
    } finally {
      timing.mockRestore();
      jest.useRealTimers();
    }
  },
);

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
        left: worldLeft + 150 * worldScale,
        top: worldTop + 24 * worldScale,
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
  expect(screen.queryByTestId('building-name-shop')).toBeNull();
  expect(screen.queryByText(buildingNames.shop)).toBeNull();

  await screen.rerender(
    <FinalIsland state={state} go={jest.fn()} build={jest.fn()} shopState="purchasable" />,
  );
  screen.getByLabelText(`${buildingNames.shop}, 구매 가능한 상품이 있어요`);
  expect(screen.queryByTestId('shop-motion-tooltip')).toBeNull();
  await screen.unmount();
  jest.useRealTimers();
});

test('완공된 건물은 이름표 없이 접근성 이름으로 식별한다', async () => {
  const state = initialState(true);
  const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);

  for (const building of ['hall', 'board', 'gram', 'library', 'mail', 'tower', 'shop'] as const) {
    expect(screen.queryByTestId(`building-name-${building}`)).toBeNull();
    expect(screen.queryByText(buildingNames[building])).toBeNull();
    expect(screen.getByRole('button', { name: buildingNames[building] })).toBeTruthy();
  }
  await screen.unmount();
});

test('뗏목은 이름표 없이 접근성 이름으로 식별한다', async () => {
  const state = initialState(true);
  const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);

  expect(screen.queryByText('뗏목')).toBeNull();
  expect(screen.queryByTestId('building-name-raft')).toBeNull();
  expect(screen.getByRole('button', { name: '뗏목' })).toBeTruthy();
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
  expect(
    screen.getByTestId('world-library-motion', { includeHiddenElements: true }).props.style,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 1120 * worldScale,
        top: worldTop + 288 * worldScale,
        width: 239 * worldScale,
        height: 323 * worldScale,
      }),
    ]),
  );
  const libraryBadgeSize = screen
    .getByTestId('library-motion-indicator', { includeHiddenElements: true })
    .props.style.find((entry: { width?: number }) => entry?.width != null);
  const mailboxBadgeSize = 25 * worldScale * 0.72;
  expect(libraryBadgeSize.width).toBeCloseTo(mailboxBadgeSize);
  expect(libraryBadgeSize.height).toBeCloseTo(mailboxBadgeSize);
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
  expect(screen.getByTestId('world-raft-water-motion').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 185 * worldScale,
        top: worldTop + 835 * worldScale,
        width: 210 * worldScale,
        height: 92 * worldScale,
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
  expect(night.getByTestId('world-fire-motion').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 405 * worldScale,
        top: worldTop + 437 * worldScale,
        width: 140 * worldScale,
        height: 93 * worldScale,
      }),
    ]),
  );
  expect(night.queryByTestId('fire-motion-glow')).toBeNull();
  await night.unmount();
  jest.useRealTimers();
});

test('demo night 쿼리는 현재 시간이 낮이어도 저녁 모습을 고정한다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const previousOS = Platform.OS;
  const previousLocation = window.location;
  (Platform as { OS: string }).OS = 'web';
  Object.defineProperty(window, 'location', {
    value: { search: '?demo=1&night=1' },
    configurable: true,
  });

  try {
    const screen = await render(<WorldMap state={initialState(true)} />);
    expect(screen.getByTestId('world-fire-motion').props.accessibilityLabel).toBe(
      '모닥불, 저녁, 불꽃',
    );
    await screen.unmount();
  } finally {
    (Platform as { OS: string }).OS = previousOS;
    Object.defineProperty(window, 'location', {
      value: previousLocation,
      configurable: true,
    });
    jest.useRealTimers();
  }
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
  expect(
    screen.getByTestId('village-board-new-indicator', { includeHiddenElements: true }).props
      .accessibilityLabel,
  ).toBe('새 댓글이 있습니다');
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
  // 회관 상태는 이름표로 안내하므로 강조선을 그리지 않는다.
  expect(screen.queryByTestId('village-hall-highlight')).toBeNull();
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
  // 회관 문 모션은 낮에만 그린다.
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const screen = await render(<WorldMap state={state} hallMotionActive />);

  expect(screen.queryByTestId('world-building-theme-hall')).toBeNull();
  expect(screen.getByTestId('village-hall-theme-tint').props.source).toBe(
    screen.getByTestId('village-hall-frame-0').props.source,
  );
  await screen.unmount();
  jest.useRealTimers();
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

  const construction = screen.getByTestId('village-construction-library');
  screen.getByTestId('construction-sprite-library-structure');
  const worldScale = (((874 / 874) * 402) / 1536) * 2.8;
  expect(construction.props.style).toEqual(
    expect.objectContaining({
      left: 1120 * worldScale,
      top: 288 * worldScale,
      width: 239 * worldScale,
      height: 323 * worldScale,
    }),
  );
  expect(construction.props.accessibilityLabel).toBe('도서관 골조 공사 중');
  expect(screen.queryByLabelText(buildingNames.library)).toBeNull();
});

test('공사 sprite 배치는 기존 마을과 레이어드 마을의 좌표계를 구분한다', () => {
  expect(constructionPlacement('shop', false)).toEqual({
    x: 587,
    y: 779,
    w: 262,
    h: 199,
  });
  expect(constructionPlacement('shop', true)).toMatchObject({
    x: 1000,
    y: 751,
    w: 262,
    h: 199,
  });
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

test('낮·밤 판정은 현지 18시 경계를 지난 다음 분 갱신에서 밤으로 바뀐다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T17:59:30'));
  const hook = await renderHook(() => useVillageDayNight());
  expect(hook.result.current).toBe('day');

  await act(async () => jest.advanceTimersByTime(60_000));
  expect(hook.result.current).toBe('night');
  await hook.unmount();
  jest.useRealTimers();
});

test('WorldMap 은 부모가 넘긴 낮·밤을 자체 시각 판정보다 우선한다', async () => {
  const state = initialState(true);
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const own = await render(<WorldMap state={state} />);
  expect(own.getByTestId('village-hall-frame-0').props.source).toBe(
    require('@/assets/village-world/motion/hall/frame-0.png'),
  );
  await own.unmount();

  const screen = await render(<WorldMap state={state} dayNight="night" />);
  // 낮 시각이어도 부모가 밤이라고 넘기면 밤 프레임과 밤 배경을 쓴다.
  expect(screen.getByTestId('village-hall-frame-0').props.source).toBe(
    require('@/assets/village-world/motion/hall/night-frame-0.png'),
  );
  await screen.unmount();
  jest.useRealTimers();
});

test('테마 회관·상점·전망대·도서관은 낮·밤 모두 정적 레이어 대신 현재 모션 프레임에 착색한다', async () => {
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  for (const building of ['hall', 'shop', 'tower', 'library'] as const) {
    if (!island.buildings.includes(building)) island.buildings.push(building);
  }
  island.buildingThemes = {
    ...island.buildingThemes,
    hall: 'pink',
    shop: 'pink',
    tower: 'pink',
    library: 'pink',
  } as any;
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));

  // 진입 중이 아니어도(유휴 모션 포함) 정적 테마 레이어를 겹쳐 그리지 않는다.
  const day = await render(<WorldMap state={state} />);
  for (const building of ['hall', 'shop', 'tower', 'library']) {
    expect(day.queryByTestId(`world-building-theme-${building}`)).toBeNull();
  }
  for (const tint of [
    'village-hall-theme-tint',
    'shop-motion-theme-tint',
    'village-observatory-theme-tint',
    'library-motion-theme-tint',
  ]) {
    expect(day.getByTestId(tint)).toBeTruthy();
  }
  await day.unmount();

  // 밤에도 밤 프레임 위에 착색하므로 정적 밤 테마 레이어를 겹쳐 그리지 않는다.
  jest.setSystemTime(new Date('2026-06-15T22:00:00'));
  const night = await render(<WorldMap state={state} />);
  for (const building of ['hall', 'shop', 'tower', 'library']) {
    expect(night.queryByTestId(`world-building-theme-${building}`)).toBeNull();
  }
  expect(night.getByTestId('village-hall-theme-tint').props.source).toBe(
    require('@/assets/village-world/motion/hall/night-frame-0.png'),
  );
  await night.unmount();
  jest.useRealTimers();
});

test('밤에도 회관은 밤 문 프레임을 먼저 보여 준 뒤 라우트를 연다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T22:00:00'));
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(
    () =>
      ({
        start: (callback?: Animated.EndCallback) => callback?.({ finished: true }),
        stop: jest.fn(),
        reset: jest.fn(),
      }) as unknown as Animated.CompositeAnimation,
  );
  try {
    const state = initialState(true);
    const go = jest.fn();
    const screen = await render(<FinalIsland state={state} go={go} build={jest.fn()} />);
    const nightFrame = screen.getByTestId('village-hall-frame-0').props.source;
    expect(nightFrame).toBe(require('@/assets/village-world/motion/hall/night-frame-0.png'));

    await fireEvent.press(screen.getByLabelText(buildingNames.hall));
    await act(async () => jest.advanceTimersByTime(BUILDING_TRANSITION_DURATION_MS));
    expect(go).not.toHaveBeenCalled();
    await act(async () =>
      jest.advanceTimersByTime(BUILDING_ENTRY_DURATION_MS - BUILDING_TRANSITION_DURATION_MS),
    );
    expect(go).toHaveBeenCalledWith('hall');
    await screen.unmount();
  } finally {
    timing.mockRestore();
    jest.useRealTimers();
  }
});

test('뗏목 탭 영역은 부두 끝이 아니라 배경에 그려진 뗏목 위에 있고 누르면 배 화면을 연다', async () => {
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
    // 낚시섬 문의 명시 탭 영역(x 1230)으로 월드 배율을 구한다.
    const fishing = screen.getByLabelText('낚시섬 구경하기').props.style;
    const s = fishing.left / 1230;
    const raft = screen.getByLabelText('뗏목').props.style;

    // 배경 base/day.png 의 뗏목 그림(x 205~375, y 820~920)을 덮는다.
    expect(raft.left / s).toBeLessThanOrEqual(205);
    expect((raft.left + raft.width) / s).toBeGreaterThanOrEqual(375);
    expect(raft.top / s).toBeLessThanOrEqual(820);
    expect((raft.top + raft.height) / s).toBeGreaterThanOrEqual(920);

    await fireEvent.press(screen.getByLabelText('뗏목'));
    expect(go).toHaveBeenCalledWith('boat');
  } finally {
    timing.mockRestore();
  }
});
