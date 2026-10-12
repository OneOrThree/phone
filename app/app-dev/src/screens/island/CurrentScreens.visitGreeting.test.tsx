// 방문자 화면(GROMO-2263): 섬장 인사말 말풍선은 방문마다 한 번만 뜬다.
import React, { useReducer } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { initialState, reducer, type State } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';

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

const visitState = (island: Record<string, unknown> = {}) => {
  let state = reducer(initialState(true), {
    type: 'ISLAND_SYNC',
    memberships: { items: [], currentIslandId: null, nextCursor: null, lossReason: null },
  });
  state = reducer(state, {
    type: 'ISLAND_VISIT',
    visit: {
      island: {
        id: 'v1',
        name: '구경',
        intro: '',
        memberCount: 3,
        maxMembers: 15,
        approvalRequired: false,
        membershipStatus: 'none',
        ...island,
      },
      buildings: ['hall', 'board'],
      members: { items: [], nextCursor: null, version: 1 },
      joinRequestAvailability: 'available',
      joinRequest: null,
    },
  } as any);
  return reducer(state, { type: 'SERVER_VISITING', islandId: 'v1' } as any) as State;
};

// 리듀서에 실제로 연결한 하네스 — 화면이 다시 마운트돼도(key) 상태는 이어진다.
let latest: { state: State; dispatch: (action: any) => void };
function Harness({ initial, mounts = 0 }: { initial: State; mounts?: number }) {
  const [state, dispatch] = useReducer(reducer, initial);
  latest = { state, dispatch };
  return (
    <CurrentScreens
      key={mounts}
      e={{
        state,
        route: 'visitIsland',
        detail: 'v1',
        now: Date.now(),
        dispatch,
        go: jest.fn(),
        replace: jest.fn(),
        reset: jest.fn(),
        home: jest.fn(),
        back: jest.fn(),
        backOverride: { current: null },
        notify: jest.fn(),
        text: '',
        setText: jest.fn(),
        islands: { join: jest.fn(), cancel: jest.fn() },
      }}
    />
  );
}

const GREETING = '어서 와요, 같이 집중해요 🐟';

beforeEach(async () => {
  jest.clearAllMocks();
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

test('방문 모드에 들어가면 섬장 인사말이 한 번 뜨고, 닫으면 재렌더·재마운트에도 다시 안 뜬다', async () => {
  const initial = visitState({ greeting: GREETING, greetingIsDefault: false });
  const screen = await render(<Harness initial={initial} />);

  const bubble = await screen.findByTestId('visit-greeting');
  expect(bubble.props.children).toBe(GREETING);
  expect(screen.getByText('섬장의 인사말')).toBeTruthy();
  expect(latest.state.visitGreeted).toBe(true);

  // 그냥 다시 그려도 그대로(닫기 전) — 중복으로 쌓이지 않는다
  await screen.rerender(<Harness initial={initial} />);
  expect(screen.getAllByTestId('visit-greeting')).toHaveLength(1);

  await fireEvent.press(screen.getByLabelText('닫기'));
  expect(screen.queryByTestId('visit-greeting')).toBeNull();
  await screen.rerender(<Harness initial={initial} />);
  expect(screen.queryByTestId('visit-greeting')).toBeNull();

  // 게시판·낚시 구경에서 돌아와 방문 화면이 다시 마운트돼도 이번 방문엔 또 안 띄운다
  await screen.rerender(<Harness initial={initial} mounts={1} />);
  expect(screen.queryByTestId('visit-greeting')).toBeNull();
  await screen.rerender(<Harness initial={initial} mounts={2} />);
  expect(screen.queryByTestId('visit-greeting')).toBeNull();
});

test('새 방문(구경 끝 뒤 다시 방문)이면 인사말이 다시 한 번 뜬다', async () => {
  const initial = visitState({ greeting: GREETING, greetingIsDefault: false });
  const screen = await render(<Harness initial={initial} />);
  await screen.findByTestId('visit-greeting');
  await fireEvent.press(screen.getByLabelText('닫기'));
  expect(screen.queryByTestId('visit-greeting')).toBeNull();

  await act(async () => {
    latest.dispatch({ type: 'END_VISIT' });
    latest.dispatch({ type: 'SERVER_VISITING', islandId: 'v1' });
  });
  await screen.findByTestId('visit-greeting');
});

test('섬장이 안 쓴 섬의 합성된 기본 인사말도 똑같이 한 번 뜬다', async () => {
  const text = '구경섬에 온 걸 환영해요! 같이 집중해요 🐟';
  const screen = await render(
    <Harness initial={visitState({ greeting: text, greetingIsDefault: true })} />,
  );
  expect((await screen.findByTestId('visit-greeting')).props.children).toBe(text);
});

test('구서버(greeting 없음)나 빈 인사말이면 말풍선도 방문 표식도 만들지 않는다', async () => {
  const old = await render(<Harness initial={visitState()} />);
  expect(old.queryByTestId('visit-greeting')).toBeNull();
  expect(latest.state.visitGreeted).toBeUndefined();
  await old.unmount();

  const blank = await render(<Harness initial={visitState({ greeting: '   ' })} />);
  expect(blank.queryByTestId('visit-greeting')).toBeNull();
  expect(latest.state.visitGreeted).toBeUndefined();
});
