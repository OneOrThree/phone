import { useCameraPermissions } from 'expo-camera';
import {
  clearVerificationResult,
  openVerificationCapture,
} from '@/services/studyVerification/sessionResult';
// `CurrentScreensContent`(CurrentScreens.tsx)는 'arrival'·'travel'·'focusTravel'·'fishingArrival'·
// 'focusSetup'·'focus'·'rest'·'focusResult'·'returnTravel' 9개 라우트를 Screens.tsx 의
// `RedesignScreens`에 닿기 전에 `Travel`·`FocusFlow`로 먼저 가로채고, 'manage'·'members' 는 `Hall` 로 보낸다.
// GROMO-2463 에서 지운 hall·stats·ledger·construction·board·quest·notice·mail 분기도 같다.
// 옛 번역 안 된 `Screens.tsx` 분기는 GROMO-2254 에서 지웠다 — 이 가로채기가 지워지면 그 라우트가
// `RedesignScreens` 의 기본 화면으로 떨어지므로 여기서 고정한다(GROMO-2252).
import React from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { RedesignScreens } from '@/screens/island/Screens';
import { initialState, reducer, type Route, type State } from '@/services/model';
import { applyLocalePref } from '@/i18n';
import { clearSession, saveSession } from '@/services/api/session';
import { readAccountGuides, saveAccountGuides } from '@/services/accountGuides';
import { getTelescope } from '@/services/api/telescope';
import { getMagazineIssue, putMagazineReceipt } from '@/services/api/magazine';

jest.mock('@/screens/focus/VerificationSpike', () => ({
  ...jest.requireActual('@/screens/focus/VerificationSpike'),
  VERIFY_SPIKE: true,
}));
jest.mock('@/screens/focus/VerificationSession', () => ({
  VerificationSession: jest.fn(() => null),
}));

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

// manage·members 는 Hall 이 그린다 — 가짜 Hall 로 도달 여부와 route 만 본다.
jest.mock('@/screens/island/Hall', () => {
  const { View } = require('react-native');
  return { Hall: ({ e }: any) => <View testID="hall-mock" accessibilityLabel={e.route} /> };
});

// hall·stats·board 등 옛 Screens.tsx 분기가 있던 라우트는 Library·Hall·InteriorRoute 가 그린다 — 도달 여부와 route 만 본다.
jest.mock('@/screens/island/Library', () => {
  const { View } = require('react-native');
  return { Library: ({ e }: any) => <View testID="library-mock" accessibilityLabel={e.route} /> };
});
jest.mock('@/screens/interiors/BuildingInteriors', () => {
  const actual = jest.requireActual('@/screens/interiors/BuildingInteriors');
  const { View } = require('react-native');
  return {
    ...actual,
    InteriorRoute: ({ e }: any) => <View testID="interior-mock" accessibilityLabel={e.route} />,
  };
});

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
    resync: jest.fn(),
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
  const { Pressable, View } = require('react-native');
  return {
    ...actual,
    FishingIsland: ({ children, gram, onGram }: any) => (
      <View testID="focus-world" accessibilityLabel={gram ? 'gram-on' : 'gram-off'}>
        {gram && onGram && <Pressable testID="focus-gram" onPress={onGram} />}
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
const mockFocusShopBuy = jest.fn();
jest.mock('@/screens/island/useShop', () => ({
  useShop: () => ({
    items: [
      {
        id: 'rain',
        title: '빗방울 소리',
        price: 30,
        productVersion: 1,
        available: true,
      },
    ],
    shared: { audio: ['waves', 'campfire', 'forest-wind'] },
    titles: { rain: '빗방울 소리' },
    loading: false,
    error: null,
    writing: false,
    retry: jest.fn(),
    buy: mockFocusShopBuy,
  }),
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

// 잡지 리더는 실제 구현을 그대로 쓰되 마운트 횟수만 센다 — 호가 바뀔 때 새로 마운트되는지 본다.
const mockReaderMount = jest.fn();
jest.mock('@/screens/magazine/MagazineReader', () => {
  const actual = jest.requireActual('@/screens/magazine/MagazineReader');
  const React = require('react');
  return {
    ...actual,
    MagazineReader: (props: any) => {
      React.useEffect(() => {
        mockReaderMount(props.e.detail);
      }, []);
      return React.createElement(actual.MagazineReader, props);
    },
  };
});

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
const withGramophone = (state: State): State =>
  reducer(state, {
    type: 'SERVER_HOME',
    facts: {
      islandId: 'soda',
      home: { island: { id: 'soda', role: 'member' }, wallets: { villagePoints: 100 } },
      completedBuildings: ['hall', 'board', 'gram'],
      members: [],
    },
  } as any);

const screenOf = (route: Route, state: State, extra: object = {}) => (
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
  />
);
const mount = async (route: Route, state: State = serverFocusState(), extra: object = {}) =>
  render(screenOf(route, state, extra));

beforeEach(async () => {
  jest.clearAllMocks();
  clearVerificationResult('s-me');
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

// Screens.tsx 에서 분기를 지운 근거가 된 9개 라우트. CurrentScreensContent 가 Travel·FocusFlow 로 먼저 가로챈다.
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
  '라우트 %s 는 CurrentScreensContent 가 가로채 RedesignScreens 를 부르지 않는다',
  async (route) => {
    const screen = await mount(route);
    expect(redesignScreensMock).not.toHaveBeenCalled();
    await screen.unmount();
  },
);

test('활성 집중섬 축음기는 기본곡·판매곡과 재생·정지 조작을 제공한다', async () => {
  const state = withGramophone(serverFocusState());
  state.settings.volume = 0;
  const dispatch = jest.fn();
  const playback = { update: jest.fn().mockResolvedValue({}), state: {} };
  const screen = await mount('focus', state, { playback, dispatch });

  await fireEvent.press(screen.getByTestId('focus-gram'));
  screen.getByText('잔잔한 파도 · 무료');
  screen.getByText('모닥불 소리 · 무료');
  screen.getByText('숲바람 · 무료');
  screen.getByText('빗방울 소리 · 30마리로 구매');
  screen.getByText('재생');
  screen.getByText('정지');
  const volume = screen.getByLabelText('내 기기 음량');
  expect(volume.props.accessibilityValue.now).toBe(0);
  await fireEvent(volume, 'accessibilityAction', {
    nativeEvent: { actionName: 'increment' },
  });
  expect(dispatch).toHaveBeenCalledWith({ type: 'SETTING', key: 'volume', value: 0.1 });

  await fireEvent.press(screen.getByText('잔잔한 파도 · 무료'));
  expect(playback.update).toHaveBeenCalledWith({ trackId: 'waves' });
  await fireEvent.press(screen.getByText('재생'));
  expect(playback.update).toHaveBeenCalledWith({ playing: true });
  await fireEvent.press(screen.getByText('정지'));
  expect(playback.update).toHaveBeenCalledWith({ playing: false });
  await screen.unmount();
});

test('영어 설정에서는 집중섬 축음기 조작 문구를 영어로 표시한다', async () => {
  applyLocalePref('en');
  const playback = { update: jest.fn().mockResolvedValue({}), state: {} };
  const screen = await mount('focus', withGramophone(serverFocusState()), { playback });

  try {
    await fireEvent.press(screen.getByTestId('focus-gram'));
    screen.getByText('Gramophone Music');
    screen.getByText('Choose a track and control playback.');
    screen.getByText('Play');
    screen.getByText('Stop');
    screen.getByText('Device Volume');
    screen.getByText('Raindrops · Buy for 30 fish');
    screen.getByText('Back to My Spot');
  } finally {
    await screen.unmount();
    applyLocalePref('ko');
  }
});

test('집중 전 낚시섬은 곡 구매·변경만 제공하고 재생·정지는 노출하지 않는다', async () => {
  const state = withGramophone(serverFocusState());
  state.session = null;
  const playback = { update: jest.fn().mockResolvedValue({}), state: {} };
  mockFocusShopBuy.mockResolvedValue({ id: 'order-1' });
  const screen = await mount('fishingArrival', state, { playback });

  await fireEvent.press(screen.getByTestId('focus-gram'));
  expect(screen.queryByText('재생')).toBeNull();
  expect(screen.queryByText('정지')).toBeNull();
  expect(screen.queryByLabelText('내 기기 음량')).toBeNull();
  await fireEvent.press(screen.getByText('잔잔한 파도 · 무료'));
  expect(playback.update).toHaveBeenCalledWith({ trackId: 'waves' });
  await fireEvent.press(screen.getByText('빗방울 소리 · 30마리로 구매'));
  await fireEvent.press(screen.getByText('30마리로 구매'));
  expect(mockFocusShopBuy).toHaveBeenCalledWith(expect.objectContaining({ id: 'rain' }));
  screen.getByText('이 곡으로 바꾸기');
  await fireEvent.press(screen.getByText('나중에'));
  screen.getByText('빗방울 소리 · 30마리로 구매');
  await screen.unmount();
});

test('모닥불 휴식 화면에는 축음기와 음악 조작을 노출하지 않는다', async () => {
  const state = serverFocusState();
  state.session = { ...state.session!, status: 'paused' };
  const screen = await mount('rest', state);

  expect(screen.queryByTestId('focus-gram')).toBeNull();
  expect(screen.queryByText('축음기 음악')).toBeNull();
  await screen.unmount();
});

// manage·members(마을회관 관리·주민)는 로컬 모드에서도 Hall 로 가고 RedesignScreens 는 부르지 않는다.
test.each(['manage', 'members'] as const)(
  '로컬 모드 라우트 %s 는 Hall 이 그리고 RedesignScreens 를 부르지 않는다',
  async (route) => {
    const screen = await mount(route, initialState(true), { islands: undefined });
    expect(screen.getByTestId('hall-mock').props.accessibilityLabel).toBe(route);
    expect(redesignScreensMock).not.toHaveBeenCalled();
    await screen.unmount();
  },
);

// GROMO-2463: Screens.tsx 에서 지운 분기(hall·stats·ledger·construction·board·quest·questEdit·notice·noticeEdit·mail)는
// 모두 아래 화면이 가로채 RedesignScreens 에 닿지 않는다. 이 단언이 깨지면 지운 분기가 되살아나야 하는 라우트다.
test.each([
  ['stats', 'library-mock'],
  ['hall', 'hall-mock'],
  ['ledger', 'hall-mock'],
  ['construction', 'hall-mock'],
  ['board', 'interior-mock'],
  ['quest', 'interior-mock'],
  ['questEdit', 'interior-mock'],
  ['notice', 'interior-mock'],
  ['noticeEdit', 'interior-mock'],
  ['mail', 'interior-mock'],
] as const)(
  '지운 Screens.tsx 분기 라우트 %s 는 %s 가 그리고 RedesignScreens 를 부르지 않는다',
  async (route, testID) => {
    const screen = await mount(route, initialState(true), { islands: undefined });
    expect(screen.getByTestId(testID).props.accessibilityLabel).toBe(route);
    expect(redesignScreensMock).not.toHaveBeenCalled();
    await screen.unmount();
  },
);

// 대조군: 가로채기 목록에 없는 라우트는 그대로 RedesignScreens 로 떨어져야 한다 —
// 이 대조군이 깨지면 위 가로채기 테스트 자체가 아무것도 증명하지 못하는 셈이라 같이 둔다.
test('가로채기 목록에 없는 라우트 character 는 RedesignScreens 를 부른다', async () => {
  const screen = await mount('character');
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

test('집중섬 출발도 공통 출항 영상을 마친 뒤 기존 자리 선택 흐름으로 이어진다', async () => {
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

test('소속 섬 없이 주민 화면을 열면 「가입한 섬이 없어요」 안내가 회색 단색이 아니라 바다 장면 위에 뜬다(GROMO-2412)', async () => {
  const state = serverFocusState();
  state.session = null;
  state.serverIslands = { ...state.serverIslands!, currentIslandId: null };
  const reset = jest.fn();
  const screen = await mount('hall', state, { reset });
  expect(screen.getByText('가입한 섬이 없어요')).toBeTruthy();
  expect(screen.getByTestId('no-island-background', { includeHiddenElements: true })).toBeTruthy();
  // 장식 그림 — Overlay 가 background 를 숨김 View 로 감싸 스크린리더에서 빠진다
  expect(screen.queryByTestId('no-island-background')).toBeNull();
  // 버튼이 갈 곳을 말하므로 부연 문장은 두지 않는다
  expect(screen.queryByText('바다에서 머물 섬을 찾아보세요.')).toBeNull();
  await fireEvent.press(screen.getByText('바다로 가기'));
  expect(reset).toHaveBeenCalledWith('sea');
  await screen.unmount();
});

// 같은 잡지 라우트에서 호 id(detail)만 바뀌면(딥링크로 다른 호를 열 때) 리더를 새로 마운트해야 이전 호의 확대 모달·쪽 위치가 남지 않는다.
test.each(['magazine', 'seaMagazine'] as const)(
  '%s 라우트는 호 id 가 바뀌면 잡지 리더를 새로 마운트한다',
  async (route) => {
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
      place: route === 'seaMagazine' ? 'SEA' : 'ISLAND',
      receivedAt: 'a',
      deferredAt: null,
      openedAt: 'b',
    });
    const state = serverFocusState();
    state.session = null;
    const screen = await render(screenOf(route, state, { detail: 'iss-20' }));
    await screen.findByTestId('magazine-reader');
    expect(mockReaderMount).toHaveBeenCalledTimes(1);

    await screen.rerender(screenOf(route, state, { detail: 'iss-21' }));
    expect(mockReaderMount).toHaveBeenCalledTimes(2);
    expect(mockReaderMount).toHaveBeenLastCalledWith('iss-21');
    await screen.unmount();
  },
);

test('집중 중 카메라 끄기는 설정만 바꾸고 세션과 타이머를 유지한다', async () => {
  const state = serverFocusState();
  state.settings.studyVerification = true;
  state.settings.studyVerificationCamera = 'front';
  state.session!.seconds = 123;
  const dispatch = jest.fn();
  const now = Date.now();
  const screen = await mount('focus', state, { dispatch, now });
  expect(screen.getByTestId('focus-camera-toggle')).toBeTruthy();
  expect(screen.getByText('00:02:03')).toBeTruthy();
  dispatch.mockClear();
  await fireEvent.press(screen.getByRole('switch', { name: '카메라 인증 사용' }));
  expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
    { type: 'SETTING', key: 'studyVerificationCamera', value: 'front' },
    { type: 'SETTING', key: 'studyVerification', value: false },
  ]);
  const next = dispatch.mock.calls.reduce((current, [action]) => reducer(current, action), state);
  expect(next.session).toEqual(state.session);
  await screen.rerender(screenOf('focus', next, { dispatch, now }));
  expect(screen.getByText('00:02:03')).toBeTruthy();
});

test('카메라를 끄고 종료해도 사용한 세션의 결과에 누적 시간을 전달하고 기록에는 넣지 않는다', async () => {
  const state = serverFocusState();
  state.settings.studyVerification = false;
  const capture = openVerificationCapture('s-me');
  capture.observe(true, 0);
  capture.observe(true, 1000);
  capture.observe(true, 2000);
  capture.close();
  const record = {
    id: 's-me',
    islandId: 'soda',
    subject: '수학',
    seconds: 30,
    at: Date.now(),
    fish: 0,
    contributed: true,
  };
  state.lastResult = record;
  state.records = [record];
  state.session = null;
  const screen = await mount('focusResult', state);
  expect(screen.getByTestId('verification-result-duration')).toHaveTextContent('00:00:02');
  expect(screen.getByTestId('focus-result-duration')).toHaveTextContent('00:00:30');
  expect(JSON.stringify(state)).not.toMatch(/verifiedSeconds|verifiedMs/);
  await screen.unmount();
  clearVerificationResult('s-me');
  const ordinary = await mount('focusResult', state);
  expect(ordinary.queryByTestId('verification-result')).toBeNull();
});

test('카메라 기능 안내는 튜토리얼 도착에서는 숨기고 체험 완료 후 다음 도착에 표시한다', async () => {
  const state = serverFocusState();
  state.session = null;
  const tutorial = await mount('fishingArrival', state, { guideStep: 5 });
  expect(tutorial.queryByTestId('verification-intro')).toBeNull();
  await tutorial.unmount();
  state.focusGuideDone = true;
  const regular = await mount('fishingArrival', state, { guideStep: 99 });
  await waitFor(() => expect(regular.getByTestId('verification-intro')).toBeTruthy());
});

test('집중 화면으로 복원해도 안내를 안 본 계정에는 자동 안내하고 닫은 이력을 로컬에 기억한다', async () => {
  const userId = 'verification-restore-unseen';
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId });
  const state = serverFocusState();
  state.focusGuideDone = true;
  state.session!.seconds = 123;
  const dispatch = jest.fn();
  const now = Date.now();
  const first = await mount('focus', state, { guideStep: 99, dispatch, now });
  await waitFor(() => expect(first.getByTestId('verification-intro')).toBeTruthy());
  expect(first.getByText('00:02:03')).toBeTruthy();
  dispatch.mockClear();
  await fireEvent.press(first.getByRole('button', { name: '닫기' }));
  expect((await readAccountGuides(userId)).verificationIntroSeen).toBe(true);
  expect(dispatch).not.toHaveBeenCalled();
  expect(state.settings.studyVerification).not.toBe(true);
  expect(first.getByText('00:02:03')).toBeTruthy();
  await first.unmount();
  const restored = await mount('focus', state, { guideStep: 99, now });
  await waitFor(() => expect(restored.getByRole('button', { name: '카메라 인증' })).toBeEnabled());
  expect(restored.queryByTestId('verification-intro')).toBeNull();
});

test('입장 안내를 본 로컬 기록이 있으면 집중 화면에서도 안내를 다시 띄우지 않는다', async () => {
  const userId = 'verification-restore-seen';
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId });
  await saveAccountGuides(userId, { verificationIntroSeen: true });
  const state = serverFocusState();
  state.focusGuideDone = true;
  const screen = await mount('focus', state, { guideStep: 99 });
  await waitFor(() => expect(screen.getByRole('button', { name: '카메라 인증' })).toBeEnabled());
  expect(screen.queryByTestId('verification-intro')).toBeNull();
});

test('첫 집중 체험이 끝나지 않았으면 집중 화면에서도 카메라 안내를 자동 표시하지 않는다', async () => {
  const state = serverFocusState();
  state.focusGuideDone = false;
  const screen = await mount('focus', state, { guideStep: 99 });
  await waitFor(() => expect(screen.getByRole('button', { name: '카메라 인증' })).toBeEnabled());
  expect(screen.queryByTestId('verification-intro')).toBeNull();
});

test('과목·집중시간은 지도 안에 붙고 미리보기 토글은 지도 좌표를 바꾸지 않는다', async () => {
  const permission = {
    granted: true,
    canAskAgain: true,
    status: 'granted' as NonNullable<ReturnType<typeof useCameraPermissions>[0]>['status'],
    expires: 'never',
  } as const;
  jest
    .mocked(useCameraPermissions)
    .mockReturnValue([permission, jest.fn(), jest.fn(async () => permission)]);
  const state = serverFocusState();
  state.settings.studyVerification = true;
  state.session!.seconds = 123;
  const screen = await mount('focus', state, { now: Date.now() });
  const map = screen.getByTestId('focus-world');
  const hud = within(map).getByTestId('fishing-focus-hud');
  const position = hud.props.style;
  expect(within(hud).getByText(state.session!.subject)).toBeTruthy();
  expect(within(hud).getByText('00:02:03')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '카메라 인증' }).props.accessibilityState.expanded,
    ).toBe(true),
  );
  expect(within(map).getByTestId('fishing-focus-hud').props.style).toEqual(position);
  await fireEvent.press(screen.getByRole('button', { name: '카메라 인증' }));
  expect(within(map).getByTestId('fishing-focus-hud').props.style).toEqual(position);
  expect(within(map).getByText('00:02:03')).toBeTruthy();
});

test('실제 집중 경로의 과목·시간은 섬 자식 HUD로 표시한다', async () => {
  const state = serverFocusState();
  const screen = await mount('focus', state);
  const world = within(screen.getByTestId('focus-world'));
  const hud = world.getByTestId('fishing-focus-hud');
  expect(within(hud).getByText(state.session!.subject)).toBeTruthy();
  const timer = within(hud).getAllByText(/\d{2}:\d{2}:\d{2}/)[0];
  expect(timer).toBeTruthy();
});

test.each([5, 16, 21])(
  '측정 ON이 남아 있어도 튜토리얼 %s단계의 촬영 컴포넌트는 마운트하지 않는다',
  async (guideStep) => {
    const state = serverFocusState();
    state.settings.studyVerification = true;
    state.focusGuideDone = false;
    const camera = jest.requireMock('@/screens/focus/VerificationSession').VerificationSession;
    const screen = await mount('focus', state, { guideStep });
    expect(camera).not.toHaveBeenCalled();
    expect(screen.queryByTestId('focus-camera-toggle')).toBeNull();
    await screen.unmount();
  },
);
