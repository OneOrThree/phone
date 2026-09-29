import assert from 'node:assert/strict';
import React, { useReducer } from 'react';
import { AccessibilityInfo, AppState, type AppStateEvent, type AppStateStatus } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { initialState, reducer, type State } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';
import type { GoldenFishEvent } from '@/services/islandRealtime';

let onGoldenFish: ((event: GoldenFishEvent) => void) | undefined;

jest.mock('@/screens/focus/useIslandPresence', () => ({
  catColor: (color: string) => color,
  useIslandPresence: (opts: { onGoldenFish?: (event: GoldenFishEvent) => void }) => {
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
    FishingActor: ({ name, goldenFishCount, goldenCatchToken }: any) => (
      <View
        testID={name === '나' ? 'golden-self' : `golden-actor-${name}`}
        goldenFishCount={goldenFishCount}
        goldenCatchToken={goldenCatchToken}
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
  ['start', 8, 'focusSetup', 'start-focus'],
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
    if (command === 'start') seed.session = null;
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
