// 방문자 화면(GROMO-2263): 섬장 인사말 말풍선은 방문마다 한 번만 뜬다.
import React, { useReducer } from 'react';
import { act, fireEvent, isHiddenFromAccessibility, render } from '@testing-library/react-native';
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

// 안드로이드 뒤로 가기 처리 칸 — App 이 들고 있는 e.backOverride 를 흉내 낸다. App 의 하드웨어 뒤로 가기 핸들러가
// 방문 분기(END_VISIT)보다 먼저 이 칸을 본다(그 쪽은 App.hardwareBack.test.tsx 가 실제 App 으로 확인한다).
const backOverride: { current: (() => boolean) | null } = { current: null };

// 리듀서에 실제로 연결한 하네스 — 화면이 다시 마운트돼도(key) 상태는 이어진다. 보낸 액션 종류도 적어 둔다.
let latest: { state: State; dispatch: (action: any) => void };
let actionTypes: string[] = [];
function Harness({ initial, mounts = 0 }: { initial: State; mounts?: number }) {
  const [state, reduce] = useReducer(reducer, initial);
  const dispatch = (action: any) => {
    actionTypes.push(action.type);
    reduce(action);
  };
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
        backOverride,
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
  actionTypes = [];
  backOverride.current = null;
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

test('인사말이 떠 있는 동안 뒤로 가기 처리가 걸리고, 부르면 방문을 끝내지 않고 팝업만 닫는다', async () => {
  const screen = await render(
    <Harness initial={visitState({ greeting: GREETING, greetingIsDefault: false })} />,
  );
  await screen.findByTestId('visit-greeting');
  expect(typeof backOverride.current).toBe('function');

  let handled: boolean | undefined;
  await act(async () => {
    handled = backOverride.current?.();
  });
  expect(handled).toBe(true); // 처리했다 — App 이 방문 종료로 넘어가지 않는다
  expect(screen.queryByTestId('visit-greeting')).toBeNull(); // 팝업이 닫혔다
  expect(actionTypes).not.toContain('END_VISIT');
  expect(latest.state.visitingIslandId).toBe('v1');
  expect(backOverride.current).toBeNull(); // 닫힌 팝업의 처리는 걷혔다 — 다음 뒤로 가기는 App 이 평소처럼 받는다
});

test('화면이 다시 그려져도(새 now·새 env) 걸린 뒤로 가기 처리는 그대로 팝업을 닫는다', async () => {
  const initial = visitState({ greeting: GREETING, greetingIsDefault: false });
  const screen = await render(<Harness initial={initial} />);
  await screen.findByTestId('visit-greeting');
  const installed = backOverride.current;
  expect(installed).not.toBeNull();

  await screen.rerender(<Harness initial={initial} />);
  await screen.rerender(<Harness initial={initial} />);
  expect(backOverride.current).toBe(installed); // 다시 그려도 같은 처리가 그대로 걸려 있다
  expect(screen.getAllByTestId('visit-greeting')).toHaveLength(1);

  await act(async () => {
    expect(backOverride.current?.()).toBe(true);
  });
  expect(screen.queryByTestId('visit-greeting')).toBeNull();
});

test('방문 화면이 사라지면 걸어 둔 처리도 걷히지만, 그 사이 다른 화면이 건 처리는 건드리지 않는다', async () => {
  const gone = await render(
    <Harness initial={visitState({ greeting: GREETING, greetingIsDefault: false })} />,
  );
  await gone.findByTestId('visit-greeting');
  expect(backOverride.current).not.toBeNull();
  await gone.unmount();
  expect(backOverride.current).toBeNull();

  const other = jest.fn(() => true);
  const screen = await render(
    <Harness initial={visitState({ greeting: GREETING, greetingIsDefault: false })} />,
  );
  await screen.findByTestId('visit-greeting');
  backOverride.current = other; // 다른 화면이 자기 처리를 걸었다
  await screen.unmount();
  expect(backOverride.current).toBe(other);
});

test('인사말이 떠 있는 동안 뒤 지도·가입 버튼은 스크린리더에서 숨고, 닫으면 다시 보인다', async () => {
  const screen = await render(
    <Harness initial={visitState({ greeting: GREETING, greetingIsDefault: false })} />,
  );
  const bubble = await screen.findByTestId('visit-greeting');
  const join = () => screen.getByTestId('visit-join', { includeHiddenElements: true });
  const scene = () => screen.getByTestId('visit-scene', { includeHiddenElements: true });

  // 팝업은 iOS 모달(형제 무시)이고, 뒤 장면 래퍼는 iOS·Android 숨김 속성을 둘 다 건다
  let modal: any = bubble;
  while (modal && !modal.props.accessibilityViewIsModal) modal = modal.parent;
  expect(modal?.props.accessibilityViewIsModal).toBe(true);
  expect(scene().props.accessibilityElementsHidden).toBe(true);
  expect(scene().props.importantForAccessibility).toBe('no-hide-descendants');
  expect(scene().props['aria-hidden']).toBe(true);
  expect(isHiddenFromAccessibility(join())).toBe(true);
  expect(isHiddenFromAccessibility(screen.getByLabelText('닫기'))).toBe(false); // 팝업 안은 읽힌다
  expect(isHiddenFromAccessibility(bubble)).toBe(false);

  await fireEvent.press(screen.getByLabelText('닫기'));
  expect(scene().props.accessibilityElementsHidden).toBe(false);
  expect(scene().props.importantForAccessibility).toBe('auto');
  expect(scene().props['aria-hidden']).toBe(false);
  expect(isHiddenFromAccessibility(join())).toBe(false);
});

test('인사말이 없는 방문은 뒤 장면을 숨기지 않고 뒤로 가기 처리도 걸지 않는다', async () => {
  const screen = await render(<Harness initial={visitState()} />);
  const scene = screen.getByTestId('visit-scene');
  expect(scene.props.accessibilityElementsHidden).toBe(false);
  expect(scene.props.importantForAccessibility).toBe('auto');
  expect(isHiddenFromAccessibility(screen.getByTestId('visit-join'))).toBe(false);
  expect(backOverride.current).toBeNull();
});
