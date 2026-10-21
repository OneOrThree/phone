// Screens.tsx 의 해당 분기는 번역하지 않은 죽은 코드 — 이 가로채기가 사라지면 한국어가 샌다(GROMO-2252).
// `CurrentScreensContent`(CurrentScreens.tsx)는 'arrival'·'travel'·'focusTravel'·'fishingArrival'·
// 'focusSetup'·'focus'·'rest'·'focusResult'·'returnTravel' 9개 라우트를 Screens.tsx 의
// `RedesignScreens`에 닿기 전에 `Travel`·`FocusFlow`로 먼저 가로챈다. 이 가로채기가 지워지면
// 번역되지 않은 `Screens.tsx` 분기가 다시 살아나 한국어 문자열이 영어 빌드에 섞여 나온다.
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { RedesignScreens } from '@/screens/island/Screens';
import { initialState, reducer, type Route, type State } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';
import { getTelescope } from '@/services/api/telescope';
import { getMagazineIssue, putMagazineReceipt } from '@/services/api/magazine';

jest.mock('@/screens/world/DepartureStory', () => ({
  DepartureStory: ({ destination, onComplete }: any) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID="departure-story" onPress={onComplete}>
        <Text>{destination}</Text>
      </Pressable>
    );
  },
}));

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
    FishingIsland: ({ children, gram }: any) => (
      <View testID="focus-world" accessibilityLabel={gram ? 'gram-on' : 'gram-off'}>
        {children(640, 640 / 1.5, 1)}
      </View>
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
jest.mock('@/services/api/magazine', () => ({
  ...jest.requireActual('@/services/api/magazine'),
  getMagazineIssue: jest.fn(),
  putMagazineReceipt: jest.fn(),
}));
jest.mock('@/services/api/telescope', () => ({
  ...jest.requireActual('@/services/api/telescope'),
  getTelescope: jest.fn(),
  arriveAtIsland: jest.fn(),
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

const mount = async (route: Route, state: State = serverFocusState(), extra: object = {}) =>
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
        setGuideStep: jest.fn(),
        islands: {},
        ...extra,
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
  expect(redesignScreensMock).toHaveBeenCalled();
  await screen.unmount();
});

test.each([true, false])(
  '방문 낚시 장면은 방문 섬의 방송기 완공 상태를 따른다: %s',
  async (hasGram) => {
    let state = serverFocusState();
    state = reducer(state, {
      type: 'SERVER_HOME',
      facts: {
        islandId: 'soda',
        home: { island: { id: 'soda', role: 'member' }, wallets: { villagePoints: 0 } },
        completedBuildings: hasGram ? ['hall', 'board'] : ['hall', 'board', 'gram'],
        members: [],
      },
    } as any);
    state = reducer(state, {
      type: 'ISLAND_VISIT',
      visit: {
        island: { id: 'visitor' },
        buildings: hasGram ? ['hall', 'board', 'gram'] : ['hall', 'board'],
      },
    } as any);
    state = reducer(state, { type: 'SERVER_VISITING', islandId: 'visitor' });
    const screen = await mount('visitIslandFocus', state);
    expect(screen.getByTestId('focus-world').props.accessibilityLabel).toBe(
      hasGram ? 'gram-on' : 'gram-off',
    );
    await screen.unmount();
  },
);

test('로컬 방문 중에도 뗏목 라우트는 막히지 않고 뗏목 장면을 연다', async () => {
  const state = initialState(true);
  state.visitingIslandId = 'cloud';
  const screen = await render(
    <CurrentScreens
      e={{
        state,
        route: 'raft',
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
        setGuideStep: jest.fn(),
      }}
    />,
  );
  expect(screen.queryByText('주민만 이용할 수 있어요')).toBeNull();
  expect(screen.getByText('어디로 떠나볼까요?')).toBeTruthy();
  await screen.unmount();
});

test('망원경 라우트는 자리표시가 아니라 망원경 화면이 가로채 목록을 불러온다', async () => {
  (getTelescope as jest.Mock).mockResolvedValue({
    bucketStart: '2026-10-12T05:00:00Z',
    nextRefreshMinutes: 5,
    items: [],
  });
  const screen = await mount('telescope', initialState(true));
  await screen.findByText('지금은 보이는 섬이 없어요');
  expect(getTelescope).toHaveBeenCalledTimes(1);
  expect(redesignScreensMock).not.toHaveBeenCalled();
  await screen.unmount();
});

test('집중섬 출발도 공통 세 컷을 마친 뒤 기존 자리 선택 흐름으로 이어진다', async () => {
  const replace = jest.fn();
  const screen = await mount('focusTravel', serverFocusState(), { replace });
  expect(screen.getByTestId('departure-story')).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('departure-story'));
  expect(replace).toHaveBeenCalledTimes(1);
  expect(replace).toHaveBeenCalledWith('fishingArrival');
  await screen.unmount();
});

test('바다 잡지(seaMagazine) 라우트는 소속 섬이 없어도 섬 가드 없이 먼바다 배경의 잡지를 연다(GROMO-2314)', async () => {
  (getMagazineIssue as jest.Mock).mockResolvedValue({
    issue: {
      issueId: 'iss-20',
      issueNo: 20,
      issueDate: '2026-10-20',
      publishedAt: '2026-10-19T22:00:00Z',
      current: true,
    },
    editorial: null,
    cells: [],
    nextCursor: null,
  });
  (putMagazineReceipt as jest.Mock).mockResolvedValue({
    place: 'SEA',
    receivedAt: 'a',
    deferredAt: null,
    openedAt: 'b',
  });
  const state = serverFocusState();
  state.session = null;
  state.serverIslands = { ...state.serverIslands!, currentIslandId: null };
  const screen = await mount('seaMagazine', state, { detail: 'iss-20' });
  await screen.findByTestId('magazine-empty');
  expect(screen.getByTestId('magazine-reader')).toBeTruthy();
  expect(
    screen.getByTestId('sea-magazine-background', { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(screen.queryByText('가입한 섬이 없어요')).toBeNull();
  expect(redesignScreensMock).not.toHaveBeenCalled();
  expect(getMagazineIssue).toHaveBeenCalledWith('iss-20');
  expect(putMagazineReceipt).toHaveBeenCalledWith('iss-20', { place: 'SEA', opened: true });
  await screen.unmount();
});
