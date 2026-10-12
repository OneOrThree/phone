// 방문자 화면(GROMO-2259): 집중 중 인원 · 오늘 집중 시간 · 하단 가입 버튼 · 주민 쪽 방문자 응원 알림.
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { initialState, reducer, type State } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';
import { applyLocalePref } from '@/i18n';

let presenceOpts: any;
let mockStatus = 'ready';
let mockFocusMembers: { status: string }[] = [];

jest.mock('@/screens/focus/useIslandPresence', () => ({
  catColor: (color: string) => color,
  useIslandPresence: (opts: any) => {
    presenceOpts = opts;
    return {
      status: mockStatus,
      error: null,
      focus: mockFocusMembers,
      rest: [],
      emotes: [],
      clockOffset: 0,
      snapshotVersion: 0,
      snapshotTransitions: [],
      sendEmote: jest.fn(() => true),
      retry: jest.fn(),
    };
  },
}));
jest.mock('@/screens/island/useFriendsScreen', () => ({
  useFriendsScreen: () => ({ data: null }),
}));
jest.mock('@/screens/island/useBoardHomeIndicator', () => ({
  useBoardHomeIndicator: () => ({ hasNew: false }),
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

const visitState = (over: {
  focusToday?: { minutes: number };
  approval?: boolean;
  pending?: boolean;
  full?: boolean;
}) => {
  let state = reducer(initialState(true), {
    type: 'ISLAND_SYNC',
    memberships: { items: [], currentIslandId: null, nextCursor: null, lossReason: null },
  });
  state = reducer(state, {
    type: 'ISLAND_VISIT',
    visit: {
      island: {
        id: 'v1',
        name: '구경섬',
        intro: '',
        memberCount: over.full ? 15 : 3,
        maxMembers: 15,
        approvalRequired: !!over.approval,
        membershipStatus: 'none',
      },
      buildings: ['hall', 'board'],
      members: { items: [], nextCursor: null, version: 1 },
      joinRequestAvailability: 'available',
      joinRequest: over.pending ? { id: 'r1', islandId: 'v1', status: 'pending' } : null,
      focusToday: over.focusToday,
    },
  } as any);
  return reducer(state, { type: 'SERVER_VISITING', islandId: 'v1' } as any) as State;
};

const mount = async (state: State, route = 'visitIsland', extra: Record<string, unknown> = {}) => {
  const go = jest.fn();
  const notify = jest.fn();
  const islands = { join: jest.fn().mockResolvedValue({ status: 'pending' }), cancel: jest.fn() };
  const screen = await render(
    <CurrentScreens
      e={{
        state,
        route,
        detail: 'v1',
        now: Date.now(),
        dispatch: jest.fn(),
        go,
        replace: jest.fn(),
        reset: jest.fn(),
        home: jest.fn(),
        back: jest.fn(),
        backOverride: { current: null },
        notify,
        text: '',
        setText: jest.fn(),
        islands,
        ...extra,
      }}
    />,
  );
  return { screen, go, notify, islands };
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockStatus = 'ready';
  mockFocusMembers = [];
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});
afterEach(() => applyLocalePref('system'));

test('집중 중 2명이면 HUD 에 인원이 뜨고 누르면 낚시 구경으로 간다', async () => {
  mockFocusMembers = [{ status: 'active' }, { status: 'active' }, { status: 'paused' }];
  const { screen, go } = await mount(visitState({}));
  expect(presenceOpts).toMatchObject({ active: true, islandId: 'v1' });
  await fireEvent.press(screen.getByTestId('visit-focus-count'));
  expect(screen.getByText('지금 2명이 낚시섬에서 집중 중')).toBeTruthy();
  expect(go).toHaveBeenCalledWith('visitIslandFocus', 'v1');
});

test('방문 인원 알약은 스크린리더에 이동 안내를 준다', async () => {
  const { screen } = await mount(visitState({}));
  expect(screen.getByTestId('visit-focus-count').props.accessibilityHint).toBe(
    '터치하면 낚시섬 구경으로 가요',
  );
});

test('주민 목록을 아직 못 받았으면(loading) 인원 줄을 보이지 않는다', async () => {
  mockStatus = 'loading';
  const { screen } = await mount(visitState({}));
  expect(screen.queryByTestId('visit-focus-count')).toBeNull();
  expect(screen.queryByText('지금 낚시섬은 조용해요')).toBeNull();
});

test('집중 중인 사람이 없으면 조용하다고 알린다', async () => {
  const { screen } = await mount(visitState({}));
  expect(screen.getByText('지금 낚시섬은 조용해요')).toBeTruthy();
});

test('focusToday 83분이면 「오늘 집중 1시간 23분」을 보인다', async () => {
  const { screen } = await mount(visitState({ focusToday: { minutes: 83 } }));
  expect(screen.getByText('오늘 집중 1시간 23분')).toBeTruthy();
});

test.each([
  [0, '오늘 집중 0분'],
  [45, '오늘 집중 45분'],
])('focusToday %i분 → %s (0분도 숨기지 않고 1시간 미만은 분만 쓴다)', async (minutes, text) => {
  const { screen } = await mount(visitState({ focusToday: { minutes } }));
  expect(screen.getByText(text)).toBeTruthy();
});

test('focusToday 가 없으면 오늘 집중을 보이지 않는다', async () => {
  const { screen } = await mount(visitState({}));
  expect(screen.queryByText(/오늘 집중/)).toBeNull();
});

test.each([
  ['이 섬에 가입', {}],
  ['가입 신청', { approval: true }],
  ['신청 취소', { approval: true, pending: true }],
])('하단 가입 버튼 라벨: %s', async (label, over) => {
  const { screen } = await mount(visitState(over));
  expect(screen.getByText(label)).toBeTruthy();
});

test('하단 가입 버튼이 「원래 섬으로」를 대신하고 누르면 가입을 요청한다', async () => {
  const { screen, islands } = await mount(visitState({}));
  expect(screen.queryByText('원래 섬으로')).toBeNull();
  await fireEvent.press(screen.getByTestId('visit-join'));
  expect(islands.join).toHaveBeenCalledTimes(1);
  expect(islands.join).toHaveBeenCalledWith('v1', { showApproval: false });
});

test('정원이 찬 섬의 가입 버튼은 비활성이라 누를 수 없다', async () => {
  const { screen, islands } = await mount(visitState({ full: true }));
  const button = screen.getByTestId('visit-join');
  expect(button.props.accessibilityState.disabled).toBe(true);
  expect(screen.getByText('정원이 가득 찼어요')).toBeTruthy();
  await fireEvent.press(button);
  expect(islands.join).not.toHaveBeenCalled();
});

test('라우트 detail 이 어긋나도 가입은 구경 중인 방문 스냅샷의 섬을 본다', async () => {
  const { screen, islands } = await mount(visitState({ approval: true }), 'visitIsland', {
    detail: 'other',
  });
  expect(screen.getByText('가입 신청')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('visit-join'));
  expect(islands.join).toHaveBeenCalledWith('v1', { showApproval: false });
});

test('목업은 presence 를 열지 않고 인원 줄 없이 「원래 섬으로」를 유지한다', async () => {
  const state = reducer(initialState(true), { type: 'VISIT', id: 'cloud' });
  const { screen } = await mount(state, 'visitIsland', { islands: undefined });
  expect(presenceOpts.active).toBe(false);
  expect(screen.queryByTestId('visit-focus-count')).toBeNull();
  expect(screen.queryByTestId('visit-join')).toBeNull();
  expect(screen.getByText('원래 섬으로')).toBeTruthy();
});

test('영어에서는 방문 HUD·가입 버튼이 영어로 나온다', async () => {
  applyLocalePref('en');
  mockFocusMembers = [{ status: 'active' }, { status: 'active' }];
  const { screen } = await mount(visitState({ focusToday: { minutes: 83 } }));
  expect(screen.getByText('2 focusing on Fishing Island now')).toBeTruthy();
  expect(screen.getByText('Focus today 1h 23m')).toBeTruthy();
  expect(screen.getByText('Join This Island')).toBeTruthy();
});

test('주민 집중 화면은 방문자 응원을 알림으로 보인다', async () => {
  const state = visitState({});
  state.visitingIslandId = null;
  state.serverIslands!.currentIslandId = 'soda';
  state.session = {
    id: 's-me',
    islandId: 'soda',
    subject: '수학',
    startedAt: Date.now(),
    seconds: 0,
    status: 'active',
    version: 1,
    intervals: [],
  } as any;
  const { notify } = await mount(state, 'focus');
  presenceOpts.onVisitorEmote({ eventId: 'e1', userId: 'g', type: 'cheer', expiresAtMs: 1 });
  expect(notify).toHaveBeenCalledWith('방문자가 응원했어요 🎉');
  expect(notify).toHaveBeenCalledTimes(1);
});
