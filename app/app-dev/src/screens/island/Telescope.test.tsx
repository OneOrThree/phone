// 망원경 화면(GROMO-2266) — 파노라마·말풍선·버튼 상태·가입·항해·돌아가기·카운트다운.
// API(getTelescope·arriveAtIsland)와 항해 연출(Sailing)은 목이다.
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Telescope } from '@/screens/island/Telescope';
import { applyLocalePref } from '@/i18n';
import { ApiError } from '@/services/api/client';
import { arriveAtIsland, getTelescope, type TelescopeItem } from '@/services/api/telescope';
import { initialState, reducer } from '@/services/model';

jest.mock('@/services/api/telescope', () => ({
  getTelescope: jest.fn(),
  arriveAtIsland: jest.fn(),
}));
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
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const mockGet = getTelescope as jest.Mock;
const mockArrive = arriveAtIsland as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // 쓰이지 않고 남은 mockResolvedValueOnce 가 다음 테스트로 새지 않게 구현까지 비운다
  mockGet.mockReset();
  mockArrive.mockReset();
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
});

describe('항해하기', () => {
  test('비주민 — 도착을 기록하고 연출 뒤 구경(SERVER_VISITING·visitIsland)으로 들어간다', async () => {
    mockArrive.mockResolvedValue({ membershipStatus: 'none', currentIslandId: 'j1' });
    const { screen, e } = await open([item('r1')]);
    await press(screen, 'r1');
    await fireEvent.press(screen.getByLabelText('항해하기'));
    expect(mockArrive).toHaveBeenCalledWith('r1');
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
