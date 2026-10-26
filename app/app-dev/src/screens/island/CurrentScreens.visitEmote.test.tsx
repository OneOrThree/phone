// 낚시 구경 화면(GROMO-2259) — 방문자는 응원을 보내지도 받지도 않는다(2026-10-16 결정): FAB 없음, visitor 미전달.
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { initialState, reducer, type State } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';

let presenceOpts: any;
let mockFocusMembers: object[] = [];
let mockLooks: Record<string, object> = {};
const mockSendEmote = jest.fn(() => true);
const mockResync = jest.fn();

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
      sendEmote: mockSendEmote,
      retry: jest.fn(),
      resync: mockResync,
      looks: mockLooks,
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
    FishingPeerActorView: ({ actor, outfit, onPress }: any) => (
      <View
        testID={`peer-${actor.userId}`}
        testPropOutfit={outfit}
        accessibilityRole="button"
        onTouchEnd={onPress}
      />
    ),
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
  mockFocusMembers = [];
  mockLooks = {};
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

const expectNoEmote = (screen: any) => {
  expect(screen.queryByTestId('emote-fab')).toBeNull();
  expect(presenceOpts.visitor).toBeFalsy();
  expect(presenceOpts.emoteSessionId).toBeFalsy();
  expect(mockSendEmote).not.toHaveBeenCalled();
};

test('비주민 방문자의 낚시 구경 화면에는 응원 버튼이 없고 방문자 모드로 열지 않는다', async () => {
  const { screen } = await mount(visitState('none'));
  expectNoEmote(screen);
});

test('내 다른 소속 섬(주민)을 구경해도 같다', async () => {
  const { screen } = await mount(visitState('active'));
  expectNoEmote(screen);
});

test('집중 중인 주민이 있어도 방문자 화면에는 응원 버튼이 없다', async () => {
  mockFocusMembers = [
    {
      userId: 'u1',
      name: '주민',
      catColor: 'gray',
      appearance: null,
      sessionId: 's1',
      subject: '수학',
      activeSeconds: 60,
      status: 'active',
      anchorMs: 0,
    },
  ];
  const { screen } = await mount(visitState('none'));
  expectNoEmote(screen);
});

test('낚시 구경 주민은 focus-members 의 appearance 로, 실시간 외양이 더 새로우면 그것으로 입는다 (GROMO-2390)', async () => {
  mockFocusMembers = [
    {
      userId: 'u1',
      name: '주민',
      catColor: 'black',
      appearance: { head: 'hat-old', neck: 'scarf', version: 2 },
      sessionId: 's1',
      subject: '수학',
      activeSeconds: 60,
      status: 'active',
      anchorMs: 0,
    },
  ];
  const { screen, element } = await mount(visitState('none'));
  expect(screen.getByTestId('peer-u1').props.testPropOutfit).toMatchObject({
    head: 'hat-old',
    neck: 'scarf',
  });
  mockLooks = { u1: { head: 'hat-new', neck: null, shoes: null, version: 3 } };
  await screen.rerender(element());
  expect(screen.getByTestId('peer-u1').props.testPropOutfit).toMatchObject({
    head: 'hat-new',
    neck: null,
  });
});

test('다른 섬 방문 구경은 events 를 못 구독하므로 30초마다 스냅숏을 다시 읽고, 내 섬 구경은 읽지 않는다 (GROMO-2390)', async () => {
  jest.useFakeTimers();
  try {
    const visit = await mount(visitState('none'));
    expect(presenceOpts.events).toBe(false);
    await act(async () => jest.advanceTimersByTime(61_000));
    expect(mockResync).toHaveBeenCalledTimes(2);
    await visit.screen.unmount();
  } finally {
    jest.useRealTimers();
  }
});

// ‹ 는 목적지를 읽는다(DESIGN §7.14) — 내 낚시섬은 홈, 구경은 그 섬 지도로 가니 둘 다 「섬으로 돌아가기」다
const focusVisitEnv = (state: State, route: string, detail: string, islands?: object) => ({
  state,
  route,
  detail,
  now: Date.now(),
  dispatch: jest.fn(),
  go: jest.fn(),
  replace: jest.fn(),
  reset: jest.fn(),
  home: jest.fn(),
  back: jest.fn(),
  backOverride: { current: null },
  notify: jest.fn(),
  text: '',
  setText: jest.fn(),
  ...(islands && { islands }),
});

test('내 낚시섬 구경(방문 아님)의 ‹ 는 「섬으로 돌아가기」로 읽히고 누르면 홈으로 간다', async () => {
  const e = focusVisitEnv(initialState(true), 'focusVisit', '');
  const screen = await render(<CurrentScreens e={e} />);
  expect(screen.queryByLabelText('닫기')).toBeNull();
  await fireEvent.press(screen.getByLabelText('섬으로 돌아가기'));
  expect(e.home).toHaveBeenCalledTimes(1);
  expect(e.back).not.toHaveBeenCalled();
});

test('다른 섬 낚시 구경의 ‹ 도 「섬으로 돌아가기」이고 누르면 그 섬 지도로 간다', async () => {
  const e = focusVisitEnv(visitState('none'), 'visitIslandFocus', 'v1', {});
  const screen = await render(<CurrentScreens e={e} />);
  expect(screen.queryByLabelText('돌아가기')).toBeNull();
  await fireEvent.press(screen.getByLabelText('섬으로 돌아가기'));
  expect(e.replace).toHaveBeenCalledWith('visitIsland', 'v1');
  expect(e.home).not.toHaveBeenCalled();
});

test('낚시 구경에서 주민을 누르면 그 주민 정보창(이름·친구 요청)이 뜨고 × 로 닫힌다(GROMO-2474)', async () => {
  mockFocusMembers = [
    {
      userId: 'u1',
      name: '두부',
      catColor: 'gray',
      appearance: null,
      sessionId: 's1',
      subject: '수학',
      activeSeconds: 60,
      status: 'active',
      anchorMs: 0,
    },
  ];
  const { screen } = await mount(visitState('none'));
  expect(screen.queryByTestId('cat-info-name')).toBeNull();
  await fireEvent(screen.getByTestId('peer-u1'), 'touchEnd');
  expect(screen.getByTestId('cat-info-name')).toHaveTextContent('두부');
  expect(screen.getByLabelText('친구 요청')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('닫기'));
  expect(screen.queryByTestId('cat-info-name')).toBeNull();
});
