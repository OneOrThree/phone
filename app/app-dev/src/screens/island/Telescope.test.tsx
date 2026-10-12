// 망원경 화면(GROMO-2266 · 2273) — 파노라마·말풍선·버튼 상태·가입·항해·돌아가기·카운트다운·핀 표시(찜 리본·잡지 칸 미리보기·빼기).
// API(getTelescope·arriveAtIsland)와 항해 연출(Sailing)은 목이다. 빼기는 실제 unpinFromTelescope 를 거치고 서버 요청(request)만 목이다 —
// 성공하면 실제처럼 onTelescopeChanged 구독자에게 알려, 화면이 따로 부르지 않아도 열린 목록이 구독으로 다시 읽는다(useTelescope 는 실제).
import React from 'react';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { Telescope } from '@/screens/island/Telescope';
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
jest.mock('@/screens/world/WorldViews', () => ({
  Sailing: ({ destination, from, onArrive }: any) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID="sailing" onPress={onArrive}>
        <Text testID="sailing-to">{destination}</Text>
        <Text testID="sailing-from">{from}</Text>
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
  await screen.findByTestId(`telescope-island-${items[0].islandId}`);
  return { screen, e };
}
const press = async (screen: any, id: string) =>
  fireEvent.press(screen.getByTestId(`telescope-island-${id}`));
const disabled = (screen: any, label: string) =>
  screen.getByLabelText(label).props.accessibilityState.disabled;

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

test('소속 섬 접근성 라벨은 소속임을 말하고, 깃발 장식은 스크린리더에서 숨는다', async () => {
  const { screen } = await open(EIGHT());
  expect(screen.getByTestId('telescope-island-j1').props.accessibilityLabel).toBe(
    '섬 j1, 내가 사는 섬',
  );
  expect(screen.getByTestId('telescope-island-r1').props.accessibilityLabel).toBe('섬 r1');
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

describe('항해하기', () => {
  test('비주민 — 도착을 기록하고 연출 뒤 구경(SERVER_VISITING·visitIsland)으로 들어간다', async () => {
    mockArrive.mockResolvedValue({ membershipStatus: 'none', currentIslandId: 'j1' });
    const { screen, e } = await open([item('r1')]);
    await press(screen, 'r1');
    await fireEvent.press(screen.getByLabelText('항해하기'));
    expect(mockArrive).toHaveBeenCalledWith('r1', expect.stringMatching(UUID_V4));
    expect(e.islands!.visit).toHaveBeenCalledWith('r1');
    // 출발지는 지금 섬, 목적지는 그 섬 — 연출이 끝나기 전엔 화면을 옮기지 않는다
    expect((await screen.findByTestId('sailing-to')).props.children).toBe('섬 r1');
    expect(screen.getByTestId('sailing-from').props.children).toBe('섬 j1');
    expect(e.dispatch).not.toHaveBeenCalled();
    expect(e.replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('sailing'));
    expect(e.dispatch).toHaveBeenCalledWith({ type: 'SERVER_VISITING', islandId: 'r1' });
    expect(e.replace).toHaveBeenCalledWith('visitIsland', 'r1');
    expect(e.reset).not.toHaveBeenCalled();
    expect(e.islands!.sync).not.toHaveBeenCalled();
  });

  test('정원이 찬 섬도 항해(구경)는 된다', async () => {
    mockArrive.mockResolvedValue({ membershipStatus: 'none', currentIslandId: 'j1' });
    const { screen, e } = await open([item('r1', { full: true })]);
    await press(screen, 'r1');
    await fireEvent.press(screen.getByLabelText('항해하기'));
    await screen.findByTestId('sailing');
    await fireEvent.press(screen.getByTestId('sailing'));
    expect(e.replace).toHaveBeenCalledWith('visitIsland', 'r1');
  });

  test('망원경으로 가입한 섬의 첫 도착(active)은 소속을 다시 읽고 새 섬 홈으로 간다', async () => {
    mockArrive.mockResolvedValue({ membershipStatus: 'active', currentIslandId: 'j3' });
    const { screen, e } = await open([mine('j3')]);
    await press(screen, 'j3');
    await fireEvent.press(screen.getByLabelText('항해하기'));
    await screen.findByTestId('sailing');
    expect(e.islands!.sync).toHaveBeenCalledTimes(1);
    expect(e.islands!.visit).not.toHaveBeenCalled();
    expect(e.reset).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('sailing'));
    expect(e.reset).toHaveBeenCalledWith('home');
    expect(e.replace).not.toHaveBeenCalled();
  });

  test('도착 기록이 거절되면 연출 없이 서버 문구를 알리고 말풍선이 닫힌 채 파노라마로 남는다', async () => {
    mockArrive.mockRejectedValue(new ApiError('NOT_FOUND', '없어요', 404));
    const { screen, e } = await open([item('r1')]);
    await press(screen, 'r1');
    await fireEvent.press(screen.getByLabelText('항해하기'));
    await act(async () => {});
    expect(e.notify).toHaveBeenCalledWith('더 이상 볼 수 없는 내용이에요. 다시 불러와 주세요.');
    expect(screen.queryByTestId('sailing')).toBeNull();
    expect(e.islands!.visit).not.toHaveBeenCalled();
    // 확정된 4xx 는 서버가 바꾼 게 없다 — 소속을 다시 읽지 않는다(switchCurrent 와 같은 규칙)
    expect(e.islands!.sync).not.toHaveBeenCalled();
    screen.getByTestId('telescope-island-r1');
  });

  test('집중·휴식 중에는 구경할 수 없다고 알리고 도착을 기록하지 않는다', async () => {
    const { screen, e } = await open([item('r1')], env({ session: true }));
    await press(screen, 'r1');
    await fireEvent.press(screen.getByLabelText('항해하기'));
    expect(e.notify).toHaveBeenCalledWith('집중이나 휴식을 마친 뒤 섬을 구경해 주세요.');
    expect(mockArrive).not.toHaveBeenCalled();
  });

  test('항해 중 뒤로가기는 삼킨다', async () => {
    mockArrive.mockResolvedValue({ membershipStatus: 'none', currentIslandId: 'j1' });
    const { screen, e } = await open([item('r1')]);
    await press(screen, 'r1');
    await fireEvent.press(screen.getByLabelText('항해하기'));
    await screen.findByTestId('sailing');
    expect(e.backOverride.current?.()).toBe(true);
  });

  test('요청 중에는 섬이 눌리지 않아 말풍선이 열리지 않고 뒤로가기는 계속 삼킨다', async () => {
    let arrived!: (v: unknown) => void;
    mockArrive.mockReturnValue(new Promise((r) => (arrived = r)));
    const { screen, e } = await open([item('r1'), item('r2')]);
    await press(screen, 'r1');
    await fireEvent.press(screen.getByLabelText('항해하기'));
    // 요청 중 — 말풍선은 닫혔고 뒤로가기는 삼킨다
    expect(screen.queryByTestId('telescope-bubble-name')).toBeNull();
    expect(e.backOverride.current?.()).toBe(true);
    // 다른 섬을 눌러도 말풍선이 열리지 않고 삼킴이 그대로다(열었다 닫으면 삼킴이 지워지던 결함)
    expect(screen.getByTestId('telescope-island-r2').props.accessibilityState.disabled).toBe(true);
    await press(screen, 'r2');
    expect(screen.queryByTestId('telescope-bubble-name')).toBeNull();
    expect(e.backOverride.current?.()).toBe(true);
    // 요청이 끝나 연출로 넘어가도 계속 삼키고, 화면이 떠나면 풀린다
    await act(async () => arrived({ membershipStatus: 'none', currentIslandId: 'j1' }));
    await screen.findByTestId('sailing');
    expect(e.backOverride.current?.()).toBe(true);
    await screen.unmount();
    expect(e.backOverride.current).toBeNull();
  });

  test('말풍선을 연 채 항해를 시작해도 뒤로가기는 요청이 끝날 때까지 삼키고, 실패로 끝나면 풀린다', async () => {
    let fail!: (error: Error) => void;
    mockArrive.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const { screen, e } = await open([item('r1')]);
    await press(screen, 'r1');
    expect(e.backOverride.current).not.toBeNull(); // 말풍선의 뒤로가기(닫기)
    await fireEvent.press(screen.getByLabelText('항해하기'));
    expect(screen.queryByTestId('telescope-bubble-name')).toBeNull();
    expect(e.backOverride.current?.()).toBe(true); // 이제는 요청을 삼키는 처리다
    expect(screen.queryByTestId('telescope-bubble-name')).toBeNull();
    await act(async () => fail(new ApiError('NOT_FOUND', '없어요', 404)));
    expect(e.backOverride.current).toBeNull();
  });

  describe('도착 기록의 Idempotency-Key(switchCurrent 와 같은 의도 키 풀)', () => {
    const keyOf = (n: number) => mockArrive.mock.calls[n][1];
    const sail = async (screen: any, id: string) => {
      await press(screen, id);
      await fireEvent.press(screen.getByLabelText('항해하기'));
      await act(async () => {});
    };

    test('같은 섬으로 실패 뒤 다시 시도하면 같은 키, 다른 섬은 다른 키로 나간다', async () => {
      mockArrive.mockRejectedValue(new ApiError('NOT_FOUND', '없어요', 404));
      const { screen } = await open([item('r1'), item('r2')]);
      await sail(screen, 'r1');
      await sail(screen, 'r1');
      await sail(screen, 'r2');
      expect(mockArrive).toHaveBeenCalledTimes(3);
      expect(keyOf(0)).toMatch(UUID_V4);
      expect(keyOf(1)).toBe(keyOf(0));
      expect(keyOf(2)).toMatch(UUID_V4);
      expect(keyOf(2)).not.toBe(keyOf(0));
    });

    test('응답을 잃고 서버도 안 옮겼으면(결과 불명) 다시 시도해도 같은 키다', async () => {
      mockArrive.mockRejectedValue(new ApiError('CLIENT_TIMEOUT', '유실', 0));
      const e = env();
      e.islands!.sync.mockResolvedValue({ currentIslandId: 'j1', items: [] });
      const { screen } = await open([item('r1')], e);
      await sail(screen, 'r1');
      await sail(screen, 'r1');
      expect(mockArrive).toHaveBeenCalledTimes(2);
      expect(keyOf(1)).toBe(keyOf(0));
    });

    test('도착이 확정되면 키를 해제한다 — 뒤 단계(구경 진입)가 실패한 뒤 다시 시도하면 새 키다', async () => {
      mockArrive.mockResolvedValue({ membershipStatus: 'none', currentIslandId: 'j1' });
      const e = env();
      e.islands!.visit.mockRejectedValueOnce(
        new ApiError('NOT_FOUND', '없어요', 404),
      ).mockResolvedValue(undefined);
      const { screen } = await open([item('r1')], e);
      await sail(screen, 'r1');
      expect(screen.queryByTestId('sailing')).toBeNull();
      await sail(screen, 'r1');
      expect(mockArrive).toHaveBeenCalledTimes(2);
      expect(keyOf(0)).toMatch(UUID_V4);
      expect(keyOf(1)).toMatch(UUID_V4);
      expect(keyOf(1)).not.toBe(keyOf(0));
      await screen.findByTestId('sailing');
    });
  });

  describe('도착 응답을 잃었을 때(결과 불명 — switchCurrent 와 같은 분류)', () => {
    test.each([
      'CLIENT_TIMEOUT',
      'CLIENT_NETWORK_ERROR',
      'UPSTREAM_TIMEOUT',
      'SERVICE_UNAVAILABLE',
    ])('%s — 서버가 이미 그 섬으로 옮겼으면 소속을 다시 읽어 성공으로 홈에 간다', async (code) => {
      mockArrive.mockRejectedValue(new ApiError(code, '유실', 0));
      const e = env();
      e.islands!.sync.mockImplementation(async () => ({ currentIslandId: 'j3', items: [] }));
      const { screen } = await open([mine('j3')], e);
      await press(screen, 'j3');
      await fireEvent.press(screen.getByLabelText('항해하기'));
      await screen.findByTestId('sailing');
      expect(e.islands!.sync).toHaveBeenCalledTimes(1);
      expect(e.notify).not.toHaveBeenCalled();
      expect(e.islands!.visit).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('sailing'));
      expect(e.reset).toHaveBeenCalledWith('home');
    });

    test('서버가 옮기지 않았으면 소속을 다시 읽고 원래 오류를 알린다(연출·구경 진입 없음)', async () => {
      mockArrive.mockRejectedValue(new ApiError('CLIENT_TIMEOUT', '유실', 0));
      const e = env();
      e.islands!.sync.mockResolvedValue({ currentIslandId: 'j1', items: [] });
      const { screen } = await open([item('r1')], e);
      await press(screen, 'r1');
      await fireEvent.press(screen.getByLabelText('항해하기'));
      await act(async () => {});
      expect(e.islands!.sync).toHaveBeenCalledTimes(1);
      expect(e.notify).toHaveBeenCalledWith('연결을 확인한 뒤 다시 시도해 주세요.');
      expect(screen.queryByTestId('sailing')).toBeNull();
      expect(e.islands!.visit).not.toHaveBeenCalled();
    });

    test('소속 재조회마저 실패하면 원래 오류를 알린다', async () => {
      mockArrive.mockRejectedValue(new ApiError('CLIENT_NETWORK_ERROR', '유실', 0));
      const e = env();
      e.islands!.sync.mockRejectedValue(new ApiError('CLIENT_NETWORK_ERROR', '또 유실', 0));
      const { screen } = await open([mine('j3')], e);
      await press(screen, 'j3');
      await fireEvent.press(screen.getByLabelText('항해하기'));
      await act(async () => {});
      expect(e.islands!.sync).toHaveBeenCalledTimes(1);
      expect(e.notify).toHaveBeenCalledWith('연결을 확인한 뒤 다시 시도해 주세요.');
      expect(screen.queryByTestId('sailing')).toBeNull();
    });

    test('도착은 성공했는데 소속 재조회 응답을 잃어도 한 번 더 읽어 성공으로 확정한다', async () => {
      mockArrive.mockResolvedValue({ membershipStatus: 'active', currentIslandId: 'j3' });
      const e = env();
      e.islands!.sync.mockRejectedValueOnce(
        new ApiError('CLIENT_TIMEOUT', '유실', 0),
      ).mockResolvedValueOnce({ currentIslandId: 'j3', items: [] });
      const { screen } = await open([mine('j3')], e);
      await press(screen, 'j3');
      await fireEvent.press(screen.getByLabelText('항해하기'));
      await screen.findByTestId('sailing');
      expect(e.islands!.sync).toHaveBeenCalledTimes(2);
      expect(e.notify).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('sailing'));
      expect(e.reset).toHaveBeenCalledWith('home');
    });
  });
});

describe('돌아가기', () => {
  test('가 본 소속 섬은 switchCurrent → 짧은 항해 연출 → 홈 reset(방문 상태가 아니면 END_VISIT 없음)', async () => {
    const { screen, e } = await open([mine('j2', { arrivedBefore: true })]);
    await press(screen, 'j2');
    await fireEvent.press(screen.getByLabelText('돌아가기'));
    expect(e.islands!.switchCurrent).toHaveBeenCalledWith('j2');
    expect((await screen.findByTestId('sailing-to')).props.children).toBe('섬 j2');
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

  test('연출의 출발지는 누른 시점의 섬이다 — 이동 응답이 현재 섬을 바꿔도 목적지로 바뀌지 않는다', async () => {
    const e = env();
    e.islands!.switchCurrent.mockImplementation(async () => {
      e.state = reducer(e.state, {
        type: 'ISLAND_SYNC',
        memberships: {
          items: [isl('j1', '섬 j1'), isl('j2', '섬 j2'), isl('j3', '섬 j3')],
          currentIslandId: 'j2',
          nextCursor: null,
          lossReason: null,
        },
      });
    });
    const { screen } = await open([mine('j2', { arrivedBefore: true })], e);
    await press(screen, 'j2');
    await fireEvent.press(screen.getByLabelText('돌아가기'));
    expect((await screen.findByTestId('sailing-from')).props.children).toBe('섬 j1');
  });
});

describe('카운트다운', () => {
  test('「새 섬까지 N분」이 1분마다 줄고 0 이 되면 목록을 다시 읽는다', async () => {
    jest.useFakeTimers();
    mockGet
      .mockResolvedValueOnce(wire([item('r1')], 2))
      .mockResolvedValueOnce(wire([item('r2')], 60));
    const screen = await render(<Telescope e={env()} />);
    await screen.findByText('새 섬까지 2분');
    expect(mockGet).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    screen.getByText('새 섬까지 1분');
    expect(mockGet).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    // 0분에 다시 읽고, 새 목록의 남은 시간으로 다시 시작한다
    expect(mockGet).toHaveBeenCalledTimes(2);
    await screen.findByText('새 섬까지 60분');
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
    await screen.findByText('새 섬까지 1분');
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
    await screen.findByText('새 섬까지 30분');
    // 10분 건너뛰고 첫 틱(1분) — 11분이 흐른 셈이다
    jest.setSystemTime(Date.now() + 10 * 60_000);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    screen.getByText('새 섬까지 19분');
    expect(mockGet).toHaveBeenCalledTimes(1);
    // 한 시간이 지난 뒤 돌아오면 다음 틱에 곧바로 다시 읽는다
    jest.setSystemTime(Date.now() + 60 * 60_000);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(mockGet).toHaveBeenCalledTimes(2);
    await screen.findByText('새 섬까지 45분');
    screen.getByTestId('telescope-island-r2');
  });

  test('서버가 0 이하를 줘도 최소 1분으로 시작해 다시 읽기 고리에 갇히지 않는다', async () => {
    mockGet.mockImplementation(async () => wire([item('r1')], 0));
    const screen = await render(<Telescope e={env()} />);
    await screen.findByText('새 섬까지 1분');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

describe('로딩·빈 목록·오류', () => {
  test('불러오는 동안 로딩 안내, 빈 목록은 안내 문구(카운트다운은 그대로)', async () => {
    let resolve!: (v: unknown) => void;
    mockGet.mockReturnValue(new Promise((r) => (resolve = r)));
    const screen = await render(<Telescope e={env()} />);
    screen.getByText('섬을 찾고 있어요');
    expect(screen.queryByText(/새 섬까지/)).toBeNull();
    await act(async () => resolve(wire([], 12)));
    screen.getByText('지금은 보이는 섬이 없어요');
    screen.getByText('새 섬까지 12분');
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
  await screen.findByText('New islands in 37 min');
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
    [componentTokens.telescope.largeTextThreshold - 0.01, false],
    [componentTokens.telescope.largeTextThreshold, true],
    [3, true],
  ])('글자 배율 %s — 뒤로·다시 시도 작은 버튼의 높이 가변은 %s', async (scale, grows) => {
    mockFontScale = scale;
    mockGet.mockRejectedValueOnce(networkError());
    const screen = await render(<Telescope e={env()} />);
    await screen.findByText('네트워크에 연결할 수 없어요.');
    for (const label of ['뒤로', '다시 시도']) {
      const button = screen.getByLabelText(label);
      // 보통 글자에서는 작은 버튼의 38pt 모양을 그대로 둔다(터치 영역은 부모 44pt)
      if (grows) dynamic(button);
      else expect(flat(button).height).toBe(38);
    }
  });

  test.each([
    [1, 1],
    [3, 2],
  ])(
    '섬 이름 알약은 공용 Badge soft 이고 글자 배율 %s 에서 %s줄까지 보인다',
    async (scale, lines) => {
      mockFontScale = scale;
      const name = '아주아주아주 긴 이름을 가진 섬이에요 정말로';
      const { screen } = await open([item('r1', { name })]);
      const text = screen.getByText(name);
      expect(text.props.numberOfLines).toBe(lines);
      // 공용 Badge soft 의 토큰 모양에, 섬 칸 안 가운데 · 칸 폭을 넘지 않는 배치만 얹는다
      const pill = flat(text.parent);
      expect(pill.backgroundColor).toBe(componentTokens.badge.soft.background);
      expect(pill.borderColor).toBe(componentTokens.badge.soft.border);
      expect(pill.alignSelf).toBe('center');
      expect(pill.maxWidth).toBe(flat(screen.getByTestId('telescope-island-r1')).width);
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
      '섬 p1, 잡지에서 찜한 섬',
    );
    for (const id of ['p2', 'n1', 'r1', 'r2'])
      expect(screen.getByTestId(`telescope-island-${id}`).props.accessibilityLabel).toBe(
        `섬 ${id}`,
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
    const cards = screen.getAllByTestId('telescope-magazine-preview');
    expect(cards).toHaveLength(1);
    // 그림과 라벨이 한 덩어리로 읽힌다
    expect(cards[0].props.accessible).toBe(true);
    expect(cards[0].props.accessibilityLabel).toBe('섬 p1, 잡지 칸 미리보기');
    within(cards[0]).getByText('잡지 칸 미리보기');
    await fireEvent.press(screen.getByLabelText('닫기'));
    for (const id of ['p2', 'n1', 'r1', 'j1']) {
      await press(screen, id);
      screen.getByTestId('telescope-bubble-name');
      expect(screen.queryByTestId('telescope-magazine-preview')).toBeNull();
      await fireEvent.press(screen.getByLabelText('닫기'));
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
      '섬 p1, saved from the magazine',
    );
    await press(screen, 'p1');
    screen.getByText('Magazine panel preview');
    expect(screen.getByTestId('telescope-magazine-preview').props.accessibilityLabel).toBe(
      '섬 p1, magazine panel preview',
    );
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
