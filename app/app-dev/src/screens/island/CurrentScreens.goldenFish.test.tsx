import assert from 'node:assert/strict';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { initialState, type State } from '@/services/model';
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
    FishingIsland: ({ goldenFish, children }: any) => (
      <View testID="golden-world" goldenFish={goldenFish}>
        {children(640, 640 / 1.5, 1)}
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
  route: 'focus' | 'rest' | 'focusResult' = 'focus',
  backOverride?: { current: (() => boolean) | null },
  goOverride = jest.fn(),
  homeOverride = jest.fn(),
) => (
  <CurrentScreens
    e={{
      state,
      route,
      now: Date.now(),
      dispatch: jest.fn(),
      go: goOverride,
      replace: jest.fn(),
      reset: jest.fn(),
      home: homeOverride,
      back: jest.fn(),
      backOverride,
      notify: jest.fn(),
      text: '',
      setText: jest.fn(),
    }}
  />
);

const mount = (state = focusedState(), backOverride?: { current: (() => boolean) | null }) =>
  render(screenElement(state, 'focus', backOverride));

beforeEach(async () => {
  onGoldenFish = undefined;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

afterEach(() => jest.useRealTimers());

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

test('원장 폴백 뒤 도착한 realtime 참여자를 중복 컷신 없이 더미에 병합한다', async () => {
  const screen = await mount();
  const selfOnly = event([{ userId: 'me', sessionId: 's-me' }], 'ledger:wallet-1');
  const realtime = event([
    { userId: 'me', sessionId: 's-me' },
    { userId: 'minji', sessionId: 'minji' },
  ]);

  await act(async () => onGoldenFish?.(selfOnly));
  await act(async () => onGoldenFish?.(realtime));

  assert.notEqual(screen.queryByTestId('golden-cutscene'), null);
  assert.equal(
    screen.getByTestId('golden-peer-minji', { includeHiddenElements: true }).props.goldenFishCount,
    0,
  );
  await fireEvent.press(screen.getByTestId('golden-cutscene'));
  assert.equal(screen.queryByTestId('golden-cutscene'), null);
  assert.equal(screen.getByTestId('golden-self').props.goldenFishCount, 1);
  assert.equal(screen.getByTestId('golden-peer-minji').props.goldenFishCount, 1);
  await screen.unmount();
});

test('동작 줄이기에서는 컷신 없이 황금 물고기 더미만 즉시 반영한다', async () => {
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
  await screen.unmount();
});

test('동작 줄이기에서 휴식 중 쌓인 당첨을 복귀할 때 모두 더미에 반영한다', async () => {
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
  await screen.unmount();
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

test('휴식하러 걷는 중 시작한 컷신이 끝날 때까지 화면 전환을 미룬다', async () => {
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
  await act(async () => jest.runAllTimers());

  assert.equal(go.mock.calls.length, 0);
  assert.notEqual(screen.queryByTestId('golden-cutscene'), null);
  await fireEvent.press(screen.getByTestId('golden-cutscene'));
  assert.equal(go.mock.calls.length, 0);
  await act(async () => jest.advanceTimersByTime(2000));
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
  await fireEvent.press(screen.getByTestId('result-done'));
  assert.equal(home.mock.calls.length, 0);

  await act(async () => jest.advanceTimersByTime(2000));
  assert.notEqual(screen.queryByTestId('golden-cutscene', { includeHiddenElements: true }), null);
  await fireEvent.press(screen.getByTestId('golden-cutscene'));
  await act(async () => jest.advanceTimersByTime(1999));
  assert.equal(home.mock.calls.length, 0);
  await act(async () => jest.advanceTimersByTime(1));
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
