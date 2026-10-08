// Screens.tsx 의 해당 분기는 번역하지 않은 죽은 코드 — 이 가로채기가 사라지면 한국어가 샌다(GROMO-2252).
// `CurrentScreensContent`(CurrentScreens.tsx)는 'arrival'·'travel'·'focusTravel'·'fishingArrival'·
// 'focusSetup'·'focus'·'rest'·'focusResult'·'returnTravel' 9개 라우트를 Screens.tsx 의
// `RedesignScreens`에 닿기 전에 `Travel`·`FocusFlow`로 먼저 가로챈다. 이 가로채기가 지워지면
// 번역되지 않은 `Screens.tsx` 분기가 다시 살아나 한국어 문자열이 영어 빌드에 섞여 나온다.
import React from 'react';
import { render } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { RedesignScreens } from '@/screens/island/Screens';
import { initialState, type Route, type State } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';

// 가로채기 고정 대상: RedesignScreens 를 호출 기록용 가짜로 바꾸되 나머지 export 는 실제 구현을 유지한다.
jest.mock('@/screens/island/Screens', () => {
  const actual = jest.requireActual('@/screens/island/Screens');
  const { View } = require('react-native');
  return {
    ...actual,
    RedesignScreens: jest.fn(() => <View testID="redesign-screens-mock" />),
  };
});

// 아래 훅·화면 모킹은 CurrentScreens.kicked.test.tsx·CurrentScreens.goldenFish.test.tsx 의 셋업을 그대로 재사용한다.
jest.mock('@/screens/focus/useIslandPresence', () => ({
  catColor: (color: string) => color,
  useIslandPresence: () => ({
    status: 'ready',
    error: null,
    focus: [],
    rest: [],
    emotes: [],
    clockOffset: 0,
    snapshotVersion: 0,
    snapshotTransitions: [],
    sendEmote: jest.fn(() => true),
    retry: jest.fn(),
  }),
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
jest.mock('@/screens/interiors/useBoardNotices', () => ({
  useBoardNotices: () => ({ loading: false, error: null, quests: [] }),
}));
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 390,
    height: 844,
    landscape: false,
    compact: false,
    tablet: false,
    modalWidth: 340,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const redesignScreensMock = RedesignScreens as unknown as jest.Mock;

// CurrentScreens.kicked.test.tsx 의 serverFocusState 를 그대로 재사용한다(새 대형 픽스처 금지).
const serverFocusState = (): State => {
  const state = initialState(true);
  state.focusSpot = { x: 34.1, y: 55.9 };
  state.session = {
    id: 's-me',
    islandId: 'soda',
    subject: '수학',
    startedAt: Date.now(),
    seconds: 0,
    status: 'active',
    version: 1,
    intervals: [],
  };
  state.serverIslands = {
    memberships: [],
    currentIslandId: 'soda',
    lossReason: null,
    candidates: [],
    nextCursor: null,
    visit: null,
    joinRequests: [],
    requestStatus: [],
  };
  return state;
};

const mount = async (route: Route, state: State = serverFocusState()) =>
  render(
    <CurrentScreens
      e={{
        state,
        route,
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
        islands: {},
      }}
    />,
  );

beforeEach(async () => {
  jest.clearAllMocks();
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

// Screens.tsx 의 route === 'arrival'/'travel'·'focusSetup'·'focus'·'rest'·'focusResult' 분기가 번역되지
// 않은 죽은 코드인 근거가 된 9개 라우트. CurrentScreensContent 가 Travel·FocusFlow 로 먼저 가로챈다.
const interceptedRoutes: Route[] = [
  'arrival',
  'travel',
  'focusTravel',
  'fishingArrival',
  'focusSetup',
  'focus',
  'focusResult',
  'returnTravel',
  'rest',
];

test.each(interceptedRoutes)(
  '라우트 %s 는 CurrentScreensContent 가 가로채 RedesignScreens(번역 안 된 Screens.tsx 분기)를 부르지 않는다',
  async (route) => {
    const screen = await mount(route);
    expect(redesignScreensMock).not.toHaveBeenCalled();
    await screen.unmount();
  },
);

// 대조군: 가로채기 목록에 없는 라우트는 그대로 RedesignScreens 로 떨어져야 한다 —
// 이 대조군이 깨지면 위 가로채기 테스트 자체가 아무것도 증명하지 못하는 셈이라 같이 둔다.
test('가로채기 목록에 없는 라우트 chooseIsland 는 RedesignScreens 를 부른다', async () => {
  const screen = await mount('chooseIsland');
  expect(redesignScreensMock).toHaveBeenCalledTimes(1);
  await screen.unmount();
});
