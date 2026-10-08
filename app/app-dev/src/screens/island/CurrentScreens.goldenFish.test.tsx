import assert from 'node:assert/strict';
import React, { useReducer, useState } from 'react';
import { AccessibilityInfo, AppState, type AppStateEvent, type AppStateStatus } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { applyLocalePref } from '@/i18n';
import { initialState, reducer, type State } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';
import type { GoldenFishEvent } from '@/services/islandRealtime';

let onGoldenFish: ((event: GoldenFishEvent) => void) | undefined;
let presenceActive: boolean | undefined;

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
      focus: [],
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
    FishingIsland: ({ goldenFish, children, overlay, onRaft }: any) => (
      <View testID="golden-world" goldenFish={goldenFish} onRaft={onRaft}>
        {children(640, 640 / 1.5, 1)}
        {overlay?.(() => ({ x: 150, y: 200 }), 640)}
      </View>
    ),
    FishingActor: ({
      name,
      goldenFishCount,
      goldenCatchToken,
      motion,
      tutorialFish,
      caughtFish,
    }: any) => (
      <View
        testID={name === '나' ? 'golden-self' : `golden-actor-${name}`}
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
        goldenFishCount={goldenFishCount}
        goldenCatchToken={goldenCatchToken}
      />
    ),
    FishingWalker: () => <View />,
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
  state.focusSpot = { x: 34.1, y: 55.9 };
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
  jest.clearAllMocks();
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
  await fireEvent.press(screen.getByTestId('end-focus', { includeHiddenElements: true }));
  await screen.rerender(
    screenElement(state, 'focus', undefined, undefined, undefined, undefined, {
      ...props,
      guideStep: 18,
    }),
  );
  setGuideStep.mockClear();
  await fireEvent.press(screen.getByTestId('confirm-finish', { includeHiddenElements: true }));
  expect(setGuideStep).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('confirm-finish', { includeHiddenElements: true }));
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
  expect(alert).toHaveTextContent('네트워크 연결 실패');
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
  await fireEvent.press(screen.getByTestId('end-focus', { includeHiddenElements: true }));
  expect(pause).not.toHaveBeenCalled();
  expect(screen.queryByTestId('confirm-finish', { includeHiddenElements: true })).toBeNull();
  await screen.unmount();
});

test('종료 확인 취소는 17단계로 돌아가며 다시 종료할 수 있다', async () => {
  const state = focusedState();
  const setGuideStep = jest.fn();
  const props = { guideStep: 17, setGuideStep };
  const element = (guideStep: number) =>
    screenElement(state, 'focus', undefined, undefined, undefined, undefined, {
      ...props,
      guideStep,
    });
  const screen = await render(element(17));
  await fireEvent.press(screen.getByTestId('end-focus', { includeHiddenElements: true }));
  expect(setGuideStep).toHaveBeenLastCalledWith(18);
  await screen.rerender(element(18));
  await fireEvent.press(screen.getByText('계속하기'));
  expect(setGuideStep).toHaveBeenLastCalledWith(17);
  expect(screen.queryByTestId('confirm-finish', { includeHiddenElements: true })).toBeNull();
  await screen.rerender(element(17));
  await fireEvent.press(screen.getByTestId('end-focus', { includeHiddenElements: true }));
  expect(setGuideStep).toHaveBeenLastCalledWith(18);
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
  ['finish', 17, 'focus', 'confirm-finish'],
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
    if (command === 'finish')
      await fireEvent.press(screen.getByTestId('end-focus', { includeHiddenElements: true }));
    await fireEvent.press(screen.getByTestId(button, { includeHiddenElements: true }));
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
  expect(screen.getByText('+2마리', { includeHiddenElements: true })).toBeTruthy();
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
  await fireEvent.press(screen.getByTestId('end-focus', { includeHiddenElements: true }));
  await fireEvent.press(screen.getByTestId('confirm-finish', { includeHiddenElements: true }));
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
  await fireEvent.press(finishScreen.getByTestId('confirm-finish'));
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
      screen.getByPlaceholderText('e.g. Memorize English words', { includeHiddenElements: true }),
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
});
