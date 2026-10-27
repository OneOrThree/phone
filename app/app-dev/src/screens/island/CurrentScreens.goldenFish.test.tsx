import assert from 'node:assert/strict';
import React, { useReducer, useState } from 'react';
import { AccessibilityInfo, AppState, type AppStateEvent, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, userEvent } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { applyLocalePref, t } from '@/i18n';
import { initialState, reducer, type State } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';
import { ApiError } from '@/services/api/client';
import type { GoldenFishEvent } from '@/services/islandRealtime';

let onGoldenFish: ((event: GoldenFishEvent) => void) | undefined;
let presenceActive: boolean | undefined;
// GROMO-2478 — 실시간 주민과 실제 자리 배정 훅을 쓰는 테스트만 켠다(나머지는 고정 자리 mock)
let mockPresenceFocus: any[] = [];
let mockRealPeerActors = false;
let mockResultBoard: { loading: boolean; error: unknown; quests: any[] } = {
  loading: false,
  error: null,
  quests: [],
};

jest.mock('@/screens/focus/useIslandPresence', () => ({
  catColor: (color: string) => color,
  useIslandPresence: (opts: {
    active?: boolean;
    onGoldenFish?: (event: GoldenFishEvent) => void;
  }) => {
    presenceActive = opts.active;
    onGoldenFish = opts.onGoldenFish;
    return {
      status: 'ready',
      error: null,
      focus: mockPresenceFocus,
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

jest.mock('@/screens/focus/useFishingPeerActors', () => ({
  fishingSpotsForActors: (actors: any[]) => actors.map((actor) => actor.spot),
  useFishingPeerActors: (options: { members: any[] }) =>
    mockRealPeerActors
      ? jest.requireActual('@/screens/focus/useFishingPeerActors').useFishingPeerActors(options)
      : mockPeerActors(options),
}));
const mockPeerActors = ({ members }: { members: any[] }) => ({
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
});

jest.mock('@/screens/focus/FishingIsland', () => {
  const actual = jest.requireActual('@/screens/focus/FishingIsland');
  const { View } = require('react-native');
  return {
    ...actual,
    FishingIsland: ({ goldenFish, children, overlay, onRaft, onTap }: any) => (
      <View testID="golden-world" goldenFish={goldenFish} onRaft={onRaft} onTap={onTap}>
        {children(640, 640 / 1.5, 1)}
        {overlay?.(() => ({ x: 150, y: 200 }), 640)}
      </View>
    ),
    FishingActor: ({
      name,
      spot,
      goldenFishCount,
      goldenCatchToken,
      motion,
      tutorialFish,
      caughtFish,
    }: any) => (
      <View
        testID={name === '하늘이' ? 'golden-self' : `golden-actor-${name}`}
        spot={spot}
        goldenFishCount={goldenFishCount}
        goldenCatchToken={goldenCatchToken}
        motion={motion}
        tutorialFish={tutorialFish}
        caughtFish={caughtFish}
      />
    ),
    FishingPeerActorView: ({ actor, goldenFishCount, goldenCatchToken }: any) => (
      <View
        testID={`golden-peer-${actor.userId}`}
        spot={actor.spot}
        goldenFishCount={goldenFishCount}
        goldenCatchToken={goldenCatchToken}
      />
    ),
    FishingWalker: () => <View />,
  };
});

jest.mock('@/screens/world/WorldViews', () => {
  const actual = jest.requireActual('@/screens/world/WorldViews');
  const { Pressable } = require('react-native');
  return {
    ...actual,
    Sailing: ({ onArrive }: any) => <Pressable testID="focus-sailing" onPress={onArrive} />,
  };
});

jest.mock('@/screens/focus/GoldenFishCutscene', () => ({
  GoldenFishCutscene: ({ onFinish, muted, volume }: any) => {
    const { Pressable } = require('react-native');
    return <Pressable testID="golden-cutscene" muted={muted} volume={volume} onPress={onFinish} />;
  },
}));

jest.mock('@/screens/island/useFriendsScreen', () => ({
  useFriendsScreen: () => ({ data: null }),
}));
jest.mock('@/screens/island/useBoardHomeIndicator', () => ({
  useBoardHomeIndicator: () => ({ hasNew: false }),
}));
jest.mock('@/screens/interiors/useBoardNotices', () => ({
  useBoardNotices: () => mockResultBoard,
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

const event = (members: GoldenFishEvent['members'], eventId = 'golden-i1-1'): GoldenFishEvent => ({
  eventId,
  islandId: 'soda',
  drawnAt: eventId === 'golden-i1-2' ? '2026-09-28T00:01:00.000Z' : '2026-09-28T00:00:00.000Z',
  reward: members.length,
  sharePerMember: 1,
  members,
});

const focusedState = (): State => {
  const state = initialState(true);
  state.name = '하늘이'; // 내 이름표는 닉네임(GROMO-2475)
  state.focusSpot = { x: 34.1, y: 57 };
  state.session = {
    id: 's-me',
    islandId: 'soda',
    subject: '수학',
    startedAt: Date.now(),
    seconds: 0,
    status: 'active',
    intervals: [],
  };
  return state;
};

test.each([false, true])(
  '서버 지급 성공 → 낚는 액션 → 기존 대사이며 건너뛰기=%s도 보존한다',
  async (skip) => {
    jest.useFakeTimers();
    let resolve!: (value: { status: string }) => void;
    const request = jest.fn(
      () =>
        new Promise<{ status: string }>((done) => {
          resolve = done;
        }),
    );
    const seed = focusedState();
    seed.session!.version = 1;
    seed.session!.seconds = 5;
    seed.tutorial = { step: 11 };
    let current = seed;
    let skipGuide!: () => void;
    function Flow() {
      const [state, dispatch] = useReducer(reducer, seed);
      current = state;
      skipGuide = () => dispatch({ type: 'GUIDE_STEP', step: 99 });
      return screenElement(state, 'focus', undefined, jest.fn(), jest.fn(), dispatch, {
        guideStep: state.tutorial?.step,
        setGuideStep: (step: number, expected: unknown) =>
          dispatch({ type: 'GUIDE_STEP', step, expected }),
        focus: { tutorialReward: request },
      });
    }
    const screen = await render(<Flow />);
    expect(request).toHaveBeenCalledWith('s-me');
    expect(current.tutorial?.step).toBe(11);
    if (skip) await act(async () => skipGuide());
    await act(async () => resolve({ status: 'granted' }));
    if (!skip) {
      expect(screen.getByTestId('golden-self', { includeHiddenElements: true }).props.motion).toBe(
        'reel',
      );
      expect(current.tutorial?.step).toBe(11);
    }
    await act(async () => jest.advanceTimersByTime(2100));
    expect(current.tutorial?.step).toBe(skip ? 99 : 12);
    if (!skip) expect(screen.getByText(/첫 물고기를 낚았어!/)).toBeTruthy();
    await screen.unmount();
    jest.useRealTimers();
  },
);

test('첫 물고기 reel 중 황금 컷신이 오면 컷신이 끝난 뒤에 12단계로 진행한다', async () => {
  jest.useFakeTimers();
  const seed = focusedState();
  seed.session!.version = 1;
  seed.session!.seconds = 5;
  seed.tutorial = { step: 11 };
  let current = seed;
  function Flow() {
    const [state, dispatch] = useReducer(reducer, seed);
    current = state;
    return screenElement(state, 'focus', undefined, jest.fn(), jest.fn(), dispatch, {
      guideStep: state.tutorial?.step,
      setGuideStep: (step: number, expected: unknown) =>
        dispatch({ type: 'GUIDE_STEP', step, expected }),
      focus: { tutorialReward: jest.fn().mockResolvedValue({ status: 'granted' }) },
    });
  }
  const screen = await render(<Flow />);
  await act(async () =>
    onGoldenFish?.(
      event([
        { userId: 'me', sessionId: 's-me' },
        { userId: 'minji', sessionId: 'minji' },
      ]),
    ),
  );
  await act(async () => jest.advanceTimersByTime(2100));
  expect(screen.queryByTestId('golden-cutscene')).not.toBeNull();
  expect(current.tutorial?.step).toBe(11);
  await fireEvent.press(screen.getByTestId('golden-cutscene'));
  await act(async () => jest.advanceTimersByTime(1000));
  expect(current.tutorial?.step).toBe(11);
  // 황금 reel 종료 → 첫 물고기 reel 재시작 → 종료가 각각 effect를 거치므로 act를 나눠 흘린다
  for (let elapsed = 0; elapsed < 8000; elapsed += 500)
    await act(async () => jest.advanceTimersByTime(500));
  expect(current.tutorial?.step).toBe(12);
  await screen.unmount();
});

const screenElement = (
  state: State,
  route: 'fishingArrival' | 'focusSetup' | 'focus' | 'rest' | 'focusResult' = 'focus',
  backOverride?: { current: (() => boolean) | null },
  goOverride = jest.fn(),
  homeOverride = jest.fn(),
  dispatchOverride: (action: any) => void = jest.fn(),
  overrides: Record<string, unknown> = {},
) => (
  <CurrentScreens
    e={{
      state,
      route,
      now: Date.now(),
      dispatch: dispatchOverride,
      go: goOverride,
      replace: jest.fn(),
      reset: jest.fn(),
      home: homeOverride,
      back: jest.fn(),
      backOverride,
      notify: jest.fn(),
      text: '',
      setText: jest.fn(),
      ...overrides,
    }}
  />
);

const mount = (state = focusedState(), backOverride?: { current: (() => boolean) | null }) =>
  render(screenElement(state, 'focus', backOverride));

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockResultBoard = { loading: false, error: null, quests: [] };
  mockPresenceFocus = [];
  mockRealPeerActors = false;
  onGoldenFish = undefined;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

afterEach(() => jest.useRealTimers());

test('튜토리얼 할 일 입력은 입력 완료 전까지 단계를 바꾸거나 세션을 시작하지 않는다', async () => {
  const state = focusedState();
  state.session = null;
  const setGuideStep = jest.fn(),
    setText = jest.fn(),
    start = jest.fn();
  const props = { guideStep: 7, setGuideStep, setText, focus: { start } };
  const screen = await render(
    screenElement(state, 'focusSetup', undefined, undefined, undefined, undefined, props),
  );
  await fireEvent.changeText(
    screen.getByTestId('focus-subject', { includeHiddenElements: true }),
    '영',
  );
  expect(setText).toHaveBeenCalledWith('영');
  expect(setGuideStep).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  await screen.rerender(
    screenElement(state, 'focusSetup', undefined, undefined, undefined, undefined, {
      ...props,
      text: '영어 단어 외우기',
    }),
  );
  await fireEvent.press(screen.getByText('입력 완료'));
  expect(setGuideStep).toHaveBeenCalledWith(8);
  expect(start).not.toHaveBeenCalled();
  await screen.unmount();
});

test('튜토리얼 종료 실패는 재시도 가능하며 성공 후에만 결과 안내로 진행한다', async () => {
  const state = focusedState();
  state.session!.version = 1;
  const setGuideStep = jest.fn(),
    reset = jest.fn();
  const finish = jest.fn().mockRejectedValueOnce(new Error('연결 실패')).mockResolvedValueOnce({});
  const props = { guideStep: 17, setGuideStep, reset, focus: { finish } };
  const screen = await render(
    screenElement(state, 'focus', undefined, undefined, undefined, undefined, props),
  );
  await screen.rerender(
    screenElement(state, 'focus', undefined, undefined, undefined, undefined, {
      ...props,
      guideStep: 18,
    }),
  );
  setGuideStep.mockClear();
  await fireEvent(screen.getByTestId('end-focus', { includeHiddenElements: true }), 'pressIn');
  await act(() => jest.advanceTimersByTime(3000));
  expect(setGuideStep).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
  await fireEvent(screen.getByTestId('end-focus', { includeHiddenElements: true }), 'pressIn');
  await act(() => jest.advanceTimersByTime(3000));
  expect(setGuideStep).toHaveBeenCalledWith(19, { step: 18, revision: 0 });
  expect(reset).toHaveBeenCalledWith('focusResult');
  await screen.unmount();
});

test('첫 물고기와 사용처는 한 대사이며 한 번 넘기면 휴식 안내로 진행한다', async () => {
  const setGuideStep = jest.fn();
  const screen = await render(
    screenElement(focusedState(), 'focus', undefined, undefined, undefined, undefined, {
      guideStep: 12,
      setGuideStep,
    }),
  );
  expect(
    screen.getByText('첫 물고기를 낚았어!\n이 물고기는 섬을 발전시키는 데 사용할 수 있어!'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByText('다음'));
  expect(setGuideStep).toHaveBeenCalledWith(14);
  await screen.unmount();
});

test('집중섬 도착 즉시 자리 안내와 귀환 버튼을 표시하고 중복 귀환을 막는다', async () => {
  const state = focusedState();
  state.session = null;
  const go = jest.fn(),
    dispatch = jest.fn();
  const screen = await render(
    screenElement(state, 'fishingArrival', undefined, go, undefined, dispatch),
  );
  expect(screen.getByText('집중할 자리를 골라주세요!')).toBeTruthy();
  const back = screen.getByRole('button', { name: '← 메인 섬으로' });
  await fireEvent.press(back);
  await fireEvent.press(back);
  expect(go).toHaveBeenCalledTimes(1);
  expect(go).toHaveBeenCalledWith('returnTravel');
  expect(dispatch).not.toHaveBeenCalled();
  await screen.unmount();
});

test.each(['button', 'hardware'] as const)(
  '자리로 걷는 중 %s 뒤로가기는 착석을 취소하고 귀환한다',
  async (method) => {
    jest.useFakeTimers();
    const state = focusedState();
    state.session = null;
    state.settings.reduceMotion = false;
    const go = jest.fn(),
      dispatch = jest.fn();
    const backOverride: { current: (() => boolean) | null } = { current: null };
    const screen = await render(
      screenElement(state, 'fishingArrival', backOverride, go, undefined, dispatch),
    );
    await fireEvent(screen.getByTestId('golden-world'), 'tap', state.focusSpot);
    // 섬 안쪽으로 조금 걸어 들어간 뒤 — 귀환도 걸어서 돌아간다
    await act(async () => jest.advanceTimersByTime(1000));
    expect(go).not.toHaveBeenCalled();
    if (method === 'button') await fireEvent.press(screen.getByTestId('leave-fishing-arrival'));
    else
      await act(async () => {
        expect(backOverride.current?.()).toBe(true);
      });
    // 귀환 도중 땅을 다시 누르거나 [집중 시작]을 눌러도 귀환 걷기가 끊기지 않는다.
    await fireEvent(screen.getByTestId('golden-world'), 'tap', state.focusSpot);
    await fireEvent.press(screen.getByTestId('focus-start'));
    await act(async () => jest.advanceTimersByTime(20000));
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith('returnTravel');
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'FOCUS_SPOT' }));
    await screen.unmount();
  },
);

test('착석하면 자리 안내를 숨기고 다시 자리 고르기로 돌아오면 표시한다', async () => {
  const state = focusedState();
  state.session = null;
  const screen = await render(screenElement(state, 'fishingArrival'));
  await screen.rerender(screenElement(state, 'focusSetup'));
  expect(screen.queryByText('집중할 자리를 골라주세요!')).toBeNull();
  expect(screen.queryByTestId('leave-fishing-arrival')).toBeNull();
  await screen.rerender(screenElement(state, 'fishingArrival'));
  expect(screen.getByText('집중할 자리를 골라주세요!')).toBeTruthy();
  await screen.unmount();
});

test.each([
  [0, 21],
  [2, 20],
])('결과 안내는 물고기 %i마리면 %i단계로 이어진다', async (fish, next) => {
  const state = focusedState();
  state.session = null;
  state.lastResult = {
    id: 's-me',
    islandId: 'soda',
    subject: '수학',
    seconds: 65,
    at: Date.now(),
    fish,
    contributed: false,
  };
  const setGuideStep = jest.fn();
  const screen = await render(
    screenElement(state, 'focusResult', undefined, undefined, undefined, undefined, {
      guideStep: 19,
      setGuideStep,
    }),
  );
  await fireEvent.press(screen.getByText('다음'));
  expect(setGuideStep).toHaveBeenCalledWith(next);
  await screen.unmount();
});

test('튜토리얼 집중 시작이 실패하면 오류를 대화창 안에서 알리고 단계를 유지한다', async () => {
  const state = focusedState();
  state.session = null;
  const setGuideStep = jest.fn();
  const start = jest.fn().mockRejectedValueOnce(new Error('네트워크 연결 실패'));
  const screen = await render(
    screenElement(state, 'focusSetup', undefined, undefined, undefined, undefined, {
      guideStep: 8,
      setGuideStep,
      text: '영어 단어 외우기',
      focus: { start },
    }),
  );
  await fireEvent.press(screen.getByTestId('start-focus', { includeHiddenElements: true }));
  const alert = screen.getByRole('alert');
  // GROMO-2235 r6: errorTextOr 로 바뀌며 ApiError 가 아닌 일반 Error 는 message 를 그대로 보여주지
  // 않고 폴백 문구로 통일한다 — 서버 message 는 항상 한국어라는 전제가 깨지는 자리라 원문을 믿지 않는다.
  expect(alert).toHaveTextContent('집중을 시작하지 못했어요.');
  expect(screen.getByTestId('tutorial-dialogue')).toContainElement(alert);
  expect(setGuideStep).not.toHaveBeenCalled();
  await screen.unmount();
});

test('첫 물고기를 기다리는 11단계에는 휴식과 종료 전환을 막는다', async () => {
  const state = focusedState();
  state.session!.version = 1;
  const pause = jest.fn(),
    setGuideStep = jest.fn();
  const screen = await render(
    screenElement(state, 'focus', undefined, undefined, undefined, undefined, {
      guideStep: 11,
      setGuideStep,
      focus: { pause, tutorialReward: jest.fn(() => new Promise(() => {})) },
    }),
  );
  await fireEvent.press(screen.getByTestId('pause-focus', { includeHiddenElements: true }));
  await fireEvent(screen.getByTestId('end-focus', { includeHiddenElements: true }), 'pressIn');
  await act(() => jest.advanceTimersByTime(3000));
  expect(pause).not.toHaveBeenCalled();
  expect(screen.queryByTestId('confirm-finish', { includeHiddenElements: true })).toBeNull();
  await screen.unmount();
});

test('집중 종료 버튼은 확인창 없이 1.5초 누른 뒤 바로 결과로 진행한다', async () => {
  jest.useFakeTimers();
  const state = focusedState();
  state.session!.version = 1;
  const finish = jest.fn().mockResolvedValue({});
  const setGuideStep = jest.fn(),
    reset = jest.fn();
  const screen = await render(
    screenElement(state, 'focus', undefined, undefined, undefined, undefined, {
      guideStep: 17,
      setGuideStep,
      reset,
      focus: { finish },
    }),
  );
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const button = screen.getByTestId('end-focus', { includeHiddenElements: true });
  await user.press(button);
  await user.longPress(button, { duration: 1499 });
  expect(finish).not.toHaveBeenCalled();
  expect(setGuideStep).not.toHaveBeenCalled();
  expect(screen.queryByTestId('confirm-finish', { includeHiddenElements: true })).toBeNull();
  await user.longPress(button, { duration: 1500 });
  expect(finish).toHaveBeenCalledTimes(1);
  expect(setGuideStep).toHaveBeenCalledWith(19, { step: 17, revision: 0 });
  expect(reset).toHaveBeenCalledWith('focusResult');
  await screen.unmount();
});

test('자리 선택 중에는 뗏목 귀환을 막지만 일반 자리 선택의 귀환은 유지한다', async () => {
  const state = focusedState();
  state.session = null;
  const go = jest.fn();
  const screen = await render(
    screenElement(state, 'fishingArrival', undefined, go, undefined, undefined, {
      guideStep: 6,
      setGuideStep: jest.fn(),
    }),
  );
  await fireEvent(screen.getByTestId('golden-world', { includeHiddenElements: true }), 'raft');
  expect(go).not.toHaveBeenCalled();
  await screen.rerender(screenElement(state, 'fishingArrival', undefined, go));
  await fireEvent(screen.getByTestId('golden-world'), 'raft');
  expect(go).toHaveBeenCalledWith('returnTravel');
});

test.each([
  ['pause', 14, 'focus', 'pause-focus'],
  ['resume', 15, 'rest', 'resume-focus'],
  ['finish', 17, 'focus', 'end-focus'],
] as const)(
  '%s 요청 중 건너뛰기는 늦은 성공 뒤에도 99단계로 유지된다',
  async (command, step, route, button) => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    const seed = focusedState();
    seed.session!.version = 1;
    if (command === 'resume') seed.session!.status = 'paused';
    seed.tutorial = { step };
    let current: State = seed;
    const request = jest.fn(() => pending);
    function Flow() {
      const [state, dispatch] = useReducer(reducer, seed);
      current = state;
      return screenElement(state, route, undefined, jest.fn(), jest.fn(), dispatch, {
        guideStep: state.tutorial?.step,
        setGuideStep: (next: number, expected: unknown) =>
          dispatch({ type: 'GUIDE_STEP', step: next, expected }),
        text: '수학',
        focus: { [command]: request },
      });
    }
    const screen = await render(<Flow />);
    if (button === 'end-focus') {
      await fireEvent(screen.getByTestId(button, { includeHiddenElements: true }), 'pressIn');
      await act(() => jest.advanceTimersByTime(3000));
    } else await fireEvent.press(screen.getByTestId(button, { includeHiddenElements: true }));
    expect(request).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText('안내 그만 보기'));
    expect(current.tutorial?.step).toBe(99);
    await act(async () => resolve());
    expect(current.tutorial?.step).toBe(99);
    await screen.unmount();
  },
);

test('체험은 실제 시작 API·실시간 없이 5초 후 일반 1마리와 기존 대사를 보여 준다', async () => {
  jest.useFakeTimers();
  const start = jest.fn(),
    pause = jest.fn(),
    resume = jest.fn(),
    finish = jest.fn();
  const tutorialExperienceReward = jest
    .fn()
    .mockResolvedValue({ islandId: 'soda', status: 'granted' });
  const seed = focusedState();
  seed.session = null;
  seed.tutorial = { step: 8 };
  seed.serverIslands = { currentIslandId: 'soda' } as any;
  let current = seed;
  let step!: (value: number) => void;
  function Flow({ now }: { now: number }) {
    const [state, dispatch] = useReducer(reducer, seed);
    const [route, setRoute] = useState<'focusSetup' | 'focus' | 'rest' | 'focusResult'>(
      'focusSetup',
    );
    current = state;
    step = (value) => dispatch({ type: 'GUIDE_STEP', step: value });
    return screenElement(state, route, undefined, jest.fn(setRoute), jest.fn(), dispatch, {
      now,
      text: '첫 집중',
      guideStep: state.tutorial?.step,
      setGuideStep: (next: number, expected: unknown) =>
        dispatch({ type: 'GUIDE_STEP', step: next, expected }),
      focus: { start, pause, resume, finish, tutorialExperienceReward },
      islands: {},
    });
  }
  const now = Date.now();
  const screen = await render(<Flow now={now} />);
  await fireEvent.press(screen.getByTestId('start-focus', { includeHiddenElements: true }));
  expect(start).not.toHaveBeenCalled();
  expect(current.session).toBeNull();
  expect(current.tutorialExperience?.session).toBeTruthy();
  expect(presenceActive).toBe(false);
  await act(async () => step(11));
  await screen.rerender(<Flow now={now + 4999} />);
  expect(tutorialExperienceReward).not.toHaveBeenCalled();
  await screen.rerender(<Flow now={now + 5000} />);
  expect(tutorialExperienceReward).toHaveBeenCalledWith('soda');
  expect(screen.getByTestId('golden-self').props.motion).toBe('reel');
  expect(current.tutorial?.step).toBe(11);
  await act(async () =>
    onGoldenFish?.(event([{ userId: 'me', sessionId: current.tutorialExperience!.session!.id }])),
  );
  expect(screen.queryByTestId('golden-cutscene')).toBeNull();
  await act(async () => jest.advanceTimersByTime(2000));
  expect(current.tutorial?.step).toBe(12);
  expect(screen.getByText(/첫 물고기를 낚았어!/)).toBeTruthy();
  await screen.rerender(<Flow now={now + 120000} />);
  expect(screen.getByTestId('golden-self', { includeHiddenElements: true }).props.caughtFish).toBe(
    1,
  );
  expect(current.session).toBeNull();
  expect(current.records).toEqual(seed.records);
  expect(pause).not.toHaveBeenCalled();
  expect(resume).not.toHaveBeenCalled();
  expect(finish).not.toHaveBeenCalled();
  await screen.unmount();
});

test('구버전 완료 결과의 실제 물고기와 acknowledge 명령을 보존한다', async () => {
  const state = focusedState();
  state.session = null;
  state.tutorial = { step: 21, sessionId: 'legacy-result' };
  state.lastResult = {
    id: 'legacy-result',
    ackId: 'legacy-result',
    islandId: 'soda',
    subject: '기존 집중 결과',
    seconds: 120,
    fish: 2,
    at: Date.now(),
    contributed: true,
  };
  state.resultFromRest = true;
  const acknowledge = jest.fn().mockResolvedValue(null);
  const screen = await render(
    screenElement(state, 'focusResult', undefined, undefined, undefined, undefined, {
      guideStep: 21,
      setGuideStep: jest.fn(),
      focus: { acknowledge },
    }),
  );
  expect(screen.getByText('기존 집중 결과', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByText('+2', { includeHiddenElements: true })).toBeTruthy();
  await fireEvent.press(screen.getByTestId('result-done', { includeHiddenElements: true }));
  expect(acknowledge).toHaveBeenCalledWith('legacy-result');
  await screen.unmount();
});

test('체험 종료 버튼은 서버 finish 없이 결과를 표시하고 실제 기록을 남기지 않는다', async () => {
  jest.useFakeTimers();
  let seed = focusedState();
  seed.session = null;
  seed.tutorial = { step: 8 };
  seed = reducer(seed, { type: 'TUTORIAL_EXPERIENCE_START', subject: '체험 집중' });
  seed = reducer(seed, { type: 'GUIDE_STEP', step: 11 });
  seed = reducer(seed, {
    type: 'TUTORIAL_EXPERIENCE_REWARD',
    sessionId: seed.tutorialExperience!.session!.id,
  });
  seed = reducer(seed, { type: 'GUIDE_STEP', step: 17 });
  seed.serverIslands = { currentIslandId: 'soda' } as any;
  let current = seed;
  const finish = jest.fn();
  function Flow() {
    const [state, dispatch] = useReducer(reducer, seed);
    const [route, setRoute] = useState<'focus' | 'focusResult'>('focus');
    current = state;
    return screenElement(state, route, undefined, undefined, undefined, dispatch, {
      guideStep: state.tutorial?.step,
      setGuideStep: (next: number, expected: unknown) =>
        dispatch({ type: 'GUIDE_STEP', step: next, expected }),
      reset: setRoute,
      focus: { finish },
      islands: {},
    });
  }
  const screen = await render(<Flow />);
  await fireEvent(screen.getByTestId('end-focus', { includeHiddenElements: true }), 'pressIn');
  await act(() => jest.advanceTimersByTime(3000));
  expect(finish).not.toHaveBeenCalled();
  expect(current.tutorial?.step).toBe(19);
  expect(current.tutorialExperience?.result?.fish).toBe(1);
  expect(screen.getByText('이번 집중 결과', { includeHiddenElements: true })).toBeTruthy();
  expect(current.session).toBeNull();
  expect(current.records).toEqual(seed.records);
  expect(current.lastResult).toEqual(seed.lastResult);
  await screen.unmount();
});

test('체험 보상 요청 중 건너뛰면 늦은 성공은 대사·세션을 되살리지 않는다', async () => {
  jest.useFakeTimers();
  let resolve!: (value: { status: string }) => void;
  const tutorialExperienceReward = jest.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  let seed = reducer(focusedState(), { type: 'SESSION_SYNC', session: null });
  seed = reducer(seed, { type: 'GUIDE_STEP', step: 8 });
  seed = reducer(seed, {
    type: 'TUTORIAL_EXPERIENCE_START',
    subject: '수학',
    now: Date.now() - 5000,
  });
  seed = reducer(seed, { type: 'GUIDE_STEP', step: 11 });
  seed.serverIslands = { currentIslandId: 'soda' } as any;
  let current = seed;
  let skip!: () => void;
  function Flow() {
    const [state, dispatch] = useReducer(reducer, seed);
    current = state;
    skip = () => dispatch({ type: 'GUIDE_STEP', step: 99 });
    return screenElement(state, 'focus', undefined, jest.fn(), jest.fn(), dispatch, {
      guideStep: state.tutorial?.step,
      setGuideStep: (value: number) => dispatch({ type: 'GUIDE_STEP', step: value }),
      focus: { tutorialExperienceReward },
      islands: {},
    });
  }
  const screen = await render(<Flow />);
  expect(tutorialExperienceReward).toHaveBeenCalledTimes(1);
  await act(async () => skip());
  await act(async () => resolve({ status: 'granted' }));
  expect(current.tutorial?.step).toBe(99);
  expect(current.tutorialExperience).toBeUndefined();
  expect(current.session).toBeNull();
  await screen.unmount();
});

test('자리 선택은 배경 접근성을 숨기고 유효한 실제 자리 선택 동작을 제공한다', async () => {
  jest.useFakeTimers();
  const reader = jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
  const state = focusedState();
  state.session = null;
  const go = jest.fn(),
    dispatch = jest.fn(),
    setGuideStep = jest.fn();
  const screen = await render(
    screenElement(state, 'fishingArrival', undefined, go, undefined, dispatch, {
      guideStep: 6,
      setGuideStep,
    }),
  );
  expect(screen.queryByTestId('golden-world')).toBeNull();
  await fireEvent.press(screen.getByText('빈 땅에 자리 잡기'));
  await act(async () => jest.advanceTimersByTime(20000));
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'FOCUS_SPOT' }));
  expect(go).toHaveBeenCalledWith('focusSetup');
  expect(setGuideStep).toHaveBeenCalledWith(7, { step: 6, revision: 0 });
  await screen.unmount();
  reader.mockRestore();
});

test('현재 세션 참여자만 컷신을 보고 종료 뒤 참여자 더미와 섬 에셋을 함께 갱신한다', async () => {
  jest.useFakeTimers();
  const backOverride: { current: (() => boolean) | null } = { current: null };
  const state = focusedState();
  state.settings.sound = false;
  state.settings.volume = 0.25;
  const screen = await mount(state, backOverride);
  const hiddenByTestId = (id: string) => screen.getByTestId(id, { includeHiddenElements: true });

  await act(async () => onGoldenFish?.(event([{ userId: 'other', sessionId: 's-other' }])));
  assert.equal(screen.queryByTestId('golden-cutscene'), null);

  await act(async () =>
    onGoldenFish?.(
      event([
        { userId: 'me', sessionId: 's-me' },
        { userId: 'minji', sessionId: 'minji' },
      ]),
    ),
  );
  assert.notEqual(screen.queryByTestId('golden-cutscene'), null);
  assert.equal(screen.getByTestId('golden-cutscene').props.muted, true);
  assert.equal(screen.getByTestId('golden-cutscene').props.volume, 0.25);
  assert.equal(
    hiddenByTestId('golden-background').props.importantForAccessibility,
    'no-hide-descendants',
  );
  assert.equal(hiddenByTestId('golden-world').props.goldenFish, false);
  assert.equal(backOverride.current?.(), true);
  assert.equal(screen.queryByText('이번 집중을 마칠까요?'), null);

  await act(async () =>
    onGoldenFish?.(
      event(
        [
          { userId: 'me', sessionId: 's-me' },
          { userId: 'minji', sessionId: 'minji' },
        ],
        'golden-i1-2',
      ),
    ),
  );

  await fireEvent.press(screen.getByTestId('golden-cutscene'));
  assert.equal(screen.queryByTestId('golden-cutscene'), null);
  assert.equal(hiddenByTestId('golden-world').props.goldenFish, true);
  assert.equal(hiddenByTestId('golden-self').props.goldenFishCount, 1);
  assert.equal(hiddenByTestId('golden-self').props.goldenCatchToken, 'golden-i1-1');

  await act(async () => jest.advanceTimersByTime(2000));
  assert.notEqual(screen.queryByTestId('golden-cutscene'), null);
  assert.equal(hiddenByTestId('golden-world').props.goldenFish, false);

  await fireEvent.press(screen.getByTestId('golden-cutscene'));
  assert.equal(screen.queryByTestId('golden-cutscene'), null);
  assert.equal(screen.getByTestId('golden-world').props.goldenFish, true);
  assert.equal(screen.getByTestId('golden-self').props.goldenFishCount, 2);
  assert.equal(screen.getByTestId('golden-self').props.goldenCatchToken, 'golden-i1-2');
  assert.equal(screen.getByTestId('golden-peer-minji').props.goldenFishCount, 2);
  assert.equal(screen.getByTestId('golden-peer-minji').props.goldenCatchToken, 'golden-i1-2');
  assert.equal(screen.getByTestId('golden-peer-dubu').props.goldenFishCount, 0);

  state.session!.status = 'paused';
  state.session!.restStartedAt = Date.now();
  await screen.rerender(screenElement(state, 'rest', backOverride));
  state.session!.status = 'active';
  delete state.session!.restStartedAt;
  await screen.rerender(screenElement(state, 'focus', backOverride));
  assert.equal(screen.getByTestId('golden-world').props.goldenFish, true);
  assert.equal(screen.getByTestId('golden-self').props.goldenFishCount, 2);
  await screen.unmount();
  jest.useRealTimers();
});

test('집중 화면이 사라질 때 자기가 건 뒤로 가기 처리만 걷고 다른 화면이 건 것은 건드리지 않는다', async () => {
  const backOverride: { current: (() => boolean) | null } = { current: null };
  const mine = await mount(focusedState(), backOverride);
  expect(typeof backOverride.current).toBe('function');
  await mine.unmount();
  expect(backOverride.current).toBeNull();

  const other = jest.fn(() => true);
  const screen = await mount(focusedState(), backOverride);
  backOverride.current = other; // 다른 화면이 자기 처리를 걸었다
  await screen.unmount();
  expect(backOverride.current).toBe(other);
});

test('동작 줄이기에서는 컷신 대신 음성 안내하고 황금 물고기 더미를 반영한다', async () => {
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => {});
  const state = focusedState();
  state.settings.reduceMotion = true;
  const screen = await mount(state);

  await act(async () =>
    onGoldenFish?.(
      event([
        { userId: 'me', sessionId: 's-me' },
        { userId: 'minji', sessionId: 'minji' },
      ]),
    ),
  );

  assert.equal(screen.queryByTestId('golden-cutscene'), null);
  assert.equal(screen.getByTestId('golden-self').props.goldenFishCount, 1);
  assert.equal(screen.getByTestId('golden-world').props.goldenFish, true);
  assert.equal(announce.mock.calls.length, 1);
  assert.equal(announce.mock.calls[0][0], '황금 물고기를 잡았어요.');
  await screen.unmount();
  announce.mockRestore();
});

test('동작 줄이기 당첨이 백그라운드에 도착하면 복귀 후 안내한다', async () => {
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => {});
  const listeners: ((state: AppStateStatus) => void)[] = [];
  const originalAddEventListener = Object.getOwnPropertyDescriptor(AppState, 'addEventListener');
  Object.defineProperty(AppState, 'addEventListener', {
    configurable: true,
    value: ((_type: AppStateEvent, listener: (state: AppStateStatus) => void) => {
      listeners.push(listener);
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener,
  });
  const originalState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  let currentState = 'background';
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    get: () => currentState,
  });
  const state = focusedState();
  state.settings.reduceMotion = true;
  const screen = await mount(state);

  await act(async () =>
    onGoldenFish?.(
      event([
        { userId: 'me', sessionId: 's-me' },
        { userId: 'minji', sessionId: 'minji' },
      ]),
    ),
  );
  assert.equal(announce.mock.calls.length, 0);
  currentState = 'active';
  await act(async () => listeners.forEach((listener) => listener('active')));
  assert.equal(announce.mock.calls.length, 1);
  assert.equal(announce.mock.calls[0][0], '황금 물고기를 잡았어요.');

  await screen.unmount();
  if (originalState) Object.defineProperty(AppState, 'currentState', originalState);
  if (originalAddEventListener) {
    Object.defineProperty(AppState, 'addEventListener', originalAddEventListener);
  }
  announce.mockRestore();
});

test('같은 realtime 사건이 재전송되어도 한 번만 표시한다', async () => {
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => {});
  const state = focusedState();
  state.settings.reduceMotion = true;
  const screen = await mount(state);
  const caught = event([
    { userId: 'me', sessionId: 's-me' },
    { userId: 'minji', sessionId: 'minji' },
  ]);

  await act(async () => {
    onGoldenFish?.(caught);
    onGoldenFish?.(caught);
  });

  assert.equal(screen.getByTestId('golden-self').props.goldenFishCount, 1);
  assert.equal(screen.getByTestId('golden-peer-minji').props.goldenFishCount, 1);
  assert.equal(announce.mock.calls.length, 1);
  await screen.unmount();
  announce.mockRestore();
});

test('시작 응답 전에 받은 당첨을 새 세션이 확정되면 표시한다', async () => {
  const state = focusedState();
  state.session = null;
  const screen = await render(screenElement(state, 'focusSetup'));

  await act(async () =>
    onGoldenFish?.(
      event([
        { userId: 'me', sessionId: 's-me' },
        { userId: 'minji', sessionId: 'minji' },
      ]),
    ),
  );
  assert.equal(screen.queryByTestId('golden-cutscene'), null);

  state.session = focusedState().session;
  await screen.rerender(screenElement(state, 'focus'));
  assert.notEqual(screen.queryByTestId('golden-cutscene'), null);
  await screen.unmount();
});

test('reel 재생 중 휴식과 종료 명령을 reel 종료까지 미룬다', async () => {
  jest.useFakeTimers();
  const members = [
    { userId: 'me', sessionId: 's-me' },
    { userId: 'minji', sessionId: 'minji' },
  ];

  const pauseDispatch = jest.fn();
  const pauseScreen = await render(
    screenElement(focusedState(), 'focus', undefined, jest.fn(), jest.fn(), pauseDispatch),
  );
  await act(async () => onGoldenFish?.(event(members)));
  await fireEvent.press(pauseScreen.getByTestId('golden-cutscene'));
  await fireEvent.press(pauseScreen.getByTestId('pause-focus'));
  assert.equal(pauseDispatch.mock.calls.length, 0);
  await act(async () => jest.advanceTimersByTime(1999));
  assert.equal(pauseDispatch.mock.calls.length, 0);
  await act(async () => jest.advanceTimersByTime(1));
  assert.equal(pauseDispatch.mock.calls[0][0].type, 'PAUSE');
  await pauseScreen.unmount();

  const finishDispatch = jest.fn();
  const finishScreen = await render(
    screenElement(focusedState(), 'focus', undefined, jest.fn(), jest.fn(), finishDispatch),
  );
  await act(async () => onGoldenFish?.(event(members)));
  await fireEvent.press(finishScreen.getByTestId('golden-cutscene'));
  await fireEvent.press(finishScreen.getByTestId('end-focus'));
  assert.equal(finishScreen.queryByTestId('confirm-finish'), null);
  assert.equal(finishDispatch.mock.calls.length, 0);
  await act(async () => jest.advanceTimersByTime(1999));
  assert.equal(finishDispatch.mock.calls.length, 0);
  await act(async () => jest.advanceTimersByTime(1));
  await fireEvent(finishScreen.getByTestId('end-focus'), 'pressIn');
  await act(() => jest.advanceTimersByTime(3000));
  assert.equal(finishDispatch.mock.calls[0][0].type, 'FINISH');
  await finishScreen.unmount();
  jest.useRealTimers();
});

test('마지막 reel 대기 중 도착한 당첨은 대기 종료 뒤 다음 컷신으로 재생한다', async () => {
  jest.useFakeTimers();
  const screen = await mount();
  const members = [
    { userId: 'me', sessionId: 's-me' },
    { userId: 'minji', sessionId: 'minji' },
  ];

  await act(async () => onGoldenFish?.(event(members)));
  await fireEvent.press(screen.getByTestId('golden-cutscene'));
  await act(async () => onGoldenFish?.(event(members, 'golden-i1-2')));
  assert.equal(screen.queryByTestId('golden-cutscene'), null);
  assert.equal(screen.getByTestId('golden-self').props.goldenFishCount, 1);

  await act(async () => jest.advanceTimersByTime(2000));
  assert.notEqual(screen.queryByTestId('golden-cutscene'), null);
  assert.equal(
    screen.getByTestId('golden-self', { includeHiddenElements: true }).props.goldenFishCount,
    1,
  );

  await screen.unmount();
  jest.useRealTimers();
});

test('동작 줄이기에서 휴식 중 쌓인 당첨을 복귀할 때 모두 더미에 반영한다', async () => {
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => {});
  const state = focusedState();
  state.settings.reduceMotion = true;
  const screen = await mount(state);
  state.session!.status = 'paused';
  state.session!.restStartedAt = Date.now();
  await screen.rerender(screenElement(state, 'rest'));

  const members = [
    { userId: 'me', sessionId: 's-me' },
    { userId: 'minji', sessionId: 'minji' },
  ];
  await act(async () => {
    onGoldenFish?.(event(members));
    onGoldenFish?.(event(members, 'golden-i1-2'));
  });

  state.session!.status = 'active';
  delete state.session!.restStartedAt;
  await screen.rerender(screenElement(state, 'focus'));

  assert.equal(screen.queryByTestId('golden-cutscene'), null);
  assert.equal(screen.getByTestId('golden-self').props.goldenFishCount, 2);
  assert.equal(screen.getByTestId('golden-peer-minji').props.goldenFishCount, 2);
  assert.equal(screen.getByTestId('golden-world').props.goldenFish, true);
  assert.equal(announce.mock.calls.length, 1);
  assert.equal(announce.mock.calls[0][0], '황금 물고기를 잡았어요.');
  await screen.unmount();
  announce.mockRestore();
});

test('휴식 전환 중 도착한 당첨을 보존하고 복귀하면 컷신과 섬 에셋을 보여준다', async () => {
  const state = focusedState();
  const screen = await mount(state);
  state.session!.status = 'paused';
  state.session!.restStartedAt = Date.now();
  await screen.rerender(screenElement(state, 'rest'));

  await act(async () =>
    onGoldenFish?.(
      event([
        { userId: 'me', sessionId: 's-me' },
        { userId: 'minji', sessionId: 'minji' },
      ]),
    ),
  );
  assert.equal(screen.queryByTestId('golden-cutscene'), null);

  state.session!.status = 'active';
  delete state.session!.restStartedAt;
  await screen.rerender(screenElement(state, 'focus'));
  assert.notEqual(screen.queryByTestId('golden-cutscene'), null);
  await fireEvent.press(screen.getByTestId('golden-cutscene'));
  assert.equal(screen.getByTestId('golden-world').props.goldenFish, true);
  assert.equal(screen.getByTestId('golden-self').props.goldenFishCount, 1);
  await screen.unmount();
});

test('휴식하러 걷는 중 끝난 컷신은 복귀한 배우의 reel을 2초 보여준다', async () => {
  jest.useFakeTimers();
  const state = focusedState();
  const go = jest.fn();
  const screen = await render(screenElement(state, 'focus', undefined, go));

  await fireEvent.press(screen.getByTestId('pause-focus'));
  await act(async () =>
    onGoldenFish?.(
      event([
        { userId: 'me', sessionId: 's-me' },
        { userId: 'minji', sessionId: 'minji' },
      ]),
    ),
  );
  assert.notEqual(screen.queryByTestId('golden-cutscene'), null);
  await fireEvent.press(screen.getByTestId('golden-cutscene'));
  assert.equal(go.mock.calls.length, 0);

  let walkingSteps = 0;
  while (screen.queryByTestId('golden-self') === null && walkingSteps < 500) {
    await act(async () => jest.advanceTimersByTime(40));
    walkingSteps++;
  }
  assert.ok(walkingSteps > 0);
  assert.notEqual(screen.queryByTestId('golden-self'), null);
  assert.equal(screen.getByTestId('golden-self').props.goldenCatchToken, 'golden-i1-1');
  assert.equal(go.mock.calls.length, 0);

  await act(async () => jest.advanceTimersByTime(1999));
  assert.equal(go.mock.calls.length, 0);
  await act(async () => jest.advanceTimersByTime(1));
  assert.equal(go.mock.calls[0][0], 'rest');

  await screen.unmount();
  jest.useRealTimers();
});

test('휴식 결과 화면은 연속 컷신과 마지막 reel이 끝날 때까지 이탈을 미룬다', async () => {
  jest.useFakeTimers();
  const state = focusedState();
  state.lastResult = {
    id: 's-me',
    islandId: 'soda',
    subject: '수학',
    seconds: 60,
    at: Date.now(),
    fish: 1,
    contributed: true,
  };
  state.resultFromRest = true;
  state.session = null;
  const home = jest.fn();
  const screen = await render(screenElement(state, 'focusResult', undefined, jest.fn(), home));
  const members = [
    { userId: 'me', sessionId: 's-me' },
    { userId: 'minji', sessionId: 'minji' },
  ];

  await act(async () => {
    onGoldenFish?.(event(members));
    onGoldenFish?.(event(members, 'golden-i1-2'));
  });
  await fireEvent.press(screen.getByTestId('golden-cutscene'));
  assert.notEqual(screen.queryByTestId('rest-golden-reel', { includeHiddenElements: true }), null);
  assert.notEqual(
    screen.queryByTestId('rest-golden-reel-rod', { includeHiddenElements: true }),
    null,
  );
  assert.equal(screen.queryByTestId('result-done'), null);
  assert.equal(home.mock.calls.length, 0);

  await act(async () => jest.advanceTimersByTime(2000));
  assert.notEqual(screen.queryByTestId('golden-cutscene', { includeHiddenElements: true }), null);
  await fireEvent.press(screen.getByTestId('golden-cutscene'));
  await act(async () => jest.advanceTimersByTime(1999));
  assert.equal(home.mock.calls.length, 0);
  await act(async () => jest.advanceTimersByTime(1));
  await fireEvent.press(screen.getByTestId('result-done'));
  assert.equal(home.mock.calls.length, 1);

  await screen.unmount();
  jest.useRealTimers();
});

test('세션 종료 직후 결과 화면에 도착한 당첨도 버리지 않는다', async () => {
  const state = focusedState();
  const screen = await mount(state);
  state.lastResult = {
    id: 's-me',
    islandId: 'soda',
    subject: '수학',
    seconds: 60,
    at: Date.now(),
    fish: 1,
    contributed: true,
  };
  state.resultFromRest = true;
  state.session = null;
  await screen.rerender(screenElement(state, 'focusResult'));

  await act(async () =>
    onGoldenFish?.(
      event([
        { userId: 'me', sessionId: 's-me' },
        { userId: 'minji', sessionId: 'minji' },
      ]),
    ),
  );

  assert.notEqual(screen.queryByTestId('golden-cutscene', { includeHiddenElements: true }), null);
  await screen.unmount();
});

test('컷신을 마친 황금 물고기 더미를 정상 결과 화면에서도 유지한다', async () => {
  const state = focusedState();
  const screen = await mount(state);
  await act(async () =>
    onGoldenFish?.(
      event([
        { userId: 'me', sessionId: 's-me' },
        { userId: 'minji', sessionId: 'minji' },
      ]),
    ),
  );
  await fireEvent.press(screen.getByTestId('golden-cutscene'));

  state.lastResult = {
    id: 's-me',
    islandId: 'soda',
    subject: '수학',
    seconds: 60,
    at: Date.now(),
    fish: 1,
    contributed: true,
  };
  state.session = null;
  await screen.rerender(screenElement(state, 'focusResult'));

  const resultActor = screen.getByTestId('golden-self', { includeHiddenElements: true });
  assert.equal(resultActor.props.goldenFishCount, 1);
  assert.equal(resultActor.props.goldenCatchToken, 'golden-i1-1');
  await screen.unmount();
});

test('튜토리얼 5단계에는 「다음」 버튼이 없고 안내 상자 안 집중 시작과 그만 보기만 있다', async () => {
  const state = focusedState();
  state.session = null;
  const setGuideStep = jest.fn();
  const screen = await render(
    screenElement(state, 'fishingArrival', undefined, undefined, undefined, undefined, {
      guideStep: 5,
      setGuideStep,
    }),
  );
  expect(
    screen.getByText('집중하고 싶은 곳으로 걸어가서 아래 집중 시작을 눌러 봐.', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  // 「다음」으로 건너뛸 수 없다 — 걸어가서 집중 시작을 눌러야 7단계(할 일 입력)로 넘어간다
  expect(screen.queryByText('다음', { includeHiddenElements: true })).toBeNull();
  expect(screen.getByTestId('focus-start', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByTestId('guide-skip', { includeHiddenElements: true })).toBeTruthy();
  assert.equal(setGuideStep.mock.calls.length, 0);
  await screen.unmount();
});

// en 스모크 — GROMO-2252: 집중 흐름 튜토리얼·준비 화면이 영문으로도 나오는지 최소 확인(패턴은 Screens.test.tsx 의 describe('en')).
describe('en', () => {
  const mockLocales = jest.requireMock('expo-localization').getLocales as jest.Mock;

  afterEach(() => {
    mockLocales.mockReturnValue([{ languageCode: 'ko', languageTag: 'ko-KR' }]);
    applyLocalePref(null);
  });

  test('en 로케일 — 첫 물고기 튜토리얼 대사와 다음 버튼은 영문으로 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const setGuideStep = jest.fn();
    const screen = await render(
      screenElement(focusedState(), 'focus', undefined, undefined, undefined, undefined, {
        guideStep: 12,
        setGuideStep,
      }),
    );
    expect(
      screen.getByText(
        'You caught your first fish!\nYou can use this fish to help your island grow!',
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText('Next'));
    expect(setGuideStep).toHaveBeenCalledWith(14);
    await screen.unmount();
  });

  test('en 로케일 — 할 일 입력 모달은 영문 placeholder·완료 버튼을 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const state = focusedState();
    state.session = null;
    const setGuideStep = jest.fn(),
      setText = jest.fn(),
      start = jest.fn();
    const props = { guideStep: 7, setGuideStep, setText, focus: { start } };
    const screen = await render(
      screenElement(state, 'focusSetup', undefined, undefined, undefined, undefined, props),
    );
    expect(
      screen.getByPlaceholderText('What will you do? (optional)', { includeHiddenElements: true }),
    ).toBeTruthy();
    await screen.rerender(
      screenElement(state, 'focusSetup', undefined, undefined, undefined, undefined, {
        ...props,
        text: 'Memorize English words',
      }),
    );
    await fireEvent.press(screen.getByText('Done'));
    expect(setGuideStep).toHaveBeenCalledWith(8);
    await screen.unmount();
  });

  // GROMO-2235 r6: 서버 ApiError 의 한국어 message 가 en 로케일에서도 그대로 새지 않고
  // errors.<code> 번역으로 바뀌는지 확인한다(errorTextOr, FocusFlow 의 집중 시작 실패 경로).
  test('en 로케일 — 집중 시작 실패는 서버 한국어 message 대신 오류 코드의 영문 번역을 보여준다', async () => {
    mockLocales.mockReturnValue([{ languageCode: 'en', languageTag: 'en-US' }]);
    applyLocalePref('system');
    const state = focusedState();
    state.session = null;
    const setGuideStep = jest.fn();
    const start = jest
      .fn()
      .mockRejectedValueOnce(new ApiError('GOOGLE_TOKEN', '회원 전환 토큰 오류', 422));
    const screen = await render(
      screenElement(state, 'focusSetup', undefined, undefined, undefined, undefined, {
        guideStep: 8,
        setGuideStep,
        text: 'Memorize English words',
        focus: { start },
      }),
    );
    await fireEvent.press(screen.getByTestId('start-focus', { includeHiddenElements: true }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Your Google login is no longer valid.');
    expect(alert).not.toHaveTextContent('회원 전환 토큰 오류');
    await screen.unmount();
  });
});

test.each(['', '   '])('할 일이 %j이면 기본 주제로 집중을 시작한다', async (text) => {
  const state = focusedState();
  state.session = null;
  const start = jest.fn().mockResolvedValue({});
  const go = jest.fn();
  const screen = await render(
    screenElement(state, 'focusSetup', undefined, go, undefined, undefined, {
      text,
      focus: { start },
    }),
  );
  await fireEvent.press(screen.getByTestId('start-focus'));
  // 고른 자리도 함께 보낸다(GROMO-2478) — 범위 판정은 sessionCommands.start 가 한다
  expect(start).toHaveBeenCalledWith({ subject: '집중', seat: state.focusSpot });
  expect(go).toHaveBeenCalledWith('focus');
  await screen.unmount();
});

test('준비 창 X는 집중 시작 없이 자리 선택으로 돌아간다', async () => {
  const state = focusedState();
  state.session = null;
  const start = jest.fn(),
    replace = jest.fn(),
    setGuideStep = jest.fn();
  const screen = await render(
    screenElement(state, 'focusSetup', undefined, undefined, undefined, undefined, {
      guideStep: 7,
      focus: { start },
      replace,
      setGuideStep,
    }),
  );
  await fireEvent.press(screen.getByTestId('close-focus-setup', { includeHiddenElements: true }));
  expect(start).not.toHaveBeenCalled();
  expect(replace).toHaveBeenCalledWith('fishingArrival');
  expect(setGuideStep).toHaveBeenCalledWith(5);
  await screen.unmount();
});

test('첫 집중 체험도 할 일을 쓰지 않고 건너뛸 수 있다', async () => {
  const state = focusedState();
  state.session = null;
  const start = jest.fn(),
    setGuideStep = jest.fn();
  const screen = await render(
    screenElement(state, 'focusSetup', undefined, undefined, undefined, undefined, {
      guideStep: 7,
      focus: { start },
      setGuideStep,
    }),
  );
  await fireEvent.press(screen.getByText('건너뛰기'));
  expect(setGuideStep).toHaveBeenCalledWith(8);
  expect(start).not.toHaveBeenCalled();
  await screen.unmount();
});

test('도착하면 안내와 하단 집중 시작이 있고, 땅을 누르면 걸어가기만 하며 버튼을 눌러야 그 자리를 검사해 준비 카드로 간다', async () => {
  const state = focusedState();
  state.session = null;
  const go = jest.fn(),
    dispatch = jest.fn(),
    notify = jest.fn();
  const screen = await render(
    screenElement(state, 'fishingArrival', undefined, go, undefined, dispatch, { notify }),
  );
  expect(screen.getByTestId('focus-arrival-hint')).toHaveTextContent('집중할 자리를 골라주세요!');
  // 추천 원은 없다
  expect(screen.queryAllByLabelText('집중할 빈자리')).toHaveLength(0);
  // 내리는 자리(뗏목 옆)에서 바로 누르면 이유 토스트만 뜨고 자리를 저장하지 않는다
  await fireEvent.press(screen.getByTestId('focus-start'));
  expect(notify).toHaveBeenCalledWith('여기는 뗏목을 대는 곳이에요. 조금 옆에 앉아 주세요.');
  expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'FOCUS_SPOT' }));
  expect(go).not.toHaveBeenCalled();
  // 땅을 누르면 걸어가기만 — 준비 카드는 열리지 않는다(목 주민 자리 (40,50)·(41,51)에서 떨어진 빈 땅)
  const target = { x: 22, y: 62 };
  await fireEvent(screen.getByTestId('golden-world'), 'tap', target);
  await act(() => jest.advanceTimersByTime(10000));
  expect(go).not.toHaveBeenCalled();
  // 걸어간 자리에서 집중 시작 → 그 자리를 저장하고 준비 카드
  await fireEvent.press(screen.getByTestId('focus-start'));
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'FOCUS_SPOT', spot: target }),
  );
  expect(go).toHaveBeenCalledWith('focusSetup');
  await screen.unmount();
});

test('휴식 중에는 집중 이어가기만 있고 한 번 누르면 종료 없이 집중섬으로 돌아온다', async () => {
  const state = focusedState();
  state.session!.status = 'paused';
  state.session!.version = 1;
  const resume = jest.fn().mockResolvedValue({}),
    finish = jest.fn();
  const go = jest.fn(),
    home = jest.fn();
  const screen = await render(
    screenElement(state, 'rest', undefined, go, home, undefined, {
      focus: { resume, finish },
    }),
  );
  expect(screen.queryByTestId('end-rest')).toBeNull();
  expect(screen.queryByTestId('confirm-end-rest')).toBeNull();
  await fireEvent.press(screen.getByTestId('resume-focus'));
  expect(resume).toHaveBeenCalledTimes(1);
  expect(finish).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('focus-sailing'));
  expect(go).toHaveBeenCalledWith('focus');
  expect(home).not.toHaveBeenCalled();
  await screen.unmount();
});

test.each([
  { loading: false, error: null, quests: [] },
  { loading: true, error: null, quests: [] },
  { loading: false, error: new Error('network'), quests: [] },
  {
    loading: false,
    error: null,
    quests: [{ title: '아직 진행 중', claimable: false, claimed: false, myRate: 20 }],
  },
])('결과창에 표시할 달성 퀘스트가 없으면 영역과 빈 안내를 숨긴다: %j', async (board) => {
  mockResultBoard = board;
  const state = focusedState();
  state.serverIslands = { currentIslandId: 'soda' } as any;
  state.session = null;
  state.lastResult = {
    id: 's-me',
    islandId: 'soda',
    subject: '독서',
    seconds: 1500,
    fish: 3,
    at: Date.now(),
    contributed: true,
  };
  const screen = await render(
    screenElement(state, 'focusResult', undefined, undefined, undefined, undefined, {
      islands: {},
    }),
  );
  expect(screen.queryByTestId('focus-result-quests')).toBeNull();
  expect(screen.queryByText('달성한 일일 퀘스트')).toBeNull();
  expect(screen.queryByText(/아직 없어요/)).toBeNull();
  expect(screen.getByTestId('focus-result-duration')).toHaveTextContent('00:25:00');
  expect(screen.getByText('+3')).toBeTruthy();
  expect(screen.getByTestId('result-done')).toBeTruthy();
  await screen.unmount();
});

test('결과창은 서버에서 달성 또는 수령한 퀘스트만 보여준다', async () => {
  mockResultBoard.quests = [
    { title: '집중 25분', claimable: true, claimed: false },
    { title: '아침 집중', claimable: false, claimed: true },
    { title: '미달성 퀘스트', claimable: false, claimed: false },
  ];
  const state = focusedState();
  state.serverIslands = { currentIslandId: 'soda' } as any;
  state.session = null;
  const screen = await render(
    screenElement(state, 'focusResult', undefined, undefined, undefined, undefined, {
      islands: {},
    }),
  );
  expect(screen.getByTestId('focus-result-quests')).toContainElement(screen.getByText('집중 25분'));
  expect(screen.getByTestId('focus-result-quests')).toContainElement(screen.getByText('아침 집중'));
  expect(screen.queryByText('미달성 퀘스트')).toBeNull();
  await screen.unmount();
});

test('집중을 마친 뒤 자리 고르기에서는 지난 focusSpot 을 예약하지 않아 그 자리 주민의 seat 를 그대로 그린다 (GROMO-2478)', async () => {
  const state = focusedState();
  state.session = null; // 지난 집중은 끝났고 focusSpot {34.1, 57} 만 남았다
  state.serverIslands = { currentIslandId: 'soda' } as any;
  mockRealPeerActors = true;
  mockPresenceFocus = [
    {
      userId: 'minji',
      name: '민지',
      catColor: 'gray',
      appearance: null,
      sessionId: 's-minji',
      subject: '영어',
      activeSeconds: 0,
      status: 'active',
      anchorMs: Date.now(),
      seat: { x: 34.1, y: 57 },
    },
  ];
  const screen = await render(
    screenElement(state, 'fishingArrival', undefined, undefined, undefined, undefined, {
      islands: {},
    }),
  );
  const { spot } = screen.getByTestId('golden-peer-minji', { includeHiddenElements: true }).props;
  expect([spot.x, spot.y]).toEqual([34.1, 57]);
  await screen.unmount();
});

test('준비 중 내 자리에 밀려난 주민은 준비 창을 닫으면 서버 seat 로 돌아가 그 자리를 점유로 막는다 (GROMO-2478)', async () => {
  const state = focusedState();
  state.session = null; // 준비 중 — focusSpot {34.1, 57} 를 이번에 골랐다
  state.serverIslands = { currentIslandId: 'soda' } as any;
  mockRealPeerActors = true;
  mockPresenceFocus = [
    {
      userId: 'minji',
      name: '민지',
      catColor: 'gray',
      appearance: null,
      sessionId: 's-minji',
      subject: '영어',
      activeSeconds: 0,
      status: 'active',
      anchorMs: Date.now(),
      seat: { x: 34.1, y: 57 },
    },
  ];
  const notify = jest.fn(),
    props = { islands: {}, notify };
  const screen = await render(
    screenElement(state, 'focusSetup', undefined, undefined, undefined, undefined, props),
  );
  const peerAt = () => {
    const { spot } = screen.getByTestId('golden-peer-minji', { includeHiddenElements: true }).props;
    return [spot.x, spot.y];
  };
  expect(peerAt()).not.toEqual([34.1, 57]);
  await screen.rerender(
    screenElement(state, 'fishingArrival', undefined, undefined, undefined, undefined, props),
  );
  expect(peerAt()).toEqual([34.1, 57]);
  // 그 자리까지 걸어가 [집중 시작]을 누르면 주민 자리라 막는다
  await act(async () =>
    screen
      .getByTestId('golden-world', { includeHiddenElements: true })
      .props.onTap({ x: 34.1, y: 57 }),
  );
  await act(() => jest.advanceTimersByTime(10000));
  await fireEvent.press(screen.getByTestId('focus-start'));
  expect(notify).toHaveBeenCalledWith(t('focusFlow.spot.occupied'));
  await screen.unmount();
});

test('격자가 바뀌기 전에 고른 자리가 물 칸이 되면 복구한 내 고양이는 가장 가까운 걸을 수 있는 칸에 앉는다 (GROMO-2516)', async () => {
  const state = focusedState(); // 진행 중 세션, 서버 seat 없음
  state.focusSpot = { x: 34.1, y: 55.9 }; // 옛 기본 자리 — 새 격자에선 연못 물 칸
  const screen = await render(screenElement(state, 'focus'));
  const { spot } = screen.getByTestId('golden-self', { includeHiddenElements: true }).props;
  // 바로 아래 걷기 칸(17열 28행)의 가운데
  expect([spot.x, spot.y]).toEqual([35, 57]);
  await screen.unmount();
});

test('다른 기기에서 시작한 세션을 복구하면 내 고양이는 서버 seat 에 앉고, 옛 focusSpot 에 앉은 주민을 밀어내지 않는다 (GROMO-2478)', async () => {
  const state = focusedState(); // 진행 중 세션 s-me, focusSpot {34.1, 57} 는 지난 세션 좌표
  state.serverIslands = { currentIslandId: 'soda' } as any;
  mockRealPeerActors = true;
  const resident = (userId: string, sessionId: string, seat: { x: number; y: number }) => ({
    userId,
    name: userId,
    catColor: 'gray',
    appearance: null,
    sessionId,
    subject: '영어',
    activeSeconds: 0,
    status: 'active',
    anchorMs: Date.now(),
    seat,
  });
  mockPresenceFocus = [
    resident('me', 's-me', { x: 62.5, y: 43 }), // 다른 기기에서 고른 이번 세션 자리
    resident('minji', 's-minji', { x: 34.1, y: 57 }),
  ];
  const screen = await render(
    screenElement(state, 'focus', undefined, undefined, undefined, undefined, { islands: {} }),
  );
  const at = (testID: string) => {
    const { spot } = screen.getByTestId(testID, { includeHiddenElements: true }).props;
    return [spot.x, spot.y];
  };
  expect(at('golden-self')).toEqual([62.5, 43]);
  expect(at('golden-peer-minji')).toEqual([34.1, 57]);
  // 다른 기기에서 끝내 SESSION_SYNC 가 세션을 먼저 지움 — 아직 집중 화면이고 결과 id 도 없어도 seat 에 그대로 앉아 있다
  mockPresenceFocus = mockPresenceFocus.filter((member) => member.userId !== 'me');
  state.session = null;
  await screen.rerender(
    screenElement(state, 'focus', undefined, undefined, undefined, undefined, { islands: {} }),
  );
  expect(at('golden-self')).toEqual([62.5, 43]);
  expect(at('golden-peer-minji')).toEqual([34.1, 57]);
  // 세션 완료 — 서버가 내 항목을 지우고 결과 화면으로 넘어가도 이번 세션 seat 에 그대로 앉아 있다
  state.lastResult = {
    id: 's-me',
    islandId: 'soda',
    subject: '수학',
    seconds: 60,
    at: Date.now(),
    fish: 1,
    contributed: true,
  };
  state.session = null;
  await screen.rerender(
    screenElement(state, 'focusResult', undefined, undefined, undefined, undefined, {
      islands: {},
    }),
  );
  expect(at('golden-self')).toEqual([62.5, 43]);
  expect(at('golden-peer-minji')).toEqual([34.1, 57]);
  await screen.unmount();
});
