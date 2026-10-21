import React from 'react';
import { within } from '@testing-library/react-native';
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  renderHook,
} from '@testing-library/react-native';
import { Animated, PanResponder, Platform, StyleSheet } from 'react-native';
import {
  constructionPlacement,
  createWorldProjector,
  FinalIsland,
  useVillageDayNight,
  WorldMap,
} from '@/screens/island/WorldMap';
import { applyLocalePref } from '@/i18n';
import { buildingNames, initialState, reducer } from '@/services/model';
import { villageScene } from '@/utils/village-world';
import { assets } from '@/constants/assets';
import { observeAnimatedOnJsDriver } from '@/components/animatedJsDriver.testing';
import { semanticTokens } from '@/design-system/tokens';
import { TILE_FACILITIES } from '@/screens/island/tileFacilities';
import {
  tileFacilityLayerSource,
  tileFacilityOutlineSource,
} from '@/screens/island/TileFacilityDecoration';

// 건물 모션·알림 배지는 장식 레이어라 스크린리더에서 숨긴다. 배치 검증을 위해 숨김 요소까지 조회한다.
configure({ defaultIncludeHiddenElements: true });

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

test('일반 이미지 섬의 새 편지 터치 영역은 펠리컨 전체를 포함하고 팻말 위치는 유지한다', async () => {
  const state = initialState();
  state.islands.find((island) => island.id === state.islandId)!.buildings = ['mail'];
  const home = (showMailboxLetters: boolean) => (
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showMailboxLetters={showMailboxLetters}
    />
  );
  const screen = await render(home(true));
  const pelican = screen.getByTestId('mailbox-pelican').props.style;
  const touch = screen.getByLabelText('우체통, 친구에게 받은 새 편지가 있어요').props.style;
  const scale = pelican.width / 140;
  expect(touch.left).toBeLessThanOrEqual(250 * scale);
  expect(touch.top).toBeLessThanOrEqual((456 - 24) * scale);
  expect(touch.left + touch.width).toBeGreaterThanOrEqual(390 * scale);
  expect(touch.top + touch.height).toBeGreaterThanOrEqual((596 - 24) * scale);
  const sign = screen.getByTestId('building-name-mail').props.style;
  await screen.rerender(home(false));
  expect(screen.getByTestId('building-name-mail').props.style).toEqual(sign);
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
  observeAnimatedOnJsDriver(); // 건물 모션 진행을 JS 드라이버로 관찰한다(GROMO-2375).
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('hall')) island.buildings.push('hall');
  const screen = await render(<WorldMap state={state} hallMotionActive hallMotionGeneration={1} />);

  expect(screen.queryByTestId('world-static-building-hall')).toBeNull();
  const frame = screen.getByTestId('village-hall-frame-0');
  expect(StyleSheet.flatten(frame.props.style)).toMatchObject({ opacity: 1 });
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
  expect(StyleSheet.flatten(screen.getByTestId('village-hall-frame-2').props.style)).toMatchObject({
    opacity: 1,
  });
  await screen.rerender(<WorldMap state={state} hallMotionActive hallMotionGeneration={2} />);
  expect(StyleSheet.flatten(screen.getByTestId('village-hall-frame-0').props.style)).toMatchObject({
    opacity: 1,
  });
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
  '상점 %s와 전망대 %s는 나무 팻말과 접근성 문구로 안내한다',
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
      expect(screen.getByTestId(`building-name-${building}`)).toBeTruthy();
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

test.each(['board'] as const)('%s에 도착하면 전환 대기 없이 라우트를 연다', async (building) => {
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
    expect(go).toHaveBeenCalledWith(building);
    await screen.unmount();
  } finally {
    timing.mockRestore();
    jest.useRealTimers();
  }
});

test('전망대는 기본 상태에서 닫힌 채 정지하고 진입 세대에서만 프레임을 연다', async () => {
  observeAnimatedOnJsDriver(); // 건물 모션 진행을 JS 드라이버로 관찰한다(GROMO-2375).
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('tower')) island.buildings.push('tower');
  const screen = await render(<WorldMap state={state} />);
  const activeFrame = () =>
    [0, 1, 2, 3].find((index) => {
      const style = screen.getByTestId(`village-observatory-frame-${index}`).props.style;
      return StyleSheet.flatten(style).opacity === 1;
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

test('축음기를 포함한 완공 건물은 나무 팻말과 접근성 이름으로 식별한다', async () => {
  const state = initialState(true);
  const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);

  for (const building of ['hall', 'board', 'gram', 'library', 'mail', 'tower', 'shop'] as const) {
    expect(screen.getByTestId(`building-name-${building}`)).toBeTruthy();
    expect(screen.getByText(buildingNames[building])).toBeTruthy();
    expect(screen.getByRole('button', { name: buildingNames[building] })).toBeTruthy();
  }
  await screen.unmount();
});

test('전망대를 짓지 않은 섬에는 전망대 입구(랭킹·섬 이름 검색)가 없고, 지은 섬에는 있다', async () => {
  const state = initialState(true);
  serverConstructionState(state, null, ['hall', 'board']);
  const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
  expect(screen.queryByRole('button', { name: buildingNames.tower })).toBeNull();
  // 같은 섬의 지은 건물 입구는 그대로 있다
  expect(screen.getByRole('button', { name: buildingNames.board })).toBeTruthy();
  serverConstructionState(state, null, ['hall', 'board', 'tower']);
  await screen.rerender(<FinalIsland state={{ ...state }} go={jest.fn()} build={jest.fn()} />);
  expect(screen.getByRole('button', { name: buildingNames.tower })).toBeTruthy();
  await screen.unmount();
});

test('뗏목은 나무 팻말과 접근성 이름으로 식별한다', async () => {
  const state = initialState(true);
  const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);

  expect(screen.getByText('뗏목')).toBeTruthy();
  expect(screen.getByTestId('building-name-raft')).toBeTruthy();
  expect(screen.getByRole('button', { name: '뗏목' })).toBeTruthy();
  await screen.unmount();
});

test('홈을 최대로 축소해도 뗏목 터치 영역은 44pt 이상이며 그림 중앙에 맞는다', async () => {
  const createPanResponder = jest.spyOn(PanResponder, 'create');
  const screen = await render(
    <FinalIsland state={initialState(true)} go={jest.fn()} build={jest.fn()} />,
  );
  const pan = createPanResponder.mock.calls[0][0];
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
    pan.onPanResponderMove!(pinch(70), {} as any);
    // 끄는 동안은 transform 만 움직이고 손을 떼야 배치가 커밋된다(GROMO-2373).
    pan.onPanResponderRelease!(pinch(70), {} as any);
  });
  const scale = (((874 / 874) * 402) / 1536) * 2.8 * 0.35;
  const raft = screen.getByLabelText('뗏목').props.style;
  expect(raft.width).toBeGreaterThanOrEqual(semanticTokens.size.tapMin);
  expect(raft.height).toBeGreaterThanOrEqual(semanticTokens.size.tapMin);
  expect(raft.left + raft.width / 2).toBeCloseTo((207 + 169 / 2) * scale);
  expect(raft.top + raft.height / 2).toBeCloseTo((822 + 103 / 2) * scale);
  expect(raft.top).toBeLessThanOrEqual(815 * scale);
  expect(raft.top + raft.height).toBeGreaterThanOrEqual(925 * scale);
});

test('뗏목은 모션 설정과 무관하게 걷기나 갸웃 모션을 기다리지 않고 뗏목 행선지를 연다', async () => {
  const go = jest.fn();
  const state = initialState(true);
  state.settings.reduceMotion = false;
  const screen = await render(<FinalIsland state={state} go={go} build={jest.fn()} />);

  await fireEvent.press(screen.getByLabelText('뗏목'));

  expect(go).toHaveBeenCalledTimes(1);
  expect(go).toHaveBeenCalledWith('raft');
});

test('상점 진입 세대가 시작되면 대기 없이 문 프레임을 재생한다', async () => {
  observeAnimatedOnJsDriver(); // 건물 모션 진행을 JS 드라이버로 관찰한다(GROMO-2375).
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  const state = initialState(true);
  const screen = await render(<WorldMap state={state} />);

  await screen.rerender(<WorldMap state={state} shopArrivalActive shopArrivalGeneration={1} />);
  await act(async () => jest.advanceTimersByTime(150));
  expect(StyleSheet.flatten(screen.getByTestId('shop-motion-frame-1').props.style)).toMatchObject({
    opacity: 1,
  });

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

test.each([false, true])(
  '홈 모닥불을 누르면 휴식 화면을 연다 (레이어드: %s)',
  async (layeredPreview) => {
    jest.useFakeTimers();
    jest.spyOn(Animated, 'timing').mockImplementation(
      () =>
        ({
          start: (callback?: Animated.EndCallback) => callback?.({ finished: true }),
          stop: jest.fn(),
          reset: jest.fn(),
        }) as unknown as Animated.CompositeAnimation,
    );
    const state = initialState(true);
    state.settings.reduceMotion = true;
    state.islands.find((island) => island.id === state.islandId)!.buildings = [];
    const go = jest.fn();
    const screen = await render(<FinalIsland state={state} go={go} build={jest.fn()} />);

    // FinalIsland는 layeredPreview prop 대신 자체 상태를 사용하므로 실제 전환 버튼을 누른다.
    if (layeredPreview) {
      await fireEvent.press(screen.getByTestId('village-preview-toggle'));
      expect(screen.getByText('기존 마을 보기')).toBeTruthy();
      expect(screen.queryByTestId('building-name-fire')).toBeNull();
      expect(screen.queryByText('모닥불')).toBeNull();
    } else {
      expect(screen.getByTestId('building-name-fire')).toBeTruthy();
      expect(screen.getByText('모닥불')).toBeTruthy();
    }

    await fireEvent.press(screen.getByRole('button', { name: '모닥불' }));
    expect(go).toHaveBeenCalledWith('rest');
    expect(state.session).toBeFalsy();
    await screen.unmount();
  },
);

test.each([false, true])(
  '방문 중에는 모닥불 휴식 진입을 노출하지 않는다 (방문 카드: %s)',
  async (explicitVisit) => {
    const state = initialState(true);
    const visitingIslandId = state.islands.find((island) => island.id !== state.islandId)!.id;
    if (!explicitVisit) state.visitingIslandId = visitingIslandId;
    const screen = await render(
      <FinalIsland
        state={state}
        go={jest.fn()}
        build={jest.fn()}
        viewingIslandId={explicitVisit ? visitingIslandId : undefined}
      />,
    );

    expect(screen.queryByRole('button', { name: '모닥불' })).toBeNull();
    await screen.unmount();
  },
);

test('홈 모닥불은 실제 화덕 경계에서 낮 연기와 밤 불꽃을 재생한다', async () => {
  observeAnimatedOnJsDriver(); // 건물 모션 진행을 JS 드라이버로 관찰한다(GROMO-2375).
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
  expect(
    StyleSheet.flatten(screen.getByTestId('fire-motion-frame-day-1').props.style),
  ).toMatchObject({ opacity: 1 });

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
  observeAnimatedOnJsDriver(); // 건물 모션 진행을 JS 드라이버로 관찰한다(GROMO-2375).
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
  expect(StyleSheet.flatten(screen.getByTestId('village-hall-frame-1').props.style)).toMatchObject({
    opacity: 1,
  });
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
  expect(screen.getByTestId('village-hall-theme-tint-0').props.source).toBe(
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

test.each(['그림', '팻말'])(
  '내 섬 홈의 완공 축음기 %s을 누르면 음악 화면으로 진입한다',
  async (target) => {
    jest.spyOn(Animated, 'timing').mockImplementation(
      () =>
        ({
          start: (callback?: Animated.EndCallback) => callback?.({ finished: true }),
          stop: jest.fn(),
          reset: jest.fn(),
        }) as unknown as Animated.CompositeAnimation,
    );
    const state = initialState(true);
    state.settings.reduceMotion = true;
    const go = jest.fn();
    const island = state.islands.find((item) => item.id === state.islandId)!;
    if (!island.buildings.includes('gram')) island.buildings.push('gram');

    const screen = await render(
      <FinalIsland state={state} go={go} build={jest.fn()} showHud={false} showActions={false} />,
    );

    expect(screen.getByLabelText(buildingNames.gram)).toBeTruthy();
    expect(screen.getByTestId('world-static-building-gram')).toBeTruthy();
    expect(screen.getByTestId('building-name-gram')).toBeTruthy();
    await fireEvent.press(
      target === '그림'
        ? screen.getByLabelText(buildingNames.gram)
        : screen.getByTestId('building-name-gram'),
    );
    expect(go).toHaveBeenCalledWith('sound');
  },
);

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

test('건물을 연타해도 한 번만 걷고 도착 즉시 내부를 연다', async () => {
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

    expect(screen.queryByTestId('building-transition-overlay')).toBeNull();
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

test('안내 대기로 화면을 열지 않으면 다음 건물 진입과 집중하기를 잠그지 않는다', async () => {
  jest.spyOn(Animated, 'timing').mockImplementation(
    () =>
      ({
        start: (callback?: Animated.EndCallback) => callback?.({ finished: true }),
        stop: jest.fn(),
        reset: jest.fn(),
      }) as unknown as Animated.CompositeAnimation,
  );
  const state = initialState(true);
  state.settings.reduceMotion = true;
  const go = jest.fn().mockReturnValue(false);
  const screen = await render(
    <FinalIsland state={state} go={go} build={jest.fn()} showHud={false} />,
  );

  await fireEvent.press(screen.getByLabelText(buildingNames.hall));
  expect(go).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByLabelText(buildingNames.hall));
  expect(go).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByTestId('depart-focus'));
  expect(go).toHaveBeenLastCalledWith('focusTravel');
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
  // 착색은 프레임마다 겹쳐 두고 현재 프레임 것만 보인다(`-프레임 번호`).
  for (const tint of [
    'village-hall-theme-tint-0',
    'shop-motion-theme-tint-0',
    'village-observatory-theme-tint-0',
    'library-motion-theme-tint-0',
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
  expect(night.getByTestId('village-hall-theme-tint-0').props.source).toBe(
    require('@/assets/village-world/motion/hall/night-frame-0.png'),
  );
  await night.unmount();
  jest.useRealTimers();
});

test('밤에도 회관 도착 시 문 모션을 기다리지 않고 내부를 연다', async () => {
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
    expect(go).toHaveBeenCalledWith('raft');
  } finally {
    timing.mockRestore();
  }
});

test('서버 방문 지도는 대상 건물만 열고 귀환도 서버 경로를 사용한다', async () => {
  let state = reducer(initialState(true), {
    type: 'ISLAND_SYNC',
    memberships: {
      items: [{ id: 'own', name: '원래 섬' }],
      currentIslandId: 'own',
      nextCursor: null,
      lossReason: null,
    },
  });
  state = reducer(state, {
    type: 'ISLAND_VISIT',
    visit: {
      island: { id: 'visitor', name: '구경할 섬', memberCount: 1, maxMembers: 15 },
      buildings: ['hall', 'board', 'library'],
      members: { items: [], nextCursor: null, version: 1 },
    },
  });
  state = reducer(state, { type: 'SERVER_VISITING', islandId: 'visitor' });
  const go = jest.fn(),
    notify = jest.fn(),
    dispatch = jest.fn(),
    onReturn = jest.fn();
  const screen = await render(
    <FinalIsland
      state={state}
      go={go}
      build={jest.fn()}
      notify={notify}
      dispatch={dispatch}
      onReturnFromVisit={onReturn}
    />,
  );
  expect(screen.queryByTestId('home-cat-sprite')).toBeNull();
  expect(screen.queryByText('집중 시작')).toBeNull();
  expect(screen.queryByLabelText(buildingNames.tower)).toBeNull();
  await fireEvent.press(screen.getByLabelText(buildingNames.hall));
  expect(go).toHaveBeenLastCalledWith('manage');
  await fireEvent.press(screen.getByLabelText(buildingNames.board));
  expect(go).toHaveBeenLastCalledWith('board');
  await fireEvent.press(screen.getByLabelText(buildingNames.library));
  expect(notify).toHaveBeenCalledWith('주민만 이용할 수 있어요');
  await fireEvent.press(screen.getByText('원래 섬으로'));
  expect(onReturn).toHaveBeenCalledTimes(1);
  expect(dispatch).not.toHaveBeenCalled();
  expect(go).not.toHaveBeenCalledWith('travel', expect.anything());
});

describe('en', () => {
  const mockLocales = jest.requireMock('expo-localization').getLocales as jest.Mock;

  afterEach(() => {
    mockLocales.mockReturnValue([{ languageCode: 'ko', languageTag: 'ko-KR' }]);
    applyLocalePref('system');
  });

  test('en 로케일 — 홈 HUD·건물 문 라벨을 영문으로 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const state = initialState(true);
    const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);

    expect(screen.getByText(/Focus today/)).toBeTruthy();
    expect(screen.getByLabelText('Raft')).toBeTruthy();
  });

  // legacyDoors 의 label 게터 + home.door.* 템플릿이 한 번에 걸리는 조합 — 게터가 import
  // 시점에 다시 굳는 회귀(건물명이 ko 로 멈추는 것)를 잡는다.
  test('en 로케일 — 게시판 새 댓글 문 배지는 영문 건물명을 합친 라벨을 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const state = initialState(true);
    const island = state.islands.find((item) => item.id === state.islandId)!;
    if (!island.buildings.includes('board')) island.buildings.push('board');
    const screen = await render(
      <FinalIsland state={state} go={jest.fn()} build={jest.fn()} boardStatus="new-comment" />,
    );

    expect(screen.getByLabelText("Notice Board, there's a new comment.")).toBeTruthy();
  });
});

test('방문 중에도 뗏목이 그려지고 누르면 행선지 시트(raft)로 간다', async () => {
  const state = initialState(true);
  const visited = state.islands.find((island) => island.id !== state.islandId)!;
  const go = jest.fn();
  const screen = await render(
    <FinalIsland state={state} go={go} build={jest.fn()} viewingIslandId={visited.id} />,
  );
  expect(screen.queryByLabelText('뗏목')).toBeNull(); // 방문 카드(explicit)는 낚시섬 관전만 연다
  state.visitingIslandId = visited.id;
  const visiting = await render(<FinalIsland state={state} go={go} build={jest.fn()} />);
  await fireEvent.press(visiting.getByLabelText('뗏목'));
  expect(go).toHaveBeenCalledWith('raft', visited.id);
});

test.each([false, true])(
  '뗏목 물결은 누름·해제와 모션 줄이기(%s)를 뗏목 그림과 함께 적용한다',
  async (reduceMotion) => {
    const state = initialState(true);
    state.settings.reduceMotion = reduceMotion;
    const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
    const sign = screen.getByTestId('building-name-raft');
    const waterStyle = () =>
      Object.assign({}, ...screen.getByTestId('world-raft-water-motion').props.style.flat());
    const normal = waterStyle();
    await fireEvent(sign, 'pressIn');
    const pressed = waterStyle();
    if (reduceMotion) {
      expect(pressed.opacity).toBe(0.75);
      expect(pressed.transform).toBeUndefined();
    } else {
      const scale = pressed.width / 210;
      expect(pressed.transform).toEqual([{ translateY: 2 }, { scale: 0.97 }]);
      // 물결 컨테이너의 아래가 아니라 실제 뗏목 그림의 아래 가운데를 기준으로 축소한다.
      expect(pressed.transformOrigin[0]).toBeCloseTo((207 + 169 / 2 - 185) * scale);
      expect(pressed.transformOrigin[1]).toBeCloseTo((822 + 103 - 835) * scale);
    }
    await fireEvent(sign, 'pressOut');
    expect(waterStyle()).toEqual(normal);
    await screen.unmount();
  },
);

test('안 읽은 오늘 고양이 잡지는 우체통 위 배지 — 친구 편지 배지가 있으면 그쪽이 먼저(GROMO-2289)', async () => {
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('mail')) island.buildings.push('mail');
  const home = (letters: boolean, magazine: boolean) => (
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showMailboxLetters={letters}
      showMailboxMagazine={magazine}
    />
  );
  const hidden = { includeHiddenElements: true };
  const screen = await render(home(false, true));
  expect(screen.getByTestId('mailbox-magazine-indicator', hidden)).toBeTruthy();
  expect(screen.getByLabelText('우체통, 새 고양이 잡지가 왔어요')).toBeTruthy();
  await screen.rerender(home(true, true));
  expect(screen.queryByTestId('mailbox-magazine-indicator', hidden)).toBeNull();
  expect(screen.getByTestId('mailbox-new-indicator', hidden)).toBeTruthy();
  await screen.rerender(home(false, false));
  expect(screen.queryByTestId('mailbox-magazine-indicator', hidden)).toBeNull();
});

test.each([false, true])(
  '잡지 배지는 우체통 팻말의 누름과 모션 줄이기(%s)를 따른다',
  async (reduceMotion) => {
    const state = initialState(true);
    state.settings.reduceMotion = reduceMotion;
    const screen = await render(
      <FinalIsland
        state={state}
        go={jest.fn()}
        build={jest.fn()}
        showMailboxLetters={false}
        showMailboxMagazine
      />,
    );
    const sign = screen.getByTestId('building-name-mail');
    const style = () =>
      Object.assign(
        {},
        ...screen
          .getByTestId('mailbox-magazine-indicator', { includeHiddenElements: true })
          .props.style.flat(),
      );
    const initial = style();
    await fireEvent(sign, 'pressIn');
    if (reduceMotion) {
      expect(style().opacity).toBe(0.75);
      expect(style().transform).toBeUndefined();
    } else {
      expect(style().transform).toEqual([{ translateY: 2 }, { scale: 0.97 }]);
    }
    await fireEvent(sign, 'pressOut');
    expect(style()).toEqual(initial);
    await screen.unmount();
  },
);
test('언어를 바꾸면 건물 이름과 긴 번역의 팻말 폭을 함께 갱신한다', async () => {
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('tower')) island.buildings.push('tower');
  const home = () => <FinalIsland state={state} go={jest.fn()} build={jest.fn()} />;
  applyLocalePref('ko');
  const screen = await render(home());
  const korean = screen.getByTestId('building-name-tower').props.style;
  expect(screen.getByText('전망대')).toBeTruthy();
  try {
    applyLocalePref('en');
    await screen.rerender(home());
    expect(screen.getByText('Lookout Tower')).toBeTruthy();
    const english = screen.getByTestId('building-name-tower').props.style;
    expect(english.width).toBeGreaterThan(korean.width);
    expect(english.height).toBe(korean.height);
  } finally {
    applyLocalePref('system');
  }
});

test('빠른 핀치 반복에도 팻말은 건물과 같은 배율로 확대되고 내부 이미지 좌표는 유지한다', async () => {
  const createPan = jest.spyOn(PanResponder, 'create');
  const screen = await render(
    <FinalIsland state={initialState(true)} go={jest.fn()} build={jest.fn()} />,
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
  const sign = () => screen.getByTestId('building-name-hall');
  const initial = StyleSheet.flatten(sign().props.style);
  const building = () => StyleSheet.flatten(screen.getByTestId('world-hall-motion').props.style);
  const originalBuilding = building();
  const overlay = screen.getByTestId('facility-sign-overlay');
  const imageSize = () => {
    const nodes: any[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (
        node.type === 'Image' &&
        node.props.source === require('@/assets/village-world/ui/wooden-name-sign.png')
      )
        nodes.push(node);
      (node.children ?? []).forEach(walk);
    };
    walk(screen.toJSON());
    return nodes
      .map((node) => StyleSheet.flatten(node.props.style))
      .map(({ width, height }) => ({ width, height }));
  };
  const originalSizes = imageSize();
  expect(originalSizes.length).toBeGreaterThan(0);
  for (const distance of [70, 520, 90, 400, 70, 200]) {
    await act(async () => {
      pan.onPanResponderGrant!(pinch(200), {} as any);
      pan.onPanResponderMove!(pinch(distance), {} as any);
      // 끄는 동안은 transform 만 움직이고 손을 떼야 배치가 커밋된다(GROMO-2373).
      pan.onPanResponderRelease!(pinch(distance), {} as any);
    });
    const current = StyleSheet.flatten(sign().props.style);
    const ratio = building().width / originalBuilding.width;
    expect(current.width / initial.width).toBeCloseTo(ratio);
    expect(current.height / initial.height).toBeCloseTo(ratio);
    imageSize().forEach((size, index) => {
      expect(size.width).toBeCloseTo(originalSizes[index].width);
      expect(size.height).toBeCloseTo(originalSizes[index].height);
    });
    expect(StyleSheet.flatten(overlay.props.style)).toEqual(StyleSheet.absoluteFill);
    // 화면 레이어에서도 팻말은 건물과 같은 배율을 사용한다.
    expect(within(overlay).getByTestId('building-name-hall')).toBeTruthy();
  }
  expect(StyleSheet.flatten(sign().props.style).left).not.toBe(initial.left);
  await screen.unmount();
});

test('긴 섬 이름은 홈 정보 안에서 말줄임하고 꾸미기·친구·설정 입구를 유지한다', async () => {
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  island.name = '아주아주이름이긴우리들의고양이섬';
  const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
  const panel = screen.getByTestId('home-profile-panel');
  expect(screen.getByLabelText(`${island.name} 오늘 집중 00:00:00`)).toBeTruthy();
  expect(screen.getByRole('button', { name: '내 고양이 꾸미기' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /친구/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: '설정' })).toBeTruthy();
  const name = within(panel).getByText(island.name);
  expect(name.props.numberOfLines).toBe(1);
  expect(name.props.ellipsizeMode).toBe('tail');
});

test.each(['day', 'night'] as const)(
  '%s: 게시판·축음기·우체통은 잘린 그림을 원화 rect 자리에 놓고 외곽선은 건물마다 한 장이다(GROMO-2378)',
  async (dayNight) => {
    const state = initialState(true);
    const island = state.islands.find((item) => item.id === state.islandId)!;
    for (const b of ['board', 'gram', 'mail', 'hall'] as const)
      if (!island.buildings.includes(b)) island.buildings.push(b);
    island.buildingThemes = { ...island.buildingThemes, board: 'rose', gram: 'rose', mail: 'rose' };
    const night = dayNight === 'night';
    const screen = await render(
      <WorldMap state={state} dayNight={dayNight} showMailboxLetters={false} />,
    );
    const scale = ((402 / 1536) * 2.8 * 874) / 874;
    const left = 402 / 2 - 585 * scale,
      top = 874 / 2 - 430 * scale;
    // 낮 게시판은 VillageBoardIndicator 가 그림을 그린다 — 정적 그림은 밤에만.
    const statics = night ? ['board', 'gram', 'mail'] : ['gram', 'mail'];
    for (const id of ['board', 'gram', 'mail']) {
      const r = TILE_FACILITIES[id];
      const box = {
        position: 'absolute',
        left: left + r.x * scale,
        top: top + r.y * scale,
        width: r.w * scale,
        height: r.h * scale,
      };
      for (const testID of [
        ...(statics.includes(id) ? [`world-static-building-${id}`] : []),
        `world-building-theme-${id}`,
      ]) {
        const layer = screen.getByTestId(testID);
        expect(layer.props.source).toBe(tileFacilityLayerSource(id, night));
        const style = StyleSheet.flatten(layer.props.style);
        for (const [k, v] of Object.entries(box))
          expect([testID, k, style[k as keyof typeof style]]).toEqual([
            testID,
            k,
            typeof v === 'number' ? expect.closeTo(v, 6) : v,
          ]);
      }
    }
    // 외곽선은 건물마다 Image 한 장(예전 8방향 복제 아님)이고 소스는 그 건물의 미리 그린 마스크다.
    const find = (node: any, hit: (n: any) => boolean, out: any[] = []): any[] => {
      if (Array.isArray(node)) node.forEach((child) => find(child, hit, out));
      else if (node && typeof node === 'object') {
        if (hit(node)) out.push(node);
        (node.children ?? []).forEach((child: any) => find(child, hit, out));
      }
      return out;
    };
    const outlines = find(screen.toJSON(), (n) => n.props?.testID === 'native-facility-outline');
    const built = island.buildings.filter((b) => TILE_FACILITIES[b]);
    expect(outlines).toHaveLength(built.length);
    const images = outlines.map((o) => find(o, (n) => n.type === 'Image'));
    images.forEach((list) => expect(list).toHaveLength(1));
    expect(images.map((list) => list[0].props.source)).toEqual(
      expect.arrayContaining(built.map((b) => tileFacilityOutlineSource(b, night))),
    );
    await screen.unmount();
  },
);

test('구경 중 HUD 의 긴 섬 이름은 한 줄로 줄이고 「다시 바다로」 버튼을 가입 버튼 옆에 둔다(GROMO-2405)', async () => {
  const state = initialState(true);
  const visited = state.islands.find((island) => island.id !== state.islandId)!;
  visited.name = 'smoke-friends-d99a696f-ae05-49bc-8d44-544b2bb984d8';
  state.visitingIslandId = visited.id;
  const onLeave = jest.fn();
  const onPress = jest.fn();
  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      visitJoin={{ label: '이 섬에 가입', disabled: false, onPress, onLeave }}
    />,
  );
  const name = screen.getByLabelText(`${visited.name} 구경 중`);
  expect(name.props.numberOfLines).toBe(1);
  await fireEvent.press(screen.getByLabelText('다시 바다로'));
  expect(onLeave).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByLabelText('이 섬에 가입'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('구경 중 하단 두 버튼은 폭을 나눠 쓰고, 큰 글자에서는 세로로 쌓는다(GROMO-2405)', async () => {
  const state = initialState(true);
  const visited = state.islands.find((island) => island.id !== state.islandId)!;
  state.visitingIslandId = visited.id;
  const join = { label: '이 섬에 가입', disabled: false, onPress: jest.fn(), onLeave: jest.fn() };
  const screen = await render(
    <FinalIsland state={state} go={jest.fn()} build={jest.fn()} visitJoin={join} />,
  );
  const row = () => Object.assign({}, ...[screen.getByTestId('visit-actions').props.style].flat());
  expect(row().flexDirection).toBe('row');
  mockFontScale = 1.3;
  await screen.rerender(
    <FinalIsland state={state} go={jest.fn()} build={jest.fn()} visitJoin={join} />,
  );
  expect(row().flexDirection).toBe('column');
  mockFontScale = 1;
});
