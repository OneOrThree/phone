// 낚시 구경 화면(GROMO-2259)의 방문자 이모트 버튼 — 받을 주민이 없으면 비활성, 주민이면 숨김.
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { initialState, reducer, type State } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';

let presenceOpts: any;
let mockStatus = 'ready';
let mockFocusMembers: object[] = [];
const mockSendEmote = jest.fn(() => true);

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
      sendEmote: mockSendEmote,
      retry: jest.fn(),
    };
  },
}));

jest.mock('@/screens/focus/useFishingPeerActors', () => ({
  fishingSpotsForActors: (actors: any[]) => actors.map((actor) => actor.spot),
  useFishingPeerActors: ({ members }: { members: any[] }) => ({
    actors: members.map((member, index) => ({
      ...member,
      key: `${member.userId}:${member.sessionId}`,
      spot: { x: 40 + index, y: 50 + index, face: 1 },
      position: { x: 40 + index, y: 50 + index },
      phase: 'fishing',
      visible: true,
      generation: 1,
    })),
    onTransition: jest.fn(),
    entered: jest.fn(),
    cast: jest.fn(),
    leftForPause: jest.fn(),
    stretched: jest.fn(),
    leftForComplete: jest.fn(),
  }),
}));

jest.mock('@/screens/focus/FishingIsland', () => {
  const actual = jest.requireActual('@/screens/focus/FishingIsland');
  const { View } = require('react-native');
  return {
    ...actual,
    FishingIsland: ({ children }: any) => (
      <View testID="focus-world">{children(640, 640 / 1.5, 1)}</View>
    ),
    FishingActor: () => <View />,
    FishingPeerActorView: () => <View />,
    FishingWalker: () => <View />,
  };
});

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

const resident = {
  userId: 'u1',
  name: '주민',
  catColor: 'gray',
  appearance: null,
  sessionId: 's1',
  subject: '수학',
  activeSeconds: 60,
  status: 'paused',
  anchorMs: 0,
};

const visitState = (membershipStatus: string): State => {
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
        approvalRequired: false,
        membershipStatus,
      },
      buildings: ['hall', 'board'],
      members: { items: [], nextCursor: null, version: 1 },
      joinRequestAvailability: 'available',
      joinRequest: null,
    },
  } as any);
  return reducer(state, { type: 'SERVER_VISITING', islandId: 'v1' } as any) as State;
};

const mount = async (state: State) => {
  const notify = jest.fn();
  // 같은 element 를 다시 넘기면 React 가 다시 그리지 않는다 — 재렌더가 필요하면 새로 만든다
  const element = () => (
    <CurrentScreens
      e={{
        state,
        route: 'visitIslandFocus',
        detail: 'v1',
        now: Date.now(),
        dispatch: jest.fn(),
        go: jest.fn(),
        replace: jest.fn(),
        reset: jest.fn(),
        home: jest.fn(),
        back: jest.fn(),
        backOverride: { current: null },
        notify,
        text: '',
        setText: jest.fn(),
        islands: {},
      }}
    />
  );
  const screen = await render(element());
  return { screen, notify, element };
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockStatus = 'ready';
  mockFocusMembers = [];
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

test('받을 주민이 0명이면 이모트 버튼은 비활성이고 누르면 요청 없이 안내만 한다', async () => {
  const { screen, notify } = await mount(visitState('none'));
  const fab = screen.getByTestId('emote-fab');
  expect(fab.props.accessibilityState.disabled).toBe(true);
  expect(StyleSheet.flatten(fab.props.style)).toMatchObject({ opacity: 0.45, boxShadow: 'none' });
  // 비활성인 이유를 스크린리더가 읽는다
  expect(fab.props.accessibilityHint).toBe('지금 집중 중인 주민이 없어요.');
  await fireEvent.press(fab);
  expect(notify).toHaveBeenCalledWith('지금 집중 중인 주민이 없어요.');
  expect(mockSendEmote).not.toHaveBeenCalled();
  expect(screen.queryByTestId('emote-cheer')).toBeNull();
});

test('집중·일시정지 주민이 있으면 이모트를 보낸다', async () => {
  mockFocusMembers = [resident];
  const { screen, notify } = await mount(visitState('none'));
  const fab = screen.getByTestId('emote-fab');
  expect(fab.props.accessibilityState.disabled).toBe(false);
  expect(fab.props.accessibilityHint).toBeUndefined();
  await fireEvent.press(fab);
  await fireEvent.press(screen.getByTestId('emote-cheer'));
  expect(mockSendEmote).toHaveBeenCalledTimes(1);
  expect(mockSendEmote).toHaveBeenCalledWith('cheer');
  expect(notify).not.toHaveBeenCalled();
});

test('펼쳐 둔 채 주민이 모두 떠나 비활성이 되면 접히고, 다시 생겨도 저절로 펼쳐지지 않는다', async () => {
  mockFocusMembers = [resident];
  const { screen, element } = await mount(visitState('none'));
  await fireEvent.press(screen.getByTestId('emote-fab'));
  expect(screen.getByTestId('emote-cheer')).toBeTruthy();

  mockFocusMembers = [];
  await screen.rerender(element());
  expect(screen.getByTestId('emote-fab').props.accessibilityState.disabled).toBe(true);
  expect(screen.queryByTestId('emote-cheer')).toBeNull();

  mockFocusMembers = [resident];
  await screen.rerender(element());
  const fab = screen.getByTestId('emote-fab');
  expect(fab.props.accessibilityState).toMatchObject({ disabled: false, expanded: false });
  expect(screen.queryByTestId('emote-cheer')).toBeNull();
  // 누르면 그때 펼쳐진다
  await fireEvent.press(fab);
  expect(screen.getByTestId('emote-cheer')).toBeTruthy();
});

test('주민 목록을 아직 못 받았으면(loading) 막지 않는다', async () => {
  mockStatus = 'loading';
  const { screen } = await mount(visitState('none'));
  expect(screen.getByTestId('emote-fab').props.accessibilityState.disabled).toBe(false);
});

test('비주민은 방문자 모드로 연다', async () => {
  const { screen } = await mount(visitState('none'));
  expect(presenceOpts.visitor).toBe(true);
  expect(screen.getByTestId('emote-fab')).toBeTruthy();
});

test('내 다른 소속 섬(주민)을 구경하면 방문자 모드를 끄고 이모트 버튼을 숨긴다', async () => {
  const { screen } = await mount(visitState('active'));
  expect(presenceOpts.visitor).toBe(false);
  expect(screen.queryByTestId('emote-fab')).toBeNull();
});
