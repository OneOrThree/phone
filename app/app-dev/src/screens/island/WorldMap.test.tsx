import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { Animated, Platform } from 'react-native';
import { FinalIsland, WorldMap } from '@/screens/island/WorldMap';
import { buildingNames, initialState, residentCount } from '@/services/model';
import {
  BUILDING_ENTRY_DURATION_MS,
  BUILDING_TRANSITION_DURATION_MS,
} from '@/services/buildingTransition';
import { semanticTokens } from '@/design-system/tokens';
import { villageScene } from '@/utils/village-world';
import { assets } from '@/constants/assets';

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
  '상점 %s와 전망대 %s의 이름표는 상태에 맞게 강조한다',
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
      const label = screen.getByTestId(`building-name-${building}`).children[0];
      expect(typeof label).not.toBe('string');
      if (typeof label !== 'string')
        expect(label.props.style.backgroundColor).toBe(
          shopState === 'normal' ? semanticTokens.color.surface : semanticTokens.color.accent,
        );
    }
  },
);

test.each(['board', 'hall'] as const)(
  '진입 스프라이트가 없는 %s는 620ms 뒤 라우트를 연다',
  async (building) => {
    jest.useFakeTimers();
    jest.setSystemTime(
      new Date(building === 'hall' ? '2026-06-15T22:00:00' : '2026-06-15T12:00:00'),
    );
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
  expect(
    screen.getByTestId('world-shop-motion', { includeHiddenElements: true }).props.style,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 456 * worldScale,
        top: worldTop + 580 * worldScale,
        width: 262 * worldScale,
        height: 199 * worldScale,
      }),
    ]),
  );
  expect(screen.getByLabelText('상점')).toBeTruthy();
  expect(screen.queryByTestId('shop-motion-tooltip', { includeHiddenElements: true })).toBeNull();
  expect(screen.getByTestId('building-name-shop')).toBeTruthy();
  expect(screen.getByText(buildingNames.shop)).toBeTruthy();

  await screen.rerender(
    <FinalIsland state={state} go={jest.fn()} build={jest.fn()} shopState="purchasable" />,
  );
  screen.getByLabelText(`${buildingNames.shop}, 구매 가능한 상품이 있어요`);
  expect(screen.queryByTestId('shop-motion-tooltip', { includeHiddenElements: true })).toBeNull();
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
  expect(screen.getByTestId('building-name-tower').props.style).toEqual(
    expect.objectContaining({
      left: (150 - 12 - (272 - 60)) * worldScale,
      top: (52 - (200 - 95)) * worldScale,
      alignItems: 'flex-start',
    }),
  );
  await screen.unmount();
});

test('부두의 뗏목에 뗏목 이름을 표시한다', async () => {
  const state = initialState(true);
  const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
  const worldScale = (((874 / 874) * 402) / 1536) * 2.8;

  expect(screen.getByText('뗏목')).toBeTruthy();
  expect(screen.getByTestId('building-name-raft').props.style).toEqual(
    expect.objectContaining({
      left: 0,
      top: -30,
      width: 120 * worldScale,
      alignItems: 'center',
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
  expect(
    screen.getByTestId('shop-motion-frame-1', { includeHiddenElements: true }).props.style,
  ).toEqual(expect.arrayContaining([expect.objectContaining({ opacity: 1 })]));

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
        top: worldTop + 289 * worldScale,
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
  const island = state.islands.find((item) => item.id === state.islandId)!;
  const screen = await render(<WorldMap state={state} />);
  const worldScale = (((874 / 874) * 402) / 1536) * 2.8;
  const worldLeft = 402 / 2 - 585 * worldScale;
  const worldTop = 874 / 2 - 430 * worldScale;

  expect(screen.getByTestId('world-fire-motion').props.accessibilityLabel).toBe(
    `모닥불, 낮, 연기, 주민 ${residentCount(island)}명`,
  );
  expect(screen.getByTestId('world-fire-motion').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 420 * worldScale,
        top: worldTop + 443 * worldScale,
        width: 100 * worldScale,
        height: 71 * worldScale,
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
  expect(screen.getByTestId('world-fire-day-off-overlay').props.style).toEqual(
    expect.objectContaining({
      left: worldLeft + 440 * worldScale,
      top: worldTop + 435 * worldScale,
      width: 60 * worldScale,
      height: 80 * worldScale,
    }),
  );
  await act(async () => jest.advanceTimersByTime(360));
  expect(screen.getByTestId('fire-motion-frame-day-1').props.opacity).toBe(1);

  await screen.unmount();
  jest.setSystemTime(new Date('2026-06-15T21:00:00'));
  const night = await render(<WorldMap state={state} />);
  expect(night.queryByTestId('world-fire-day-off-overlay')).toBeNull();
  expect(night.getByTestId('world-fire-motion').props.accessibilityLabel).toBe(
    `모닥불, 저녁, 불꽃, 주민 ${residentCount(island)}명`,
  );
  expect(night.getByTestId('world-fire-motion').props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        left: worldLeft + 420 * worldScale,
        top: worldTop + 443 * worldScale,
        width: 100 * worldScale,
        height: 71 * worldScale,
      }),
    ]),
  );
  expect(night.getByTestId('fire-motion-glow')).toBeTruthy();
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
    const state = initialState(true);
    const island = state.islands.find((item) => item.id === state.islandId)!;
    const screen = await render(<WorldMap state={state} />);
    expect(screen.getByTestId('world-fire-motion').props.accessibilityLabel).toBe(
      `모닥불, 저녁, 불꽃, 주민 ${residentCount(island)}명`,
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

test('서버 홈 모닥불 주민 수는 로컬 목업의 가입자 기본값 대신 서버 memberCount를 쓴다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T21:00:00'));
  const state = initialState(true);
  state.serverIslands = {
    ...state.serverIslands,
    currentIslandId: 'server-home',
    home: {
      islandId: 'server-home',
      home: {
        island: {
          id: 'server-home',
          name: '서버 홈',
          intro: '',
          approvalRequired: false,
          maxMembers: 10,
          memberCount: 0,
        },
        wallets: { villagePoints: 0 },
        focusSummary: { totalSeconds: 0 },
      },
      completedBuildings: [],
      members: [],
    },
  } as any;

  const screen = await render(<WorldMap state={state} />);
  expect(screen.getByTestId('world-fire-motion').props.accessibilityLabel).toBe(
    '모닥불, 저녁, 불꽃, 주민 없음',
  );
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

test('방문 중인 상점은 상품 상태보다 주민 전용 안내를 먼저 읽는다', async () => {
  const state = initialState(true);
  const visited = state.islands.find((island) => island.id === 'cloud')!;
  if (!visited.buildings.includes('shop')) visited.buildings.push('shop');
  state.visitingIslandId = visited.id;

  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      shopState="purchasable"
      showHud={false}
      showActions={false}
    />,
  );

  expect(screen.getByLabelText('상점, 구매 가능한 상품이 있어요').props.accessibilityHint).toBe(
    '주민만 이용할 수 있어요',
  );
  await screen.unmount();
});
