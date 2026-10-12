// 방문자 화면(GROMO-2259): 집중 중 인원 · 오늘 집중 시간 · 하단 가입 버튼 · 주민 쪽 방문자 응원 알림.
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { initialState, reducer, type State } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';

let presenceOpts: any;
let mockFocusMembers: { status: string }[] = [];

jest.mock('@/screens/focus/useIslandPresence', () => ({
  catColor: (color: string) => color,
  useIslandPresence: (opts: any) => {
    presenceOpts = opts;
    return {
      status: 'ready',
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
        memberCount: 3,
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

const mount = async (state: State, route = 'visitIsland') => {
  const go = jest.fn();
  const notify = jest.fn();
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
        islands: { join: jest.fn(), cancel: jest.fn() },
      }}
    />,
  );
  return { screen, go, notify };
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockFocusMembers = [];
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

test('집중 중 2명이면 HUD 에 인원이 뜨고 누르면 낚시 구경으로 간다', async () => {
  mockFocusMembers = [{ status: 'active' }, { status: 'active' }, { status: 'paused' }];
  const { screen, go } = await mount(visitState({}));
  expect(presenceOpts.islandId).toBe('v1');
  await fireEvent.press(screen.getByTestId('visit-focus-count'));
  expect(screen.getByText('지금 2명이 낚시섬에서 집중 중')).toBeTruthy();
  expect(go).toHaveBeenCalledWith('visitIslandFocus', 'v1');
});

test('집중 중인 사람이 없으면 조용하다고 알린다', async () => {
  const { screen } = await mount(visitState({}));
  expect(screen.getByText('지금 낚시섬은 조용해요')).toBeTruthy();
});

test('focusToday 83분이면 「오늘 집중 1시간 23분」을 보인다', async () => {
  const { screen } = await mount(visitState({ focusToday: { minutes: 83 } }));
  expect(screen.getByText('오늘 집중 1시간 23분')).toBeTruthy();
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
