// 낚시 화면에서 진행 중이던 내 집중 세션이 서버에 의해 강제 종료되면(강퇴 등) 실시간
// focus.member.updated completed 이벤트로 이를 감지해, 계속 흐르는 타이머·원시 오류 토스트 없이
// 안내와 함께 화면을 빠져나간다.
import assert from 'node:assert/strict';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { initialState, type State } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';
import type { IslandPresenceTransition } from '@/services/islandRealtime';

let onTransition: ((transition: IslandPresenceTransition) => void) | undefined;

jest.mock('@/screens/focus/useIslandPresence', () => ({
  catColor: (color: string) => color,
  useIslandPresence: (opts: { onTransition?: (transition: any) => void }) => {
    onTransition = opts.onTransition;
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

const kickedTransition = (): IslandPresenceTransition => ({
  source: 'event',
  kind: 'focus',
  userId: 'me',
  previous: {
    userId: 'me',
    name: null,
    catColor: null,
    appearance: null,
    sessionId: 's-me',
    subject: '수학',
    activeSeconds: 42,
    status: 'active',
    anchorMs: Date.now(),
  },
  current: null,
});

const mount = async (state: State, extra: Record<string, unknown> = {}) => {
  const dispatch = jest.fn();
  const notify = jest.fn();
  const home = jest.fn();
  const reset = jest.fn();
  const screen = await render(
    <CurrentScreens
      e={{
        state,
        route: 'focus',
        now: Date.now(),
        dispatch,
        go: jest.fn(),
        replace: jest.fn(),
        reset,
        home,
        back: jest.fn(),
        backOverride: { current: null },
        notify,
        text: '',
        setText: jest.fn(),
        islands: {},
        ...extra,
      }}
    />,
  );
  return { screen, dispatch, notify, home, reset };
};

beforeEach(async () => {
  jest.clearAllMocks();
  onTransition = undefined;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

test('진행 중 낚시 세션이 서버에 의해 강제 종료되면 안내하고 화면을 빠져나간다', async () => {
  const { dispatch, notify, home } = await mount(serverFocusState());
  assert.ok(onTransition, 'onTransition 콜백이 useIslandPresence 로 전달돼야 한다');

  onTransition!(kickedTransition());

  assert.ok(
    dispatch.mock.calls.some((call) => call[0].type === 'SESSION_SYNC' && call[0].session === null),
    'SESSION_SYNC(session:null) 로 로컬 세션을 지워야 한다',
  );
  assert.ok(
    notify.mock.calls.some((call) => call[0] === '집중이 종료됐어요. 섬 소속을 확인해 주세요.'),
    '원시 코드가 아니라 사람이 읽을 안내를 보여줘야 한다',
  );
  assert.equal(home.mock.calls.length, 1);
});

test('내가 직접 집중 종료를 부른 뒤 응답 전에 도착한 같은 완료 이벤트는 강퇴로 취급하지 않는다', async () => {
  let resolveFinish: (() => void) | undefined;
  const finish = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveFinish = resolve;
      }),
  );
  const { screen, dispatch, notify, home, reset } = await mount(serverFocusState(), {
    focus: { finish },
  });

  await fireEvent.press(screen.getByTestId('end-focus'));
  await fireEvent.press(screen.getByTestId('confirm-finish'));
  assert.equal(finish.mock.calls.length, 1);

  onTransition!(kickedTransition());
  assert.ok(
    !dispatch.mock.calls.some(
      (call) => call[0].type === 'SESSION_SYNC' && call[0].session === null,
    ),
    '내가 부른 finish() 응답 전에는 강퇴 처리를 하지 않아야 한다',
  );
  assert.ok(
    !notify.mock.calls.some((call) => call[0] === '집중이 종료됐어요. 섬 소속을 확인해 주세요.'),
  );
  assert.equal(home.mock.calls.length, 0);

  resolveFinish?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(reset.mock.calls[0]?.[0], 'focusResult');
});

test('종료 요청 중 무시한 완료 이벤트가 있고 finish()가 실패하면 그 종료를 뒤늦게 처리한다', async () => {
  let rejectFinish: ((error: unknown) => void) | undefined;
  const finish = jest.fn(
    () =>
      new Promise<void>((_, reject) => {
        rejectFinish = reject;
      }),
  );
  const { screen, dispatch, notify, home } = await mount(serverFocusState(), {
    focus: { finish },
  });

  await fireEvent.press(screen.getByTestId('end-focus'));
  await fireEvent.press(screen.getByTestId('confirm-finish'));
  onTransition!(kickedTransition());
  assert.equal(home.mock.calls.length, 0);

  await act(async () => {
    rejectFinish?.({ message: '소속이 없어요.' });
  });

  assert.ok(
    dispatch.mock.calls.some((call) => call[0].type === 'SESSION_SYNC' && call[0].session === null),
  );
  assert.ok(
    notify.mock.calls.some((call) => call[0] === '집중이 종료됐어요. 섬 소속을 확인해 주세요.'),
  );
  assert.ok(!notify.mock.calls.some((call) => call[0] === '소속이 없어요.'));
  assert.equal(home.mock.calls.length, 1);
});

test('종료 확인을 연달아 눌러도 finish()는 한 번만 부른다', async () => {
  const finish = jest.fn(() => new Promise<void>(() => {}));
  const { screen } = await mount(serverFocusState(), { focus: { finish } });

  await fireEvent.press(screen.getByTestId('end-focus'));
  await fireEvent.press(screen.getByTestId('confirm-finish'));
  await fireEvent.press(screen.getByTestId('confirm-finish'));

  assert.equal(finish.mock.calls.length, 1);
});

test('내가 종료한 세션의 완료 이벤트가 finish() 응답 뒤에 늦게 와도 강퇴로 취급하지 않는다', async () => {
  const finish = jest.fn(() => Promise.resolve());
  const { screen, notify, home, reset } = await mount(serverFocusState(), { focus: { finish } });

  await fireEvent.press(screen.getByTestId('end-focus'));
  await fireEvent.press(screen.getByTestId('confirm-finish'));
  await act(async () => {});
  assert.equal(reset.mock.calls[0]?.[0], 'focusResult');

  onTransition!(kickedTransition());

  assert.ok(
    !notify.mock.calls.some((call) => call[0] === '집중이 종료됐어요. 섬 소속을 확인해 주세요.'),
  );
  assert.equal(home.mock.calls.length, 0);
});
