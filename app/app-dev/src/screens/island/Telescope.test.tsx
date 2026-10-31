// 망원경 화면(GROMO-2266 · 2273) — 파노라마·말풍선·버튼 상태·가입·항해·돌아가기·카운트다운·핀 표시(찜 리본·잡지 칸 미리보기·빼기).
// API(getTelescope·arriveAtIsland)와 도착 장면(HarborCutscene)은 목이다. 빼기는 실제 unpinFromTelescope 를 거치고 서버 요청(request)만 목이다 —
// 성공하면 실제처럼 onTelescopeChanged 구독자에게 알려, 화면이 따로 부르지 않아도 열린 목록이 구독으로 다시 읽는다(useTelescope 는 실제).
import React from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { ISLAND_ART_ASPECT, ISLAND_STAGE_ART } from '@/constants/magazineAssets';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { Telescope, telescopeSeaTiles } from '@/screens/island/Telescope';
import { raftTelescope, telescopeSea } from '@/screens/sea/seaAssets';
import { applyLocalePref } from '@/i18n';
import { ApiError, request } from '@/services/api/client';
import { arriveAtIsland, getTelescope, type TelescopeItem } from '@/services/api/telescope';
import { initialState, reducer } from '@/services/model';

jest.mock('@/services/api/client', () => ({
  ...jest.requireActual('@/services/api/client'),
  request: jest.fn(),
}));
jest.mock('@/services/api/telescope', () => ({
  ...jest.requireActual('@/services/api/telescope'),
  getTelescope: jest.fn(),
  arriveAtIsland: jest.fn(),
}));
// 화면이 직접 부른 reload 만 센다(알림 구독이 읽는 건 훅 안쪽 reload 라 걸리지 않는다). 구독의 읽기와 화면의 reload 는 같은 틱에 합쳐져
// getTelescope 호출 횟수만으로는 이중 조회가 보이지 않기 때문이다. 그 밖에는 실제 useTelescope 그대로다.
const mockScreenReload = jest.fn();
jest.mock('@/screens/island/useTelescope', () => {
  const actual = jest.requireActual('@/screens/island/useTelescope');
  return {
    ...actual,
    useTelescope: (options: { active: boolean }) => {
      const state = actual.useTelescope(options);
      return {
        ...state,
        reload: () => {
          mockScreenReload();
          state.reload();
        },
      };
    },
  };
});
jest.mock('@/screens/world/HarborCutscene', () => ({
  HarborCutscene: ({ accessibilityLabel, onFinish }: any) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID="sailing" onPress={onFinish}>
        <Text testID="sailing-label">{accessibilityLabel}</Text>
      </Pressable>
    );
  },
}));
// 시스템 글자 배율·안전 영역 — 큰 글자·가로 화면 테스트가 바꾸고 beforeEach 가 되돌린다
let mockFontScale = 1;
const PORTRAIT_INSETS = { top: 52, bottom: 32, left: 0, right: 0 };
let mockInsets = PORTRAIT_INSETS;
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
    insets: mockInsets,
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const mockGet = getTelescope as jest.Mock;
const mockArrive = arriveAtIsland as jest.Mock;
// 이 화면이 보내는 서버 요청은 빼기(DELETE) 뿐이다 — 가입·도착은 e.islands 와 arriveAtIsland 목이 맡는다
const mockUnpin = request as jest.Mock;
const deleteCall = (id: string) => [`/me/telescope/pins/${id}`, { method: 'DELETE' }];
// Idempotency-Key 형식(client.uuid): 하이픈 포함 36자 UUID v4
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  mockFontScale = 1;
  mockInsets = PORTRAIT_INSETS;
  jest.clearAllMocks();
  // 쓰이지 않고 남은 mockResolvedValueOnce 가 다음 테스트로 새지 않게 구현까지 비운다
  mockGet.mockReset();
  mockArrive.mockReset();
  mockUnpin.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
  applyLocalePref('system');
});

const item = (id: string, over: Partial<TelescopeItem> = {}): TelescopeItem => ({
  islandId: id,
  name: `섬 ${id}`,
  intro: `${id} 소개`,
  memberCount: 3,
  maxMembers: 15,
  approvalRequired: false,
  membershipStatus: 'none',
  slot: 'random',
  sailingMinutes: 30,
  averageFocusMinutesPerDay: 83,
  full: false,
  arrivedBefore: false,
  buildingCount: 2,
  ...over,
});
const mine = (id: string, over: Partial<TelescopeItem> = {}) =>
  item(id, { slot: 'joined', membershipStatus: 'active', ...over });

// 소속 3(j1 = 지금 섬·가 봄, j2 = 가 봄, j3 = 망원경 가입 뒤 미도착) + 가까운 섬 1 + 무작위·찜 4 = 8
const EIGHT = () => [
  mine('j1', { arrivedBefore: true }),
  mine('j2', { arrivedBefore: true }),
  mine('j3'),
  item('n1', { slot: 'nearby', sailingMinutes: 15 }),
  item('r1'),
  item('r2'),
  item('p1', { slot: 'pinned', pinnedFrom: 'magazine' }),
  item('p2', { slot: 'pinned', pinnedFrom: 'observatory' }),
];
const wire = (items: TelescopeItem[], nextRefreshMinutes = 37) => ({
  bucketStart: '2026-10-12T05:00:00Z',
  nextRefreshMinutes,
  items,
});

const isl = (id: string, name: string) => ({
  id,
  name,
  intro: '',
  memberCount: 1,
  maxMembers: 15,
  approvalRequired: false,
  arrivedBefore: true,
});

function env(over: { session?: boolean; islands?: boolean } = {}) {
  let state = reducer(initialState(true), {
    type: 'ISLAND_SYNC',
    memberships: {
      items: [isl('j1', '섬 j1'), isl('j2', '섬 j2'), isl('j3', '섬 j3')],
      currentIslandId: 'j1',
      nextCursor: null,
      lossReason: null,
    },
  });
  if (over.session) state = { ...state, session: { id: 's1' } as any };
  return {
    state,
    dispatch: jest.fn(),
    reset: jest.fn(),
    replace: jest.fn(),
    go: jest.fn(),
    back: jest.fn(),
    home: jest.fn(),
    notify: jest.fn(),
    confirm: jest.fn(),
    backOverride: { current: null as null | (() => boolean) },
    focus: {
      startSea: jest.fn().mockResolvedValue(undefined),
      recover: jest.fn().mockResolvedValue(null),
    },
    conversion: { offer: jest.fn().mockReturnValue(false) },
    islands:
      over.islands === false
        ? undefined
        : {
            switchCurrent: jest.fn().mockResolvedValue(undefined),
            sync: jest.fn().mockResolvedValue(undefined),
            visit: jest.fn().mockResolvedValue(undefined),
            join: jest.fn().mockResolvedValue({ status: 'active' }),
          },
  };
}

async function open(items: TelescopeItem[], e = env()) {
  mockGet.mockImplementation(async () => wire(items));
  const screen = await render(<Telescope e={e} />);
  await screen.findAllByTestId(/^telescope-island-/);
  return { screen, e };
}
const press = async (screen: any, id: string) =>
  fireEvent.press(screen.getByTestId(`telescope-island-${id}`));
const disabled = (screen: any, label: string) =>
  screen.getByLabelText(label).props.accessibilityState.disabled;

test('목록에서 빠진 섬의 승인 대기 신청도 망원경에서 확인·취소 화면으로 돌아갈 수 있다', async () => {
  const e = env();
  e.state = reducer(initialState(), {
    type: 'ISLAND_REQUEST',
    request: { id: 'request-1', islandId: 'not-in-bucket', status: 'pending', version: 1 },
  });
  const { screen } = await open([item('other-island')], e);
  expect(screen.queryByTestId('telescope-island-not-in-bucket')).toBeNull();
  await fireEvent.press(screen.getByLabelText('가입 신청 확인'));
  expect(e.go).toHaveBeenCalledWith('approval');

  e.state = reducer(e.state, {
    type: 'ISLAND_REQUEST',
    request: { id: 'request-1', islandId: 'not-in-bucket', status: 'cancelled', version: 2 },
  });
  await screen.rerender(<Telescope e={e} />);
  expect(screen.queryByLabelText('가입 신청 확인')).toBeNull();
});

test('잡지 등에서 직접 망원경에 들어와도 부팅 동기화 성공 전에는 목적지를 열지 않고 실패를 재시도한다', async () => {
  const e = { ...env(), islandBootError: true };
  e.islands!.sync.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  mockGet.mockResolvedValue(wire([item('synced-island')]));
  const screen = await render(<Telescope e={e} />);
  await screen.findByLabelText('다시 시도');
  expect(screen.getByText('섬을 불러오지 못했어요.')).toBeTruthy();
  expect(mockGet).not.toHaveBeenCalled();
  expect(screen.queryByTestId('telescope-island-synced-island')).toBeNull();
  await fireEvent.press(screen.getByLabelText('다시 시도'));
  await screen.findByTestId('telescope-island-synced-island');
  expect(e.islands!.sync).toHaveBeenCalledTimes(2);
  expect(mockGet).toHaveBeenCalledTimes(1);
});

test.each([
  ['기존 섬 목록이 비었으면', []],
  ['기존 섬이 모두 정원이 찼으면', [item('full', { full: true })]],
] as const)('%s 무인도 하나를 표시하고 가입 없이 15분 항해를 시작한다', async (_, regular) => {
  const e = env();
  e.state = reducer(initialState(), {
    type: 'ISLAND_SYNC',
    memberships: { items: [], currentIslandId: null, nextCursor: null, lossReason: null },
  });
  const deserted = item('reserved', {
    name: '무인도',
    memberCount: 0,
    buildingCount: 0,
    slot: 'nearby',
    sailingMinutes: 15,
  });
  const { screen } = await open([deserted, ...regular], e);
  expect(screen.getAllByTestId(/^telescope-island-/)).toHaveLength(1);
  expect(screen.getByTestId('telescope-art-reserved').props.source).toBe(ISLAND_STAGE_ART.houses0);
  await press(screen, 'reserved');
  expect(screen.getByText('항해 15분')).toBeTruthy();
  expect(screen.queryByLabelText('바로 가입')).toBeNull();
  await fireEvent.press(screen.getByLabelText('항해하기'));
  await fireEvent.press(screen.getByLabelText('항해 시작'));
  await act(async () => {});
  expect(e.focus.startSea).toHaveBeenCalledWith('reserved');
  expect(e.islands!.join).not.toHaveBeenCalled();
  expect(mockArrive).not.toHaveBeenCalled();
  expect(e.reset).toHaveBeenCalledWith('sea', '무인도');
});

test.each([
  ['빈자리 있는 섬과 정원 찬 섬', [item('open'), item('full', { full: true })]],
  ['이미 가입한 정원 찬 섬', [mine('joined', { full: true })]],
] as const)(
  '현재 섬이 없어도 %s 있으면 기존 목록을 유지하고 예약 무인도는 숨긴다',
  async (_, regular) => {
    const e = env();
    e.state = initialState();
    const { screen } = await open(
      [
        item('reserved', { memberCount: 0, buildingCount: 0, slot: 'nearby', sailingMinutes: 15 }),
        ...regular,
      ],
      e,
    );
    expect(screen.getAllByTestId(/^telescope-island-/).map((n) => n.props.testID)).toEqual(
      regular.map((i) => `telescope-island-${i.islandId}`),
    );
    expect(screen.queryByTestId('telescope-island-reserved')).toBeNull();
  },
);

test('추첨된 무인도 후보(slot=uninhabited)는 들어갈 섬이 있어도 맨 앞에 함께 뜬다', async () => {
  const e = env();
  e.state = initialState();
  const lottery = item('lottery', {
    name: '무인도',
    memberCount: 0,
    buildingCount: 0,
    slot: 'uninhabited',
    sailingMinutes: 15,
  });
  const regular = [mine('joined'), item('open'), item('full', { full: true })];
  const { screen } = await open([lottery, ...regular], e);
  expect(screen.getAllByTestId(/^telescope-island-/).map((n) => n.props.testID)).toEqual(
    [lottery, ...regular].map((i) => `telescope-island-${i.islandId}`),
  );
  expect(screen.getByTestId('telescope-art-lottery').props.source).toBe(ISLAND_STAGE_ART.houses0);
});

test('섬 8개가 응답 순서대로 파노라마에 뜨고 소속 섬(joined)에만 깃발이 꽂힌다', async () => {
  const { screen } = await open(EIGHT());
  const order = screen.getAllByTestId(/^telescope-island-/).map((n: any) => n.props.testID);
  expect(order).toEqual(EIGHT().map((i) => `telescope-island-${i.islandId}`));
  // 깃발은 스크린리더에서 숨는 장식이라 숨은 요소까지 찾는다
  const flags = screen.getAllByTestId(/^telescope-flag-/, { includeHiddenElements: true });
  expect(flags.map((n: any) => n.props.testID)).toEqual([
    'telescope-flag-j1',
    'telescope-flag-j2',
    'telescope-flag-j3',
  ]);
  // 소속이 아닌 섬(가까운 섬·찜)에는 없다 — 숨은 요소까지 찾아도 없어야 의미가 있다
  expect(screen.queryByTestId('telescope-flag-n1', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByTestId('telescope-flag-p1', { includeHiddenElements: true })).toBeNull();
});

describe('섬 그림·이름 알약·뗏목 (GROMO-2317 v5)', () => {
  test.each([
    ['무인도(주민 0명)는 건물이 있어도 집 0채', { memberCount: 0, buildingCount: 7 }, 'houses0'],
    ['건물 0개(키가 없던 옛 서버 = 0)는 집 1채', { buildingCount: 0 }, 'houses1'],
    ['건물 2개는 집 1채', { buildingCount: 2 }, 'houses1'],
    ['건물 3~4개는 집 3채', { buildingCount: 4 }, 'houses3'],
    ['건물 5개 이상은 집 5채', { buildingCount: 9 }, 'houses5'],
  ] as const)('%s', async (_name, over, art) => {
    const { screen } = await open([item('r1', over)]);
    expect(screen.getByTestId('telescope-art-r1').props.source).toBe(ISLAND_STAGE_ART[art]);
  });

  test('이름 알약 — 소속 섬은 이름만, 그 밖의 섬은 「이름 · 항해 시간」', async () => {
    const { screen } = await open([
      mine('j1', { arrivedBefore: true }),
      item('n1', { slot: 'nearby', sailingMinutes: 15 }),
      item('r1', { sailingMinutes: 60 }),
      item('p1', { slot: 'pinned', pinnedFrom: 'magazine', sailingMinutes: 90 }),
    ]);
    const pill = (id: string) =>
      within(screen.getByTestId(`telescope-island-${id}`)).getByText(/^섬 /).props.children;
    expect(pill('j1')).toBe('섬 j1');
    expect(pill('n1')).toBe('섬 n1 · 15분');
    expect(pill('r1')).toBe('섬 r1 · 1시간');
    expect(pill('p1')).toBe('섬 p1 · 1시간 30분');
  });

  test('영어 — 알약의 항해 시간도 번역된다', async () => {
    applyLocalePref('en');
    const { screen } = await open([item('r1', { name: 'Maple', sailingMinutes: 90 })]);
    screen.getByText('Maple · 1h 30m');
  });

  test('홀수 번째 섬은 한 칸 낮게 어긋난다', async () => {
    const { screen } = await open([item('r1'), item('r2'), item('r3')]);
    const top = (id: string) =>
      StyleSheet.flatten(screen.getByTestId(`telescope-island-${id}`).props.style).marginTop;
    expect(top('r1')).toBeUndefined();
    expect(top('r2')).toBe(componentTokens.telescope.stagger);
    expect(top('r3')).toBeUndefined();
  });

  test('망원경 든 뗏목 고양이는 내 털색이고, 안전 영역 안쪽 오른쪽 아래에 깔린 장식이다', async () => {
    mockInsets = { top: 0, bottom: 21, left: 47, right: 59 };
    const { screen, e } = await open([item('r1')]);
    const raft = screen.getByTestId('telescope-raft', { includeHiddenElements: true });
    expect(raft.props.accessibilityElementsHidden).toBe(true);
    expect(raft.props.pointerEvents).toBe('none');
    const { right, bottom } = StyleSheet.flatten(raft.props.style);
    expect(right).toBe(59 + componentTokens.telescope.raft.right);
    expect(bottom).toBe(21 + componentTokens.telescope.raft.bottom);
    expect((raft.children[0] as any).props.source).toBe(raftTelescope[e.state.color]);
  });

  test('가로 화면에서는 뗏목 고양이가 섬 띠 뒤에 깔리지 않게 빠진다', async () => {
    const { screen } = await open([item('r1')]);
    await fireEvent(screen.getByTestId('telescope'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 874, height: 402 } },
    });
    expect(screen.queryByTestId('telescope-raft', { includeHiddenElements: true })).toBeNull();
  });

  describe('섬 띠는 바다 그림의 수평선 horizonGap 위에 섬 칸 위쪽을 맞춘다', () => {
    const gap = componentTokens.telescope.horizonGap;
    const bandTop = (screen: any) =>
      StyleSheet.flatten(screen.getByTestId('telescope-band').props.style).marginTop;
    const flagRoom = (screen: any) =>
      StyleSheet.flatten(screen.getByTestId('telescope-panorama').props.contentContainerStyle)
        .paddingTop;
    const layout = (screen: any, testID: string, width: number, height: number) =>
      fireEvent(screen.getByTestId(testID), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width, height } },
      });

    test('onLayout 전에도 창 크기·보통 위 막대 높이로 제자리에 그린다(첫 화면이 튀지 않는다)', async () => {
      const { screen } = await open([item('r1')]);
      // 창 402×874 → 수평선 310pt. 위 막대 = 안전 영역 52 + 여백 8 + 작은 버튼 터치 44 = 104
      expect(104 + bandTop(screen) + flagRoom(screen)).toBeCloseTo(310 - gap, 0);
    });

    test('세로 폰 402×874 — 섬 칸 위쪽 = 수평선 310 − horizonGap, 섬 그림이 수평선에 걸쳐 하늘로 솟는다', async () => {
      const { screen } = await open([item('r1')]);
      await layout(screen, 'telescope', 402, 874);
      await layout(screen, 'telescope-top-bar', 402, 98);
      const cellTop = 98 + bandTop(screen) + flagRoom(screen);
      expect(cellTop).toBeCloseTo(310 - gap, 0);
      // 빈 하늘을 줄이는 배치(GROMO-2414) — 짝수 번째 섬 그림 위쪽은 수평선 위, 아래쪽은 수평선 아래(바다 위에 떠 있다)
      const { islandArtTop, islandArtWidth } = componentTokens.telescope;
      const artTop = cellTop + islandArtTop;
      expect(artTop).toBeLessThan(310);
      expect(artTop + islandArtWidth / ISLAND_ART_ASPECT).toBeGreaterThan(310);
    });

    test('세로 태블릿 1024×1366 — 그림이 위아래로 85pt 씩 잘려 수평선은 460pt', async () => {
      const { screen } = await open([item('r1')]);
      await layout(screen, 'telescope', 1024, 1366);
      await layout(screen, 'telescope-top-bar', 1024, 98);
      expect(98 + bandTop(screen) + flagRoom(screen)).toBeCloseTo(460 - gap, 0);
    });

    test('큰 글자로 위 막대가 수평선 아래까지 길어지면 겹치지 않게 기본 여백만 둔다', async () => {
      const { screen } = await open([item('r1')]);
      await layout(screen, 'telescope', 402, 874);
      await layout(screen, 'telescope-top-bar', 402, 400);
      expect(bandTop(screen)).toBe(40);
    });
  });
});

test('소속 섬 접근성 라벨은 소속임을 말하고, 깃발 장식은 스크린리더에서 숨는다', async () => {
  const { screen } = await open(EIGHT());
  expect(screen.getByTestId('telescope-island-j1').props.accessibilityLabel).toBe(
    '섬 j1, 내가 사는 섬',
  );
  // 소속이 아닌 섬은 알약처럼 항해 시간도 읽는다
  expect(screen.getByTestId('telescope-island-r1').props.accessibilityLabel).toBe(
    '섬 r1, 항해 30분',
  );
  expect(
    screen.getByTestId('telescope-flag-j1', { includeHiddenElements: true }).props
      .accessibilityElementsHidden,
  ).toBe(true);
});

test.each([
  [83, '평균 1시간 23분'],
  [45, '평균 45분'],
  [0, '평균 0분'],
  [120, '평균 2시간'],
  [null, '아직 집계 전'],
])('말풍선은 이름·소개·주민·평균 집중(%s)·항해 시간 5가지를 보여 준다', async (average, text) => {
  const { screen } = await open([item('r1', { averageFocusMinutesPerDay: average })]);
  await press(screen, 'r1');
  expect(screen.getByTestId('telescope-bubble-name').props.children).toBe('섬 r1');
  screen.getByText('r1 소개');
  screen.getByText('주민 3/15');
  screen.getByText(text);
  screen.getByText('항해 30분');
});

test('말풍선을 닫으면 사라지고, 다른 섬을 누르면 그 섬의 정보가 뜬다', async () => {
  const { screen } = await open(EIGHT());
  await press(screen, 'n1');
  screen.getByText('항해 15분');
  await fireEvent.press(screen.getByLabelText('닫기'));
  expect(screen.queryByTestId('telescope-bubble-name')).toBeNull();
  await press(screen, 'r2');
  expect(screen.getByTestId('telescope-bubble-name').props.children).toBe('섬 r2');
});

test('말풍선이 열려 있는 동안 뒤 화면은 스크린리더에서 숨고, 닫으면 돌아온다', async () => {
  const { screen } = await open([item('r1'), item('r2')]);
  await press(screen, 'r1');
  // 숨은 요소는 기본 쿼리에서 빠진다
  expect(screen.queryByTestId('telescope-island-r2')).toBeNull();
  expect(screen.getByTestId('telescope-island-r2', { includeHiddenElements: true })).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('닫기'));
  expect(screen.getByTestId('telescope-island-r2')).toBeTruthy();
});

test('말풍선을 닫아도 그 사이 다른 곳이 걸어 둔 뒤로가기 처리는 지우지 않는다', async () => {
  const { screen, e } = await open([item('r1')]);
  await press(screen, 'r1');
  const other = () => false;
  e.backOverride.current = other;
  await fireEvent.press(screen.getByLabelText('닫기'));
  expect(screen.queryByTestId('telescope-bubble-name')).toBeNull();
  expect(e.backOverride.current).toBe(other);
});

describe('파노라마 바다(GROMO-2414) — 섬을 밀면 바다도 같이 밀린다', () => {
  const flat = (node: any) => StyleSheet.flatten(node.props.style);

  test('바다 그림은 파노라마 가로 스크롤 오프셋만큼 같은 속도로 따라가고(UI 스레드 이벤트), 뗏목 고양이는 고정이다', async () => {
    // 앱은 네이티브 드라이버(UI 스레드)로 잇는다. 테스트 런타임에는 네이티브 값이 JS 로 돌아오지 않아,
    // 설정을 확인한 뒤 같은 매핑을 JS 드라이버로 돌려 스크롤 → 바다 이동을 본다
    const real = Animated.event;
    const event = jest
      .spyOn(Animated, 'event')
      .mockImplementation((mapping, config) =>
        real(mapping, { ...config, useNativeDriver: false }),
      );
    try {
      const { screen } = await open([item('r1'), item('r2'), item('r3'), item('r4')]);
      expect(event).toHaveBeenCalledWith(
        [{ nativeEvent: { contentOffset: { x: expect.any(Animated.Value) } } }],
        { useNativeDriver: true },
      );
      const panorama = screen.getByTestId('telescope-panorama');
      expect(panorama.props.scrollEventThrottle).toBe(16);
      const seaX = () =>
        flat(screen.getByTestId('telescope-sea', { includeHiddenElements: true })).transform[0]
          .translateX;
      const raft = () =>
        flat(screen.getByTestId('telescope-raft', { includeHiddenElements: true }));
      expect(seaX()).toBeCloseTo(0, 6); // −0
      const raftBefore = raft();
      await fireEvent.scroll(panorama, { nativeEvent: { contentOffset: { x: 240, y: 0 } } });
      expect(seaX()).toBe(-240);
      await fireEvent.scroll(panorama, { nativeEvent: { contentOffset: { x: 90, y: 0 } } });
      expect(seaX()).toBe(-90);
      expect(raft()).toEqual(raftBefore);
    } finally {
      event.mockRestore();
    }
  });

  test('목록 → 빈 목록 → 목록이 되면 다시 생긴 파노라마와 함께 바다도 스크롤 0 자리에서 시작한다', async () => {
    jest.useFakeTimers();
    // 위 테스트처럼 같은 매핑을 JS 드라이버로 돌린다
    const real = Animated.event;
    const event = jest
      .spyOn(Animated, 'event')
      .mockImplementation((mapping, config) =>
        real(mapping, { ...config, useNativeDriver: false }),
      );
    try {
      mockGet
        .mockResolvedValueOnce(wire([item('r1'), item('r2'), item('r3'), item('r4')], 1))
        .mockResolvedValueOnce(wire([], 1))
        .mockResolvedValueOnce(wire([item('r5'), item('r6'), item('r7')], 30));
      const screen = await render(<Telescope e={env()} />);
      await screen.findByTestId('telescope-island-r1');
      const seaX = () =>
        flat(screen.getByTestId('telescope-sea', { includeHiddenElements: true })).transform[0]
          .translateX;
      await fireEvent.scroll(screen.getByTestId('telescope-panorama'), {
        nativeEvent: { contentOffset: { x: 240, y: 0 } },
      });
      expect(seaX()).toBe(-240);
      // 1분 뒤 다시 읽은 목록이 비어 파노라마가 사라진다
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      await screen.findByText('지금은 보이는 섬이 없어요');
      expect(seaX()).toBeCloseTo(0, 6);
      // 다시 섬이 생기면 새 파노라마(스크롤 0)와 바다가 같은 자리다 — 옛 오프셋 −240 에 남지 않는다
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      await screen.findByTestId('telescope-island-r5');
      expect(seaX()).toBeCloseTo(0, 6);
    } finally {
      event.mockRestore();
    }
  });

  test.each([
    [402, 874, 1228],
    [874, 402, 874],
    [1024, 1366, 1600],
  ])(
    '%s×%s — 이어 붙인 바다는 수평선 높이 그대로, 반전 장을 번갈아 빈틈 없이 스크롤 끝·튕김까지 덮는다',
    (w, h, content) => {
      const sea = telescopeSeaTiles(w, h, content);
      const scale = Math.max(w / telescopeSea.width, h / telescopeSea.height);
      // 한 장은 예전 cover 가운데 맞춤과 같은 크기·높이 — 수평선이 그대로다
      expect(sea.width).toBeCloseTo(telescopeSea.width * scale, 6);
      expect(sea.top + telescopeSea.horizon * scale).toBeCloseTo(
        (h - telescopeSea.height * scale) / 2 + telescopeSea.horizon * scale,
        6,
      );
      const zero = sea.tiles.find((tile) => tile.n === 0)!;
      expect(zero.left).toBeCloseTo((w - sea.width) / 2, 6);
      expect(zero.mirror).toBe(false);
      sea.tiles.forEach((tile, i) => {
        if (i === 0) return;
        const prev = sea.tiles[i - 1];
        // 맞닿고, 반전이 번갈아 든다(맞닿는 가장자리가 같은 픽셀 줄이라 이음매가 안 보인다)
        expect(tile.left).toBeCloseTo(prev.left + sea.width, 6);
        expect(tile.mirror).toBe(!prev.mirror);
      });
      // 스크롤 0~끝(content − w)과 양쪽 한 화면 튕김까지 화면이 늘 바다로 덮인다
      expect(sea.tiles[0].left).toBeLessThanOrEqual(-w);
      expect(sea.tiles.at(-1)!.left + sea.width).toBeGreaterThanOrEqual(content + w);
    },
  );
});

describe('버튼 상태', () => {
  test('가입 안 한 공개 섬 — [항해하기] + [바로 가입]', async () => {
    const { screen } = await open([item('r1')]);
    await press(screen, 'r1');
    expect(disabled(screen, '항해하기')).toBe(false);
    expect(disabled(screen, '바로 가입')).toBe(false);
    expect(screen.queryByLabelText('돌아가기')).toBeNull();
  });

  test('승인제 섬 — [가입 신청]', async () => {
    const { screen } = await open([item('r1', { approvalRequired: true })]);
    await press(screen, 'r1');
    expect(disabled(screen, '가입 신청')).toBe(false);
    expect(screen.queryByLabelText('바로 가입')).toBeNull();
  });

  test('신청 중 — 「신청 중」 비활성', async () => {
    const { screen } = await open([
      item('r1', { approvalRequired: true, membershipStatus: 'pending' }),
    ]);
    await press(screen, 'r1');
    expect(disabled(screen, '신청 중')).toBe(true);
    expect(disabled(screen, '항해하기')).toBe(false);
  });

  test('정원이 찬 섬 — 「정원이 찼어요」 비활성, 구경(항해)은 된다', async () => {
    const { screen } = await open([item('r1', { full: true })]);
    await press(screen, 'r1');
    expect(disabled(screen, '정원이 찼어요')).toBe(true);
    expect(disabled(screen, '항해하기')).toBe(false);
  });

  test('가 본 소속 섬 — [돌아가기] 만(항해하기·가입 없음)', async () => {
    const { screen } = await open([mine('j2', { arrivedBefore: true })]);
    await press(screen, 'j2');
    expect(disabled(screen, '돌아가기')).toBe(false);
    expect(screen.queryByLabelText('항해하기')).toBeNull();
    expect(screen.queryByLabelText('바로 가입')).toBeNull();
    expect(screen.queryByLabelText('가입 신청')).toBeNull();
  });

  test('망원경으로 가입만 한 미도착 소속 섬 — [돌아가기] 대신 [항해하기] 만', async () => {
    const { screen } = await open([mine('j3')]);
    await press(screen, 'j3');
    expect(disabled(screen, '항해하기')).toBe(false);
    expect(screen.queryByLabelText('돌아가기')).toBeNull();
    expect(screen.queryByLabelText('바로 가입')).toBeNull();
  });
});

describe('가입', () => {
  test('[바로 가입]은 origin telescope 로 부르고, 안내 뒤 목록을 다시 읽는다', async () => {
    const { screen, e } = await open([item('r1')]);
    await press(screen, 'r1');
    await fireEvent.press(screen.getByLabelText('바로 가입'));
    expect(e.islands!.join).toHaveBeenCalledTimes(1);
    expect(e.islands!.join).toHaveBeenCalledWith('r1', {
      showApproval: false,
      origin: 'telescope',
    });
    await screen.findByLabelText('바로 가입');
    expect(e.notify).toHaveBeenCalledWith('주민이 됐어요 — 항해해서 처음 가 보세요');
    expect(mockGet).toHaveBeenCalledTimes(2);
    // 즉시 가입이어도 현재 섬을 옮기거나 홈으로 보내지 않는다(처음 한 번은 항해)
    expect(e.reset).not.toHaveBeenCalled();
    expect(e.dispatch).not.toHaveBeenCalled();
  });

  test('승인제는 신청 완료 문구를 알린다', async () => {
    const e = env();
    e.islands!.join.mockResolvedValue({ status: 'pending' });
    const { screen } = await open([item('r1', { approvalRequired: true })], e);
    await press(screen, 'r1');
    await fireEvent.press(screen.getByLabelText('가입 신청'));
    await screen.findByLabelText('가입 신청');
    expect(e.notify).toHaveBeenCalledWith('참여 신청이 완료됐어요. 방장이 확인하면 알려드릴게요.');
  });

  test('소속 섬이 가득 찬 409 는 서버 코드의 문구로 알리고 목록은 다시 읽지 않는다', async () => {
    const e = env();
    e.islands!.join.mockRejectedValue(
      new ApiError('ISLAND_LIMIT_EXCEEDED', '소속 섬이 가득 찼어요 (3/3).', 409),
    );
    const { screen } = await open([item('r1')], e);
    await press(screen, 'r1');
    await fireEvent.press(screen.getByLabelText('바로 가입'));
    await screen.findByLabelText('바로 가입');
    expect(e.notify).toHaveBeenCalledWith(
      '소속 섬이 가득 찼어요 (3/3). 섬을 하나 나가면 새로 가입할 수 있어요',
    );
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  test('요청 중에는 버튼이 막혀 중복 가입을 보내지 않는다', async () => {
    const e = env();
    let finish!: () => void;
    e.islands!.join.mockReturnValue(
      new Promise<{ status: string }>((r) => (finish = () => r({ status: 'active' }))),
    );
    const { screen } = await open([item('r1')], e);
    await press(screen, 'r1');
    await fireEvent.press(screen.getByLabelText('바로 가입'));
    expect(disabled(screen, '처리 중이에요')).toBe(true);
    expect(disabled(screen, '항해하기')).toBe(true);
    await fireEvent.press(screen.getByLabelText('처리 중이에요'));
    expect(e.islands!.join).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.getByLabelText('바로 가입')).toBeTruthy();
  });

  test('한 섬의 가입 요청 중 다른 섬을 열면 그 섬의 가입 버튼은 «처리 중»이 아니라 평소 글자(비활성)이고 요청도 나가지 않는다', async () => {
    const e = env();
    let finish!: () => void;
    e.islands!.join.mockReturnValue(
      new Promise<{ status: string }>((r) => (finish = () => r({ status: 'active' }))),
    );
    const { screen } = await open([item('r1'), item('r2')], e);
    await press(screen, 'r1');
    await fireEvent.press(screen.getByLabelText('바로 가입'));
    expect(disabled(screen, '처리 중이에요')).toBe(true); // 요청 중인 r1 의 버튼
    await fireEvent.press(screen.getByLabelText('닫기'));
    await press(screen, 'r2');
    // r2 는 «처리 중»이 아니다 — 한 번에 한 가입 요청만 나가므로 막혀 있을 뿐이다
    expect(screen.queryByLabelText('처리 중이에요')).toBeNull();
    expect(disabled(screen, '바로 가입')).toBe(true);
    await fireEvent.press(screen.getByLabelText('바로 가입'));
    expect(e.islands!.join).toHaveBeenCalledTimes(1);
    expect(e.islands!.join).toHaveBeenCalledWith('r1', {
      showApproval: false,
      origin: 'telescope',
    });
    // r1 요청이 끝나면 r2 의 버튼이 다시 열린다
    await act(async () => finish());
    expect(disabled(screen, '바로 가입')).toBe(false);
    expect(screen.queryByLabelText('처리 중이에요')).toBeNull();
  });
});

describe('항해하기(바다 항해 집중, GROMO-2310)', () => {
  test('권한 미리보기는 서버 연결 없이 항해를 시작하고 목적지와 한마디를 유지한다', async () => {
    const e = { ...env({ islands: false }), focus: undefined, focusBlockingIntroPreview: true };
    const screen = await render(<Telescope e={e} previewItems={[item('r1')]} />);
    await press(screen, 'r1');
    await fireEvent.press(screen.getByLabelText('항해하기'));
    await fireEvent.changeText(screen.getByLabelText('한마디 (선택)'), '영어 공부');
    await fireEvent.press(screen.getByLabelText('항해 시작'));
    expect(e.dispatch).toHaveBeenCalledWith({
      type: 'SESSION_SYNC',
      session: expect.objectContaining({
        islandId: 'r1',
        destinationIslandName: '섬 r1',
        kind: 'sea',
        subject: '영어 공부',
        status: 'active',
        targetMinutes: 30,
      }),
    });
    expect(e.reset).toHaveBeenCalledWith('sea', '섬 r1');
    expect(mockUnpin).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('섬을 고른 뒤 항해하기를 눌러야 권한 안내를 요청하고, 완료 뒤 항해 준비를 연다', async () => {
    const beforeSeaVoyage = jest.fn();
    const e = { ...env(), beforeSeaVoyage };
    const { screen } = await open([item('r1')], e);
    expect(beforeSeaVoyage).not.toHaveBeenCalled();
    await press(screen, 'r1');
    expect(beforeSeaVoyage).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('항해하기'));
    expect(beforeSeaVoyage).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('항해 시작')).toBeNull();
    expect(e.focus.startSea).not.toHaveBeenCalled();
    await act(async () => beforeSeaVoyage.mock.calls[0][0]());
    expect(screen.getByLabelText('항해 시작')).toBeTruthy();
    expect(e.focus.startSea).not.toHaveBeenCalled();
  });

  const sailTo = async (screen: any, id: string) => {
    await press(screen, id);
    await fireEvent.press(screen.getByLabelText('항해하기'));
  };
  const start = async (screen: any, remark = '') => {
    if (remark) await fireEvent.changeText(screen.getByLabelText('한마디 (선택)'), remark);
    await fireEvent.press(screen.getByLabelText('항해 시작'));
    await act(async () => {});
  };

  test('한마디 시트 → 바다 항해 시작 → 항해 화면(sea, 목적지 이름) — 섬 구경·도착 기록은 하지 않는다', async () => {
    const { screen, e } = await open([item('r1')]);
    await sailTo(screen, 'r1');
    screen.getByText('섬 r1(으)로 항해할까요?');
    expect(screen.queryByTestId('telescope-bubble-name')).toBeNull();
    expect(e.focus.startSea).not.toHaveBeenCalled();
    await start(screen);
    expect(e.focus.startSea).toHaveBeenCalledWith('r1');
    // 한마디를 비우면 한마디 저장 요청이 없다
    expect(mockUnpin).not.toHaveBeenCalled();
    expect(e.reset).toHaveBeenCalledWith('sea', '섬 r1');
    expect(mockArrive).not.toHaveBeenCalled();
    expect(e.islands!.visit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sailing')).toBeNull();
  });

  test('망원경으로 가입만 한 소속 섬과 정원이 찬 섬도 같은 바다 항해다', async () => {
    const { screen, e } = await open([mine('j3'), item('r1', { full: true })]);
    await sailTo(screen, 'j3');
    await start(screen);
    await sailTo(screen, 'r1');
    await start(screen);
    expect(e.focus.startSea.mock.calls).toEqual([['j3'], ['r1']]);
  });

  test('한마디를 쓰면 출항이 성공한 «뒤» 한마디를 저장한다(시작 API 는 한마디를 받지 않는다)', async () => {
    const order: string[] = [];
    const e = env();
    e.focus.startSea.mockImplementation(async () => {
      order.push('start');
    });
    mockUnpin.mockImplementation(async () => order.push('remark'));
    const { screen } = await open([item('r1')], e);
    await sailTo(screen, 'r1');
    await start(screen, '수학 3단원');
    expect(order).toEqual(['start', 'remark']);
    expect(mockUnpin).toHaveBeenCalledWith('/me/sea-remark', {
      method: 'PUT',
      body: { remark: '수학 3단원' },
    });
    expect(e.reset).toHaveBeenCalledWith('sea', '섬 r1');
  });

  test.each([
    [
      '5분 잠금(409)',
      new ApiError('SEA_REMARK_LOCKED', '잠김', 409),
      '한마디는 고친 뒤 5분 동안 바꿀 수 없어요',
    ],
    [
      '그 밖 실패',
      new ApiError('CLIENT_NETWORK_ERROR', '유실', 0),
      '한마디를 띄우지 못했어요. 바다에서 다시 써 주세요.',
    ],
  ])('한마디 %s — 토스트로 알리고 출항은 그대로 간다', async (_name, error, toast) => {
    mockUnpin.mockRejectedValue(error);
    const { screen, e } = await open([item('r1')]);
    await sailTo(screen, 'r1');
    await start(screen, '안녕');
    expect(e.notify).toHaveBeenCalledWith(toast);
    expect(e.reset).toHaveBeenCalledWith('sea', '섬 r1');
  });

  test('게스트의 한마디(403)는 회원 전환 시트를 열고 출항은 그대로 간다', async () => {
    const error = new ApiError('SOCIAL_LOGIN_REQUIRED', '로그인', 403);
    mockUnpin.mockRejectedValue(error);
    const e = env();
    e.conversion.offer.mockReturnValue(true);
    const { screen } = await open([item('r1')], e);
    await sailTo(screen, 'r1');
    await start(screen, '안녕');
    expect(e.conversion.offer).toHaveBeenCalledWith(error);
    expect(e.notify).not.toHaveBeenCalled();
    expect(e.reset).toHaveBeenCalledWith('sea', '섬 r1');
  });

  test('목적지가 망원경에서 사라졌으면(409) 안내하고 시트를 닫은 뒤 목록을 다시 읽는다', async () => {
    const e = env();
    e.focus.startSea.mockRejectedValue(new ApiError('SEA_DESTINATION_UNAVAILABLE', '없어요', 409));
    const { screen } = await open([item('r1')], e);
    await sailTo(screen, 'r1');
    await start(screen);
    expect(e.notify).toHaveBeenCalledWith(
      '이 섬은 지금 망원경에서 사라졌어요. 새 목록을 보여 드릴게요.',
    );
    expect(mockScreenReload).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('항해 시작')).toBeNull();
    expect(e.reset).not.toHaveBeenCalled();
  });

  test('그 밖의 시작 실패는 시트에 오류를 두고 출항하지 않는다 — 다시 누를 수 있다', async () => {
    const e = env();
    e.focus.startSea
      .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '유실', 0))
      .mockResolvedValueOnce(undefined);
    const { screen } = await open([item('r1')], e);
    await sailTo(screen, 'r1');
    await start(screen);
    expect(e.reset).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
    await start(screen);
    expect(e.focus.startSea).toHaveBeenCalledTimes(2);
    expect(e.reset).toHaveBeenCalledWith('sea', '섬 r1');
  });

  test('집중·휴식 중에는 시트 없이 안내하고 항해를 시작하지 않는다', async () => {
    const { screen, e } = await open([item('r1')], env({ session: true }));
    await sailTo(screen, 'r1');
    expect(e.notify).toHaveBeenCalledWith('집중이나 휴식을 마친 뒤 섬을 구경해 주세요.');
    expect(screen.queryByLabelText('항해 시작')).toBeNull();
    expect(e.focus.startSea).not.toHaveBeenCalled();
  });

  test('시작 요청 중 뒤로가기는 삼킨다', async () => {
    let started!: () => void;
    const e = env();
    e.focus.startSea.mockReturnValue(new Promise<void>((r) => (started = r)));
    const { screen } = await open([item('r1')], e);
    await sailTo(screen, 'r1');
    await fireEvent.press(screen.getByLabelText('항해 시작'));
    expect(e.backOverride.current?.()).toBe(true);
    expect(screen.getByLabelText('처리 중…')).toBeTruthy();
    await act(async () => started());
    expect(e.reset).toHaveBeenCalledWith('sea', '섬 r1');
  });

  test('출항 뒤 한마디 저장이 늦어도 화면 전환까지 잠금이 유지된다 — 다시 시작·닫기·뒤로가기가 막힌다', async () => {
    let saved!: () => void;
    mockUnpin.mockReturnValue(new Promise<void>((r) => (saved = r)));
    const { screen, e } = await open([item('r1')]);
    await sailTo(screen, 'r1');
    await start(screen, '안녕');
    expect(e.focus.startSea).toHaveBeenCalledTimes(1);
    expect(e.reset).not.toHaveBeenCalled();
    // 한마디 응답을 기다리는 동안 시트는 처리 중이고 뒤로가기는 삼킨다
    expect(screen.getByLabelText('처리 중…').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText('처리 중…'));
    expect(e.focus.startSea).toHaveBeenCalledTimes(1);
    expect(e.backOverride.current?.()).toBe(true);
    expect(screen.getByLabelText('처리 중…')).toBeTruthy();
    await act(async () => saved());
    expect(e.reset).toHaveBeenCalledWith('sea', '섬 r1');
  });

  test('다른 기기가 먼저 출항해 충돌(409 STATE_CONFLICT)하면 복원된 진행 세션 화면으로 간다 — 오류 안내 없음', async () => {
    const e = env();
    e.focus.startSea.mockRejectedValue(new ApiError('STATE_CONFLICT', '이미 진행 중', 409));
    e.focus.recover.mockResolvedValue('sea');
    const { screen } = await open([item('r1')], e);
    await sailTo(screen, 'r1');
    await start(screen);
    expect(e.focus.recover).toHaveBeenCalledTimes(1);
    expect(e.reset).toHaveBeenCalledTimes(1);
    expect(e.reset).toHaveBeenCalledWith('sea', undefined);
    expect(e.notify).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByLabelText('항해 시작')).toBeNull();
  });

  test('출항 재시도로 복원된 세션이 섬 집중이면(다른 기기가 항해를 끝내고 시작) 그 집중 화면으로 — 바다·한마디 없음', async () => {
    const e = env();
    e.focus.startSea.mockResolvedValue({
      id: 'sess-9',
      islandId: 'home',
      kind: 'island',
      status: 'active',
    });
    const { screen } = await open([item('r1')], e);
    await sailTo(screen, 'r1');
    await start(screen, '수학 3단원');
    expect(e.reset).toHaveBeenCalledTimes(1);
    expect(e.reset.mock.calls[0][0]).toBe('focus');
    expect(e.reset.mock.calls.some((c: unknown[]) => c[0] === 'sea')).toBe(false);
    expect(mockUnpin).not.toHaveBeenCalledWith('/me/sea-remark', expect.anything());
  });

  test('충돌 뒤 정본에도 진행 세션이 없으면 시트에 오류를 둔다', async () => {
    const e = env();
    e.focus.startSea.mockRejectedValue(new ApiError('STATE_CONFLICT', '이미 진행 중', 409));
    const { screen } = await open([item('r1')], e);
    await sailTo(screen, 'r1');
    await start(screen);
    expect(e.reset).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  test('시트가 열려 있을 때 뒤로가기는 시트만 닫는다', async () => {
    const { screen, e } = await open([item('r2')]);
    await sailTo(screen, 'r2');
    let handled = false;
    await act(async () => {
      handled = e.backOverride.current?.() ?? false;
    });
    expect(handled).toBe(true);
    expect(screen.queryByLabelText('항해 시작')).toBeNull();
    expect(e.focus.startSea).not.toHaveBeenCalled();
  });
});

describe('돌아가기', () => {
  test('가 본 소속 섬은 switchCurrent → 짧은 항해 연출 → 홈 reset(방문 상태가 아니면 END_VISIT 없음)', async () => {
    const { screen, e } = await open([mine('j2', { arrivedBefore: true })]);
    await press(screen, 'j2');
    await fireEvent.press(screen.getByLabelText('돌아가기'));
    expect(e.islands!.switchCurrent).toHaveBeenCalledWith('j2');
    expect((await screen.findByTestId('sailing-label')).props.children).toContain('섬 j2');
    expect(mockArrive).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('sailing'));
    expect(e.reset).toHaveBeenCalledWith('home');
    expect(e.dispatch).not.toHaveBeenCalled();
  });

  test('이미 서 있는 섬이면 연출·요청 없이 홈으로 돌아간다', async () => {
    const { screen, e } = await open([mine('j1', { arrivedBefore: true })]);
    await press(screen, 'j1');
    await fireEvent.press(screen.getByLabelText('돌아가기'));
    expect(e.home).toHaveBeenCalledTimes(1);
    expect(e.islands!.switchCurrent).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sailing')).toBeNull();
  });

  test('이동이 거절되면 서버 문구를 알리고 연출하지 않는다', async () => {
    const e = env();
    e.islands!.switchCurrent.mockRejectedValue(new ApiError('ISLAND_NOT_ARRIVED', '아직', 403));
    const { screen } = await open([mine('j2', { arrivedBefore: true })], e);
    await press(screen, 'j2');
    await fireEvent.press(screen.getByLabelText('돌아가기'));
    await act(async () => {});
    expect(e.notify).toHaveBeenCalledWith('아직 가 본 적 없는 섬이에요. 망원경에서 항해해 주세요.');
    expect(screen.queryByTestId('sailing')).toBeNull();
  });
});

describe('카운트다운', () => {
  test('「N분 뒤 새 섬」이 1분마다 줄고 0 이 되면 목록을 다시 읽는다', async () => {
    jest.useFakeTimers();
    mockGet
      .mockResolvedValueOnce(wire([item('r1')], 2))
      .mockResolvedValueOnce(wire([item('r2')], 60));
    const screen = await render(<Telescope e={env()} />);
    await screen.findByText('2분 뒤 새 섬');
    expect(mockGet).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    screen.getByText('1분 뒤 새 섬');
    expect(mockGet).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    // 0분에 다시 읽고, 새 목록의 남은 시간으로 다시 시작한다
    expect(mockGet).toHaveBeenCalledTimes(2);
    await screen.findByText('60분 뒤 새 섬');
    screen.getByTestId('telescope-island-r2');
    expect(screen.queryByTestId('telescope-island-r1')).toBeNull();
  });

  test('다시 읽기가 실패해도 보던 목록과 카운트다운은 남고 1분 뒤 다시 시도한다', async () => {
    jest.useFakeTimers();
    mockGet
      .mockResolvedValueOnce(wire([item('r1')], 1))
      .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', 'x', 0))
      .mockResolvedValueOnce(wire([item('r2')], 30));
    const screen = await render(<Telescope e={env()} />);
    await screen.findByText('1분 뒤 새 섬');
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(mockGet).toHaveBeenCalledTimes(2);
    screen.getByTestId('telescope-island-r1');
    expect(screen.queryByText('섬을 불러오지 못했어요.')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(mockGet).toHaveBeenCalledTimes(3);
    await screen.findByTestId('telescope-island-r2');
  });

  test('앱이 백그라운드에 있어 시계가 건너뛰어도 첫 틱에 남은 분을 따라잡고, 이미 지났으면 다시 읽는다', async () => {
    jest.useFakeTimers();
    mockGet
      .mockResolvedValueOnce(wire([item('r1')], 30))
      .mockResolvedValueOnce(wire([item('r2')], 45));
    const screen = await render(<Telescope e={env()} />);
    await screen.findByText('30분 뒤 새 섬');
    // 10분 건너뛰고 첫 틱(1분) — 11분이 흐른 셈이다
    jest.setSystemTime(Date.now() + 10 * 60_000);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    screen.getByText('19분 뒤 새 섬');
    expect(mockGet).toHaveBeenCalledTimes(1);
    // 한 시간이 지난 뒤 돌아오면 다음 틱에 곧바로 다시 읽는다
    jest.setSystemTime(Date.now() + 60 * 60_000);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(mockGet).toHaveBeenCalledTimes(2);
    await screen.findByText('45분 뒤 새 섬');
    screen.getByTestId('telescope-island-r2');
  });

  test('서버가 0 이하를 줘도 최소 1분으로 시작해 다시 읽기 고리에 갇히지 않는다', async () => {
    mockGet.mockImplementation(async () => wire([item('r1')], 0));
    const screen = await render(<Telescope e={env()} />);
    await screen.findByText('1분 뒤 새 섬');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

describe('로딩·빈 목록·오류', () => {
  test('불러오는 동안 로딩 안내, 빈 목록은 안내 문구(카운트다운은 그대로)', async () => {
    let resolve!: (v: unknown) => void;
    mockGet.mockReturnValue(new Promise((r) => (resolve = r)));
    const screen = await render(<Telescope e={env()} />);
    screen.getByText('섬을 찾고 있어요');
    expect(screen.queryByText(/뒤 새 섬/)).toBeNull();
    await act(async () => resolve(wire([], 12)));
    // 빈 목록 안내는 섬이 놓일 띠(수평선) 자리에 한 줄이다
    within(screen.getByTestId('telescope-band')).getByText('지금은 보이는 섬이 없어요');
    screen.getByText('12분 뒤 새 섬');
    expect(screen.queryByText('섬을 찾고 있어요')).toBeNull();
  });

  test('오류는 문구와 「다시 시도」로 구분하고, 다시 시도하면 목록이 뜬다', async () => {
    mockGet
      .mockRejectedValueOnce(
        new ApiError('CLIENT_NETWORK_ERROR', '네트워크에 연결할 수 없어요.', 0),
      )
      .mockResolvedValueOnce(wire([item('r1')]));
    const screen = await render(<Telescope e={env()} />);
    await screen.findByText('네트워크에 연결할 수 없어요.');
    expect(screen.queryByText('지금은 보이는 섬이 없어요')).toBeNull();
    await fireEvent.press(screen.getByLabelText('다시 시도'));
    await screen.findByTestId('telescope-island-r1');
    expect(screen.queryByText('네트워크에 연결할 수 없어요.')).toBeNull();
  });

  test('서버 연결이 없는 목업 모드는 호출 없이 빈 목록이다', async () => {
    const screen = await render(<Telescope e={env({ islands: false })} />);
    screen.getByText('지금은 보이는 섬이 없어요');
    expect(mockGet).not.toHaveBeenCalled();
  });
});

test('뒤로 버튼은 e.back 을 부르고, 말풍선이 열려 있으면 뒤로가기는 말풍선만 닫는다', async () => {
  const { screen, e } = await open([item('r1')]);
  await fireEvent.press(screen.getByLabelText('뒤로'));
  expect(e.back).toHaveBeenCalledTimes(1);
  expect(e.backOverride.current).toBeNull();
  await press(screen, 'r1');
  let swallowed = false;
  await act(async () => {
    swallowed = !!e.backOverride.current?.();
  });
  expect(swallowed).toBe(true);
  expect(screen.queryByTestId('telescope-bubble-name')).toBeNull();
  expect(e.backOverride.current).toBeNull();
});

test('영어 — 말풍선 정보·버튼·카운트다운이 번역된다', async () => {
  applyLocalePref('en');
  mockGet.mockImplementation(async () => wire([item('r1', { name: 'Maple', intro: 'Hi' })], 37));
  const screen = await render(<Telescope e={env()} />);
  await screen.findByText('Islands change in 37 min');
  await press(screen, 'r1');
  screen.getByText('Residents 3/15');
  screen.getByText('Average 1h 23m');
  screen.getByText('Sailing 30 min');
  screen.getByLabelText('Set sail');
  screen.getByLabelText('Join now');
});

describe('큰 글자·배치', () => {
  const flat = (node: any) => StyleSheet.flatten(node.props.style);
  // Btn 의 dynamicHeight — 높이를 고정(height)하지 않고 최소 높이만 둬 글자가 늘면 같이 늘어난다
  const dynamic = (node: any) => {
    const style = flat(node);
    expect(style.height).toBeUndefined();
    expect(style.minHeight).toBeGreaterThanOrEqual(semanticTokens.size.tapMin);
  };
  const networkError = () =>
    new ApiError('CLIENT_NETWORK_ERROR', '네트워크에 연결할 수 없어요.', 0);

  test('위 막대와 파노라마는 같은 세로 스크롤 안에 흐름으로 쌓여 서로 겹치지 않는다', async () => {
    const { screen } = await open([item('r1')]);
    const scroll = screen.getByTestId('telescope-scroll');
    // 가로가 아닌 세로 스크롤 — 큰 글자·가로 화면에서 화면보다 길어져도 끝까지 닿는다. 아래는 홈 인디케이터만큼 비운다
    expect(scroll.props.horizontal).toBeFalsy();
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBeGreaterThan(
      32,
    );
    const parts = within(scroll).getAllByTestId(/^telescope-(top-bar|band)$/);
    expect(parts.map((n: any) => n.props.testID)).toEqual(['telescope-top-bar', 'telescope-band']);
    // 절대 위치였다면 서로의 높이를 모른 채 겹쳤다 — 흐름 배치라야 아래가 위의 높이만큼 밀린다
    for (const part of parts) expect(flat(part).position).not.toBe('absolute');
    within(parts[0]).getByLabelText('뒤로');
    within(parts[1]).getByTestId('telescope-island-r1');
  });

  test.each([
    ['로딩', '섬을 찾고 있어요'],
    ['빈 목록', '지금은 보이는 섬이 없어요'],
    ['오류', '네트워크에 연결할 수 없어요.'],
  ])(
    '%s 안내 카드는 가로 화면에서 노치 쪽 안전 영역만큼 더 비운다(위 막대와 같은 좌우 여백)',
    async (state, label) => {
      // 좌우를 다른 값으로 둬 왼쪽·오른쪽을 따로 확인한다
      mockInsets = { top: 0, bottom: 21, left: 47, right: 59 };
      if (state === '로딩') mockGet.mockReturnValue(new Promise(() => {}));
      else if (state === '빈 목록') mockGet.mockResolvedValue(wire([], 12));
      else mockGet.mockRejectedValue(networkError());
      const screen = await render(<Telescope e={env()} />);
      const card = flat((await screen.findByText(label)).parent);
      const page = semanticTokens.spacing.page;
      expect(card.marginLeft).toBe(47 + page);
      expect(card.marginRight).toBe(59 + page);
      // 위 막대의 좌우 패딩과 같은 값이다
      const bar = flat(screen.getByTestId('telescope-top-bar'));
      expect(card.marginLeft).toBe(bar.paddingLeft);
      expect(card.marginRight).toBe(bar.paddingRight);
    },
  );

  test('말풍선 버튼 4종(항해하기 둘 · 돌아가기 · 가입)은 글자 크기와 상관없이 높이가 늘어난다', async () => {
    const { screen } = await open([item('r1'), mine('j2', { arrivedBefore: true }), mine('j3')]);
    await press(screen, 'r1');
    dynamic(screen.getByLabelText('항해하기'));
    dynamic(screen.getByLabelText('바로 가입'));
    await fireEvent.press(screen.getByLabelText('닫기'));
    await press(screen, 'j2');
    dynamic(screen.getByLabelText('돌아가기'));
    await fireEvent.press(screen.getByLabelText('닫기'));
    await press(screen, 'j3');
    dynamic(screen.getByLabelText('항해하기'));
  });

  test.each([
    [1, false],
    [semanticTokens.typography.largeTextThreshold - 0.01, false],
    [semanticTokens.typography.largeTextThreshold, true],
    [3, true],
  ])(
    '글자 배율 %s — 다시 시도 작은 버튼의 높이 가변은 %s, 뒤로 동그라미는 늘 44',
    async (scale, grows) => {
      mockFontScale = scale;
      mockGet.mockRejectedValueOnce(networkError());
      const screen = await render(<Telescope e={env()} />);
      await screen.findByText('네트워크에 연결할 수 없어요.');
      const retry = screen.getByLabelText('다시 시도');
      // 보통 글자에서는 작은 버튼의 38pt 모양을 그대로 둔다(터치 영역은 부모 44pt)
      if (grows) dynamic(retry);
      else expect(flat(retry).height).toBe(38);
      // 뒤로는 글자 없는 공용 NavBtn — 글자 배율과 상관없이 누르는 자리 44
      const back = flat(screen.getByLabelText('뒤로'));
      expect(back.width).toBe(semanticTokens.size.tapMin);
      expect(back.height).toBe(semanticTokens.size.tapMin);
    },
  );

  test.each([
    [1, 1],
    [3, 2],
  ])(
    '섬 이름 알약은 공용 Badge soft 이고 글자 배율 %s 에서 %s줄까지 보인다',
    async (scale, lines) => {
      mockFontScale = scale;
      const name = '아주아주아주 긴 이름을 가진 섬이에요 정말로';
      const { screen } = await open([item('r1', { name })]);
      const text = screen.getByText(`${name} · 30분`);
      expect(text.props.numberOfLines).toBe(lines);
      // 넘치면 가운데를 줄여 끝의 「 · 30분」이 남는다(끝 말줄임이면 항해 시간이 잘린다)
      expect(text.props.ellipsizeMode).toBe('middle');
      // 공용 Badge soft 의 토큰 모양에, 섬 그림 아래 가운데 · 최대 폭 배치만 얹는다
      const pill = flat(text.parent);
      expect(pill.backgroundColor).toBe(componentTokens.badge.soft.background);
      expect(pill.borderColor).toBe(componentTokens.badge.soft.border);
      expect(pill.alignSelf).toBe('center');
      expect(pill.maxWidth).toBe(componentTokens.telescope.pillMaxWidth);
      // 칸 폭은 고정이 아니라 최소 폭이다 — 알약이 더 길면 칸이 늘어 옆 섬 알약과 겹치지 않는다
      const cell = flat(screen.getByTestId('telescope-island-r1'));
      expect(cell.width).toBeUndefined();
      expect(cell.minWidth).toBe(componentTokens.telescope.islandBox);
    },
  );

  test('읽기가 실패해 오류 안내로 바뀌면 iOS 는 한 번 읽어 주고, 같은 상태로 다시 그려도 또 읽지 않는다', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
    try {
      mockGet.mockRejectedValueOnce(networkError()).mockRejectedValueOnce(networkError());
      const e = env();
      const screen = await render(<Telescope e={e} />);
      const text = await screen.findByText('네트워크에 연결할 수 없어요.');
      // 안드로이드용 live region 도 같이 걸려 있다
      expect(text.props.accessibilityLiveRegion).toBe('polite');
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenLastCalledWith('네트워크에 연결할 수 없어요.');
      await screen.rerender(<Telescope e={e} />);
      expect(announce).toHaveBeenCalledTimes(1);
      // 다시 시도가 또 실패하면 오류 상태로 새로 바뀐 것이라 한 번 더 읽는다
      await fireEvent.press(screen.getByLabelText('다시 시도'));
      await screen.findByText('네트워크에 연결할 수 없어요.');
      expect(announce).toHaveBeenCalledTimes(2);
    } finally {
      announce.mockRestore();
    }
  });

  test('안드로이드는 직접 읽지 않고 live region 에만 맡기며, 읽기가 성공하면 아무것도 읽지 않는다', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      mockGet.mockRejectedValueOnce(networkError());
      const failed = await render(<Telescope e={env()} />);
      const text = await failed.findByText('네트워크에 연결할 수 없어요.');
      expect(text.props.accessibilityLiveRegion).toBe('polite');
      await failed.unmount();
      os.restore();
      // 정상 목록(iOS)에서도 읽지 않는다
      await open([item('r1')]);
      expect(announce).not.toHaveBeenCalled();
    } finally {
      os.restore();
      announce.mockRestore();
    }
  });
});

// ── GROMO-2273 — 망원경 핀 표시: 「찜」 리본(잡지만) · 잡지 칸 미리보기 자리표시 · [망원경에서 빼기] · 항해 중 확인 ──
describe('핀 표시 · 빼기 (GROMO-2273)', () => {
  const REMOVE = '망원경에서 빼기';
  const removeButton = (screen: any) => screen.getByLabelText(REMOVE);
  // 목록의 칸은 서버가 정한다 — 앱은 slot·pinnedFrom 만 보고 그린다
  const ribbonIds = (screen: any) =>
    screen
      .queryAllByTestId(/^telescope-ribbon-/, { includeHiddenElements: true })
      .map((n: any) => n.props.testID);

  // 구경(서버 방문) 중인 상태 — 실제 리듀서로 만든다(RaftDestinations 테스트와 같다). dispatch 는 목이라 상태는 그대로 남는다.
  function visiting(e: ReturnType<typeof env>, id: string, { entered = true } = {}) {
    let state = reducer(e.state, {
      type: 'ISLAND_VISIT',
      visit: { island: isl(id, `섬 ${id}`), joinRequest: null },
    });
    if (entered) state = reducer(state, { type: 'SERVER_VISITING', islandId: id });
    e.state = state;
    return e;
  }

  test('「찜」 리본은 잡지로 넣은 섬에만 1개 — 전망대 핀·무작위·가까운·소속 섬에는 없다', async () => {
    const { screen } = await open(EIGHT());
    expect(ribbonIds(screen)).toEqual(['telescope-ribbon-p1']);
    // 장식이라 스크린리더에서 숨는다 — 읽는 이름이 «잡지에서 찜한 섬»임을 대신 말한다
    const ribbon = screen.getByTestId('telescope-ribbon-p1', { includeHiddenElements: true });
    expect(ribbon.props.accessibilityElementsHidden).toBe(true);
    within(ribbon).getByText('찜', { includeHiddenElements: true });
    // 모양 — 마스킹테이프처럼 섬 테두리 위에 겹쳐(absolute) 토큰의 각도로 기울어 붙는다
    const ribbonStyle = StyleSheet.flatten(ribbon.props.style);
    expect(ribbonStyle.position).toBe('absolute');
    expect(ribbonStyle.transform).toContainEqual({ rotate: componentTokens.telescope.ribbonTilt });
    expect(screen.getByTestId('telescope-island-p1').props.accessibilityLabel).toBe(
      '섬 p1, 잡지에서 찜한 섬, 항해 30분',
    );
    for (const id of ['p2', 'n1', 'r1', 'r2'])
      expect(screen.getByTestId(`telescope-island-${id}`).props.accessibilityLabel).toBe(
        `섬 ${id}, 항해 ${id === 'n1' ? 15 : 30}분`,
      );
    // 소속 섬은 깃발만이다
    expect(screen.getByTestId('telescope-island-j1').props.accessibilityLabel).toBe(
      '섬 j1, 내가 사는 섬',
    );
  });

  test('출처를 모르는 핀(pinnedFrom 없음)에는 리본이 없다 — 잡지로 넣었다고 확정할 수 없다', async () => {
    const { screen } = await open([item('x1', { slot: 'pinned' }), item('r1')]);
    expect(ribbonIds(screen)).toEqual([]);
  });

  test('목록이 바뀌면 리본도 따라 바뀐다 — 로컬에 «넣었다» 상태를 들지 않는다(목록이 정본)', async () => {
    mockGet
      .mockResolvedValueOnce(wire([item('p1', { slot: 'pinned', pinnedFrom: 'magazine' })], 1))
      .mockResolvedValueOnce(
        wire(
          [item('p1', { slot: 'random' }), item('p9', { slot: 'pinned', pinnedFrom: 'magazine' })],
          30,
        ),
      );
    jest.useFakeTimers();
    const screen = await render(<Telescope e={env()} />);
    await screen.findByTestId('telescope-island-p1');
    expect(ribbonIds(screen)).toEqual(['telescope-ribbon-p1']);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    await screen.findByTestId('telescope-island-p9');
    // 06:59:59 에 넣은 핀이 1초 뒤 만료되듯 목록에서 핀이 아니게 된 섬(p1)의 리본은 곧바로 사라진다
    expect(ribbonIds(screen)).toEqual(['telescope-ribbon-p9']);
  });

  test('잡지로 넣은 섬의 말풍선에는 잡지 칸 미리보기가 1장 — 전망대 핀·무작위·가까운·소속 섬에는 없다', async () => {
    const { screen } = await open(EIGHT());
    await press(screen, 'p1');
    const hidden = { includeHiddenElements: true };
    const cards = screen.getAllByTestId('telescope-magazine-preview', hidden);
    expect(cards).toHaveLength(1);
    // 칸이 없는 자리표시는 섬 그림 장식뿐 — 「잡지 칸 미리보기」 글이 없고 스크린리더에서도 숨긴다
    expect(cards[0].props.accessibilityElementsHidden).toBe(true);
    expect(within(cards[0]).queryByText('잡지 칸 미리보기', hidden)).toBeNull();
    await fireEvent.press(screen.getByLabelText('닫기'));
    for (const id of ['p2', 'n1', 'r1', 'j1']) {
      await press(screen, id);
      screen.getByTestId('telescope-bubble-name');
      expect(screen.queryByTestId('telescope-magazine-preview', hidden)).toBeNull();
      await fireEvent.press(screen.getByLabelText('닫기'));
    }
  });

  test('서버가 그 섬의 오늘 호 칸(magazineCell)을 주면 자리표시 대신 섬장이 꾸민 칸(AdCell)을 그린다', async () => {
    const cell = {
      promotionId: 'pr1',
      privateIsland: false,
      islandId: 'p1',
      name: '별고래',
      buildingCount: 5,
      memberCount: 12,
      maxMembers: 15,
      averageFocusMinutesPerDay: 185,
      relation: 'NONE' as const,
      body: '밤에 같이 공부할 고양이 모여라~',
      layout: {
        v: 1 as const,
        frameId: 'mag.frame-ticket',
        stickers: [{ assetId: 'mag.star', x: 0.8, y: 0.2, scale: 0.1, rotation: 0 }],
        tape: null,
      },
    };
    const { screen } = await open([
      item('p1', { slot: 'pinned', pinnedFrom: 'magazine', magazineCell: cell }),
      item('p3', { slot: 'pinned', pinnedFrom: 'magazine', magazineCell: null }),
    ]);
    await press(screen, 'p1');
    const preview = screen.getByTestId('telescope-magazine-cell');
    expect(screen.queryByTestId('telescope-magazine-preview')).toBeNull();
    // 폭은 말풍선 안 자리를 재고 나서 정한다
    await fireEvent(preview, 'layout', { nativeEvent: { layout: { width: 280, height: 0 } } });
    // 칸이 스스로 섬 이름·글을 읽는다. 실린 날 「주민·평균」 줄은 빼서 아래 줄(지금 숫자)과 겹치지 않는다(신고 동작도 없다)
    const read = within(preview).getByLabelText(/^별고래섬, ‘밤에 같이/);
    expect(read.props.accessibilityActions).toBeUndefined();
    expect(within(preview).queryByText(/주민 12\/15 · /)).toBeNull();
    within(preview).getByText('잡지 칸 미리보기');
    await fireEvent.press(screen.getByLabelText('닫기'));
    // 칸이 없는 잡지 찜(편집부 칸·숨겨진 칸)은 예전 자리표시 그대로
    await press(screen, 'p3');
    expect(
      screen.getByTestId('telescope-magazine-preview', { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.queryByTestId('telescope-magazine-cell')).toBeNull();
  });

  test('서버 세션 없는 목업(telescope 깃발)은 말풍선 행동 버튼을 막는다 — 실제 API 를 부르지 않게', async () => {
    process.env.EXPO_PUBLIC_DEMO = '1';
    process.env.EXPO_PUBLIC_MAGAZINE_MOCK = 'telescope';
    try {
      const screen = await render(<Telescope e={env({ islands: false })} />);
      await fireEvent.press(await screen.findByTestId('telescope-island-mock-island-별고래섬'));
      for (const label of ['항해하기', '바로 가입', '망원경에서 빼기'])
        expect(disabled(screen, label)).toBe(true);
      expect(mockGet).not.toHaveBeenCalled();
    } finally {
      delete process.env.EXPO_PUBLIC_DEMO;
      delete process.env.EXPO_PUBLIC_MAGAZINE_MOCK;
    }
  });

  test.each([
    ['p1', '잡지 핀', true],
    ['p2', '전망대 핀', true],
    ['r1', '무작위 섬', false],
    ['n1', '가까운 섬', false],
    ['j1', '소속 섬', false],
    ['j3', '미도착 소속 섬', false],
  ])(
    '[망원경에서 빼기]는 직접 넣은 섬(pinned)의 말풍선에만 있다 — %s (%s)',
    async (id, _kind, has) => {
      const { screen } = await open(EIGHT());
      await press(screen, id);
      expect(!!screen.queryByLabelText(REMOVE)).toBe(has);
    },
  );

  test.each(['p1', 'p2'])(
    '[빼기](%s) → 성공 알림으로 목록을 다시 읽어 그 자리에 무작위 섬이 뜨고 말풍선이 닫힌다',
    async (pinned) => {
      mockUnpin.mockResolvedValue({ deleted: true });
      // 서버가 빈 자리를 그 시간대의 무작위 섬으로 채운 다음 목록
      const after = EIGHT().map((i) => (i.islandId === pinned ? item('r9') : i));
      mockGet.mockResolvedValueOnce(wire(EIGHT())).mockResolvedValueOnce(wire(after));
      const e = env();
      const screen = await render(<Telescope e={e} />);
      await screen.findByTestId('telescope-island-p1');
      await press(screen, pinned);
      await fireEvent.press(removeButton(screen));
      expect(mockUnpin).toHaveBeenCalledTimes(1);
      expect(mockUnpin).toHaveBeenCalledWith(...deleteCall(pinned));
      await screen.findByTestId('telescope-island-r9');
      // 복귀 로직은 없다 — 빼기가 끝난 뒤 목록을 다시 읽을 뿐이다
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(mockUnpin.mock.invocationCallOrder[0]).toBeLessThan(
        mockGet.mock.invocationCallOrder[1],
      );
      expect(screen.queryByTestId(`telescope-island-${pinned}`)).toBeNull();
      expect(screen.getAllByTestId(/^telescope-island-/)).toHaveLength(8);
      expect(screen.queryByTestId('telescope-bubble-name')).toBeNull();
      expect(e.notify).toHaveBeenCalledWith('망원경에서 뺐어요');
      // 구경 중이 아니니 확인창도 구경 종료도 없다
      expect(e.confirm).not.toHaveBeenCalled();
      expect(e.dispatch).not.toHaveBeenCalled();
      expect(e.reset).not.toHaveBeenCalled();
    },
  );

  // 서버가 빈 자리를 그 시간대의 무작위 섬으로 채운 다음 목록
  const afterUnpin = (id: string) => EIGHT().map((i) => (i.islandId === id ? item('r9') : i));

  test('빼기 성공 뒤 목록은 알림 구독이 정확히 한 번 더 읽는다 — 화면은 reload 를 따로 부르지 않는다(이중 조회 없음)', async () => {
    mockUnpin.mockResolvedValue({ deleted: true });
    const { screen } = await open(EIGHT());
    expect(mockGet).toHaveBeenCalledTimes(1);
    mockGet.mockImplementation(async () => wire(afterUnpin('p1')));
    await press(screen, 'p1');
    await fireEvent.press(removeButton(screen));
    await screen.findByTestId('telescope-island-r9');
    await act(async () => {}); // 늦게 나가는 읽기가 있다면 여기서 드러난다
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockScreenReload).not.toHaveBeenCalled();
  });

  test('빼기 요청 중에 망원경을 나갔다 다시 열어 «빼기 전» 목록을 받아도, 빼기가 끝나면 새 화면이 다시 읽어 핀이 사라진다', async () => {
    let finish!: () => void;
    mockUnpin.mockReturnValue(
      new Promise<{ deleted: true }>((resolve) => (finish = () => resolve({ deleted: true }))),
    );
    const first = env();
    const { screen: old } = await open(EIGHT(), first);
    await press(old, 'p1');
    await fireEvent.press(removeButton(old));
    await old.unmount(); // 요청이 느려 끝나기 전에 망원경을 나갔다
    // 다시 열면 서버는 아직 «빼기 전» 목록을 준다
    const second = env();
    const { screen: reopened } = await open(EIGHT(), second);
    reopened.getByTestId('telescope-island-p1');
    expect(mockGet).toHaveBeenCalledTimes(2);
    // 빼기가 끝나면 서버가 빈 자리를 채운 목록을 준다 — 요청을 낸 옛 화면은 이미 없지만 새 화면은 알림으로 다시 읽는다
    mockGet.mockImplementation(async () => wire(afterUnpin('p1')));
    await act(async () => finish());
    await reopened.findByTestId('telescope-island-r9');
    expect(reopened.queryByTestId('telescope-island-p1')).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(3);
    // 알리는 건 요청을 낸 화면의 몫이다 — 떠난 화면도 다시 연 화면도 토스트를 띄우지 않는다
    expect(first.notify).not.toHaveBeenCalled();
    expect(second.notify).not.toHaveBeenCalled();
  });

  test('빼기에 실패하면 오류만 알리고 말풍선을 둔 채 목록을 다시 읽지 않는다 — 다시 누를 수 있다', async () => {
    mockUnpin
      .mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', 'x', 0))
      .mockResolvedValueOnce({ deleted: true });
    const { screen, e } = await open(EIGHT());
    await press(screen, 'p1');
    await fireEvent.press(removeButton(screen));
    await act(async () => {});
    expect(e.notify).toHaveBeenCalledWith('연결을 확인한 뒤 다시 시도해 주세요.');
    expect(e.notify).not.toHaveBeenCalledWith('망원경에서 뺐어요');
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('telescope-bubble-name').props.children).toBe('섬 p1');
    expect(disabled(screen, REMOVE)).toBe(false);
    await fireEvent.press(removeButton(screen));
    await act(async () => {});
    expect(mockUnpin).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  test('빼기 요청 중에는 말풍선의 버튼이 모두 막혀 중복 요청이 나가지 않는다', async () => {
    let finish!: () => void;
    mockUnpin.mockReturnValue(
      new Promise<{ deleted: true }>((resolve) => (finish = () => resolve({ deleted: true }))),
    );
    const { screen } = await open(EIGHT());
    await press(screen, 'p1');
    await fireEvent.press(removeButton(screen));
    expect(disabled(screen, REMOVE)).toBe(true);
    expect(disabled(screen, '항해하기')).toBe(true);
    expect(disabled(screen, '바로 가입')).toBe(true);
    await fireEvent.press(removeButton(screen));
    expect(mockUnpin).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await screen.findByTestId('telescope-island-p1');
    expect(screen.queryByTestId('telescope-bubble-name')).toBeNull();
  });

  test('화면이 다시 그려지기 전에 같은 틱에 두 번 불려도 요청은 한 번만 나간다(확인창 동작도 마찬가지)', async () => {
    mockUnpin.mockReturnValue(new Promise(() => {}));
    const e = visiting(env(), 'p1');
    const { screen } = await open(EIGHT(), e);
    await press(screen, 'p1');
    await fireEvent.press(removeButton(screen));
    const confirmed = e.confirm.mock.calls[0][2];
    // 한 act 안에서 연달아 부르면 첫 호출의 상태 갱신(비활성)이 반영되기 전에 둘째 호출이 들어간다
    await act(async () => {
      confirmed();
      confirmed();
    });
    expect(mockUnpin).toHaveBeenCalledTimes(1);
  });

  test('화면을 떠난 뒤에 응답이 와도 알리거나 목록을 읽거나 구경을 끝내지 않는다', async () => {
    let finish!: () => void;
    mockUnpin.mockReturnValue(
      new Promise<{ deleted: true }>((resolve) => (finish = () => resolve({ deleted: true }))),
    );
    const e = env();
    const { screen } = await open(EIGHT(), e);
    await press(screen, 'p1');
    await fireEvent.press(removeButton(screen));
    await screen.unmount();
    await act(async () => finish());
    expect(e.notify).not.toHaveBeenCalled();
    expect(mockGet).toHaveBeenCalledTimes(1);
    // 항해 중이던 섬도 마찬가지 — 이미 다른 화면에 있는 사람을 홈으로 끌고 가지 않는다
    mockUnpin.mockReturnValue(
      new Promise<{ deleted: true }>((resolve) => (finish = () => resolve({ deleted: true }))),
    );
    const voyaging = visiting(env(), 'p1');
    const again = await open(EIGHT(), voyaging);
    await press(again.screen, 'p1');
    await fireEvent.press(removeButton(again.screen));
    await act(async () => voyaging.confirm.mock.calls[0][2]());
    await again.screen.unmount();
    await act(async () => finish());
    expect(voyaging.dispatch).not.toHaveBeenCalled();
    expect(voyaging.reset).not.toHaveBeenCalled();
    expect(voyaging.notify).not.toHaveBeenCalled();
  });

  test('가입 요청 중에는 [빼기]도 막힌다', async () => {
    const e = env();
    e.islands!.join.mockReturnValue(new Promise(() => {}));
    const { screen } = await open(EIGHT(), e);
    await press(screen, 'p1');
    await fireEvent.press(screen.getByLabelText('바로 가입'));
    expect(disabled(screen, REMOVE)).toBe(true);
    await fireEvent.press(removeButton(screen));
    expect(mockUnpin).not.toHaveBeenCalled();
  });

  describe('항해 중인 섬(지금 구경 중인 섬)', () => {
    test('[빼기]는 흐리게 보이되 막히지 않고, 이유를 접근성 힌트로 말한다', async () => {
      const { screen } = await open(EIGHT(), visiting(env(), 'p1'));
      await press(screen, 'p1');
      const button = removeButton(screen);
      // 화면 읽기 사용자도 확인창에 닿도록 disabled 로 막지 않는다 — 흐림은 모양일 뿐이다
      expect(button.props.accessibilityState.disabled).toBe(false);
      expect(button.props.accessibilityHint).toBe('항해 중이라 빼려면 항해를 그만둬야 해요');
      expect(StyleSheet.flatten(button.parent.props.style).opacity).toBe(
        componentTokens.button.disabledOpacity,
      );
      // 구경 중이 아닌 핀 섬은 평소 모양이다
      await fireEvent.press(screen.getByLabelText('닫기'));
      await press(screen, 'p2');
      expect(removeButton(screen).props.accessibilityHint).toBeUndefined();
      expect(StyleSheet.flatten(removeButton(screen).parent.props.style).opacity).toBeUndefined();
    });

    test('누르면 「항해를 그만둘까요?」 확인창이 1번 뜨고, 확인 전에는 아무것도 하지 않는다(취소해도 마찬가지)', async () => {
      const e = visiting(env(), 'p1');
      const { screen } = await open(EIGHT(), e);
      await press(screen, 'p1');
      await fireEvent.press(removeButton(screen));
      expect(e.confirm).toHaveBeenCalledTimes(1);
      const [title, body, action, options] = e.confirm.mock.calls[0];
      expect(title).toBe('항해를 그만둘까요?');
      expect(body).toBe(
        '항해 중인 섬은 바로 뺄 수 없어요. 항해를 그만두고 망원경에서 빼면 원래 섬으로 돌아가요.',
      );
      expect(options).toEqual({ ok: '그만두고 빼기' });
      expect(action).toEqual(expect.any(Function));
      // 취소 — App.tsx 확인창의 취소 버튼과 같다: 창을 닫고 opts.onCancel 이 있으면 부르되 action 은 부르지 않는다.
      // 이 화면은 onCancel 을 넘기지 않아(위 options 단정) 부를 콜백이 없다 — 그래도 부르는 줄을 두어, 나중에 onCancel 이 생겨
      // 빼기·구경 종료를 하게 되면 아래 단정이 잡는다. 빼기도 구경 종료도 없다.
      await act(async () => options.onCancel?.());
      expect(mockUnpin).not.toHaveBeenCalled();
      expect(e.dispatch).not.toHaveBeenCalled();
      expect(e.reset).not.toHaveBeenCalled();
      expect(e.notify).not.toHaveBeenCalled();
      expect(screen.getByTestId('telescope-bubble-name').props.children).toBe('섬 p1');
    });

    test('확인하면 빼고 구경도 끝낸다 — 빼기 → END_VISIT → 홈(「구경 끝내기」와 같은 종료)', async () => {
      mockUnpin.mockResolvedValue({ deleted: true });
      const e = visiting(env(), 'p1');
      const { screen } = await open(EIGHT(), e);
      await press(screen, 'p1');
      await fireEvent.press(removeButton(screen));
      await act(async () => e.confirm.mock.calls[0][2]());
      expect(mockUnpin).toHaveBeenCalledTimes(1);
      expect(mockUnpin).toHaveBeenCalledWith(...deleteCall('p1'));
      expect(e.dispatch).toHaveBeenCalledTimes(1);
      expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
      expect(e.reset).toHaveBeenCalledTimes(1);
      expect(e.reset).toHaveBeenCalledWith('home');
      expect(mockUnpin.mock.invocationCallOrder[0]).toBeLessThan(
        e.dispatch.mock.invocationCallOrder[0],
      );
      expect(e.notify).toHaveBeenCalledWith('망원경에서 뺐어요');
      // 빼기 성공 알림이 목록을 한 번 다시 읽게 한다 — 곧 reset 이 화면을 내려 그 응답은 버려지고, 화면이 따로 더 읽지는 않는다(이중 조회 없음)
      expect(mockGet).toHaveBeenCalledTimes(2);
      expect(e.confirm).toHaveBeenCalledTimes(1);
    });

    test('빼기에 실패하면 구경을 끝내지 않는다 — 오류만 알린다', async () => {
      mockUnpin.mockRejectedValue(new ApiError('CLIENT_NETWORK_ERROR', 'x', 0));
      const e = visiting(env(), 'p1');
      const { screen } = await open(EIGHT(), e);
      await press(screen, 'p1');
      await fireEvent.press(removeButton(screen));
      await act(async () => e.confirm.mock.calls[0][2]());
      expect(e.notify).toHaveBeenCalledWith('연결을 확인한 뒤 다시 시도해 주세요.');
      expect(e.dispatch).not.toHaveBeenCalled();
      expect(e.reset).not.toHaveBeenCalled();
    });

    test('구경 중이어도 다른 섬을 빼는 데는 확인창이 없다', async () => {
      mockUnpin.mockResolvedValue({ deleted: true });
      const e = visiting(env(), 'r1');
      const { screen } = await open(EIGHT(), e);
      await press(screen, 'p1');
      expect(removeButton(screen).props.accessibilityHint).toBeUndefined();
      await fireEvent.press(removeButton(screen));
      expect(e.confirm).not.toHaveBeenCalled();
      expect(mockUnpin).toHaveBeenCalledWith(...deleteCall('p1'));
      await act(async () => {});
      expect(e.dispatch).not.toHaveBeenCalled();
    });

    test('방문 스냅샷만 남고 구경 중이 아니면 «항해 중»이 아니다', async () => {
      mockUnpin.mockResolvedValue({ deleted: true });
      const e = visiting(env(), 'p1', { entered: false });
      const { screen } = await open(EIGHT(), e);
      await press(screen, 'p1');
      await fireEvent.press(removeButton(screen));
      expect(e.confirm).not.toHaveBeenCalled();
      expect(mockUnpin).toHaveBeenCalledWith(...deleteCall('p1'));
      await act(async () => {});
      expect(e.dispatch).not.toHaveBeenCalled();
      expect(e.reset).not.toHaveBeenCalled();
    });
  });

  test('영어 — 리본·미리보기·빼기·확인창이 번역된다', async () => {
    applyLocalePref('en');
    const e = visiting(env(), 'p1');
    const { screen } = await open(EIGHT(), e);
    within(screen.getByTestId('telescope-ribbon-p1', { includeHiddenElements: true })).getByText(
      'Saved',
      { includeHiddenElements: true },
    );
    expect(screen.getByTestId('telescope-island-p1').props.accessibilityLabel).toBe(
      '섬 p1, saved from the magazine, sailing 30m',
    );
    await press(screen, 'p1');
    // 칸이 없는 자리표시에는 글이 없다
    expect(
      screen.queryByText('Magazine panel preview', { includeHiddenElements: true }),
    ).toBeNull();
    const button = screen.getByLabelText('Remove from telescope');
    expect(button.props.accessibilityHint).toBe(
      "You're sailing to this island, so you need to stop sailing to remove it",
    );
    await fireEvent.press(button);
    const [title, , , options] = e.confirm.mock.calls[0];
    expect(title).toBe('Stop sailing?');
    expect(options).toEqual({ ok: 'Stop and remove' });
  });
});
