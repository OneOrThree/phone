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
  GoldenFishCutscene: ({ onFinish }: { onFinish: () => void }) => {
    const { Pressable } = require('react-native');
    return <Pressable testID="golden-cutscene" onPress={onFinish} />;
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

const event = (
  members: GoldenFishEvent['members'],
  eventId = 'golden-i1-1',
): GoldenFishEvent => ({
  eventId,
  islandId: 'soda',
  drawnAt: '2026-09-28T00:00:00.000Z',
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

const mount = (state = focusedState()) =>
  render(
    <CurrentScreens
      e={{
        state,
        route: 'focus',
        now: Date.now(),
        dispatch: jest.fn(),
        go: jest.fn(),
        replace: jest.fn(),
        reset: jest.fn(),
        home: jest.fn(),
        back: jest.fn(),
        notify: jest.fn(),
        text: '',
        setText: jest.fn(),
      }}
    />,
  );

beforeEach(async () => {
  onGoldenFish = undefined;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

test('현재 세션 참여자만 컷신을 보고 종료 뒤 참여자 더미와 섬 에셋을 함께 갱신한다', async () => {
  const screen = await mount();

  await act(async () =>
    onGoldenFish?.(event([{ userId: 'other', sessionId: 's-other' }])),
  );
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
  assert.equal(screen.getByTestId('golden-world').props.goldenFish, false);

  await fireEvent.press(screen.getByTestId('golden-cutscene'));
  assert.equal(screen.queryByTestId('golden-cutscene'), null);
  assert.equal(screen.getByTestId('golden-world').props.goldenFish, true);
  assert.equal(screen.getByTestId('golden-self').props.goldenFishCount, 1);
  assert.equal(screen.getByTestId('golden-self').props.goldenCatchToken, 'golden-i1-1');
  assert.equal(screen.getByTestId('golden-peer-minji').props.goldenFishCount, 1);
  assert.equal(screen.getByTestId('golden-peer-minji').props.goldenCatchToken, 'golden-i1-1');
  assert.equal(screen.getByTestId('golden-peer-dubu').props.goldenFishCount, 0);

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
  assert.equal(screen.getByTestId('golden-world').props.goldenFish, false);
  await fireEvent.press(screen.getByTestId('golden-cutscene'));
  assert.equal(screen.getByTestId('golden-self').props.goldenFishCount, 2);
  assert.equal(screen.getByTestId('golden-self').props.goldenCatchToken, 'golden-i1-2');
  assert.equal(screen.getByTestId('golden-peer-minji').props.goldenFishCount, 2);
  await screen.unmount();
});
