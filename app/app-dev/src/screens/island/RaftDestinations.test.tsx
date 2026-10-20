import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render as renderNative } from '@testing-library/react-native';
import { RaftDestinations } from '@/screens/island/RaftDestinations';
import { initialState, reducer } from '@/services/model';
import { applyLocalePref } from '@/i18n';
import { ApiError } from '@/services/api/client';

const render = (ui: React.ReactElement) =>
  renderNative(ui, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 402, height: 874 },
          insets: { top: 44, bottom: 34, left: 0, right: 0 },
        }}
      >
        {children}
      </SafeAreaProvider>
    ),
  });

// 세션 세대를 테스트가 바꿀 수 있게 한다(나머지 export 는 실제 구현 유지).
let mockGeneration = 0;
jest.mock('@/services/api/session', () => ({
  ...jest.requireActual('@/services/api/session'),
  sessionGeneration: () => mockGeneration,
}));
beforeEach(() => {
  mockGeneration = 0;
});

jest.mock('@/screens/world/WorldViews', () => ({
  Sailing: ({ destination, from, onArrive }: any) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID="sailing" onPress={onArrive}>
        <Text>{destination}</Text>
        <Text testID="sailing-from">{from}</Text>
      </Pressable>
    );
  },
}));

const isl = (id: string, name: string, extra: object = {}) => ({
  id,
  name,
  intro: '',
  memberCount: 1,
  maxMembers: 15,
  approvalRequired: false,
  ...extra,
});

function env(visitingId: string | null = null) {
  let state = reducer(initialState(true), {
    type: 'ISLAND_SYNC',
    memberships: {
      items: [
        isl('a', '하나', { arrivedBefore: true }),
        isl('b', '둘', { arrivedBefore: true }),
        isl('c', '셋', { arrivedBefore: false }),
        isl('d', '넷'),
      ],
      currentIslandId: 'a',
      nextCursor: null,
      lossReason: null,
    },
  });
  if (visitingId) state = { ...state, visitingIslandId: visitingId };
  return {
    state,
    dispatch: jest.fn(),
    reset: jest.fn(),
    go: jest.fn(),
    back: jest.fn(),
    home: jest.fn(),
    notify: jest.fn(),
    replace: jest.fn(),
    backOverride: { current: null as null | (() => boolean) },
    islands: { switchCurrent: jest.fn().mockResolvedValue(undefined) },
  };
}

async function renderMembers(e: any) {
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByLabelText('소속 섬으로'));
  return screen;
}
async function pressSea(screen: any) {
  const close = screen.queryByLabelText('닫기');
  if (close) await fireEvent.press(close);
  await fireEvent.press(screen.getByLabelText('바다로 출항'));
}

test('두 목적지를 표시하고 임시 메뉴는 제거한다', async () => {
  const e = env();
  const screen = await render(<RaftDestinations e={e} />);
  expect(screen.getByText('어디로 떠나볼까요?')).toBeTruthy();
  expect(screen.getByLabelText('집중하러 가기')).toBeTruthy();
  expect(screen.getByLabelText('바다로 출항')).toBeTruthy();
  for (const old of ['망원경', '내 뗏목', '구경 끝내기'])
    expect(screen.queryByText(old)).toBeNull();
  await fireEvent.press(screen.getByLabelText('집중하러 가기'));
  expect(e.go).toHaveBeenCalledWith('focusTravel');
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'RAFT_DESTINATION', destination: 'focus' });
});

test('소속 섬 창은 도착한 섬만 보여 주며 지금 섬으로도 돌아갈 수 있다', async () => {
  const screen = await renderMembers(env());
  expect(screen.getByText('둘섬으로')).toBeTruthy();
  expect(screen.getByText('넷섬으로')).toBeTruthy();
  expect(screen.getByText('하나섬으로')).toBeTruthy();
  expect(screen.queryByText('셋섬으로')).toBeNull();
  expect(screen.queryByLabelText('바다로 출항')).toBeNull();
});

test('「○○섬으로」는 switchCurrent 뒤 항해 연출을 거쳐 home 으로 reset 한다', async () => {
  const e = env();
  const screen = await renderMembers(e);
  await fireEvent.press(screen.getByText('둘섬으로'));
  expect(e.islands.switchCurrent).toHaveBeenCalledWith('b');
  await fireEvent.press(await screen.findByTestId('sailing'));
  expect(e.reset).toHaveBeenCalledWith('home');
  expect(e.dispatch).not.toHaveBeenCalledWith({ type: 'END_VISIT' });
});

test('거절되면 서버 문구를 알리고 연출하지 않는다', async () => {
  const e = env();
  e.islands.switchCurrent.mockRejectedValue(
    new ApiError('ISLAND_NOT_ARRIVED', '아직 가 본 적 없는 섬이에요.', 403),
  );
  const screen = await renderMembers(e);
  await fireEvent.press(screen.getByText('둘섬으로'));
  await act(async () => {});
  expect(e.notify).toHaveBeenCalledWith('아직 가 본 적 없는 섬이에요. 망원경에서 항해해 주세요.');
  expect(screen.queryByTestId('sailing')).toBeNull();
});

test('방문 중에는 소속 섬 전부(방문 섬 포함, 미도착 제외)만 보이고 떠나면 END_VISIT 한다', async () => {
  const e = env('b');
  const screen = await renderMembers(e);
  expect(screen.getByText('하나섬으로')).toBeTruthy();
  expect(screen.getByText('둘섬으로')).toBeTruthy();
  expect(screen.getByText('넷섬으로')).toBeTruthy();
  expect(screen.queryByText('셋섬으로')).toBeNull();
  expect(screen.queryByLabelText('집중하러 가기')).toBeNull();
  expect(screen.queryByText('망원경')).toBeNull();
  expect(screen.queryByText('내 뗏목')).toBeNull();
  await fireEvent.press(screen.getByText('하나섬으로'));
  await fireEvent.press(await screen.findByTestId('sailing'));
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
  expect(e.reset).toHaveBeenCalledWith('home');
});

test('방문 중 시트를 닫으면 방문 섬 지도로, 항해 중 뒤로가기는 삼킨다', async () => {
  const e = env('b');
  const screen = await renderMembers(e);
  expect(e.backOverride.current).toEqual(expect.any(Function));
  await fireEvent.press(screen.getByText('하나섬으로'));
  await screen.findByTestId('sailing');
  expect(e.backOverride.current?.()).toBe(true);
  expect(e.home).not.toHaveBeenCalled();
});

test('이동 요청 중에는 닫기·뒤로가기·다른 행이 막히고 완료 뒤 항해로 간다', async () => {
  const e = env('b');
  let finish!: () => void;
  e.islands.switchCurrent.mockReturnValue(new Promise<void>((r) => (finish = r)));
  const screen = await renderMembers(e);
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.backOverride.current?.()).toBe(true);
  expect(screen.queryByText('어느 섬으로 갈까요?')).toBeNull();
  await fireEvent.press(screen.getByLabelText('바다로 출항'));
  expect(e.reset).not.toHaveBeenCalled();
  expect(e.islands.switchCurrent).toHaveBeenCalledTimes(1);
  expect(e.replace).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(await screen.findByTestId('sailing')).toBeTruthy();
});

// 서버 방문 상태 — 실제 리듀서로 dispatch 를 반영해, 사이에 다른 액션이 끼어도(상태 깊은 복사) 확인 여부가 남는지 본다.
function visitEnv({
  items = [] as object[],
  currentIslandId = null as string | null,
  membershipStatus = 'none',
  island = {} as object,
  joinRequest = null as object | null,
} = {}) {
  let state = reducer(initialState(true), {
    type: 'ISLAND_SYNC',
    memberships: { items, currentIslandId, nextCursor: null, lossReason: null },
  });
  state = reducer(state, {
    type: 'ISLAND_VISIT',
    visit: { island: isl('v', '구경섬', { membershipStatus, ...island }), joinRequest },
  });
  state = reducer(state, { type: 'SERVER_VISITING', islandId: 'v' });
  const base = env();
  const e: any = {
    ...base,
    state,
    confirm: jest.fn(),
    islands: {
      ...base.islands,
      join: jest.fn().mockResolvedValue({ status: 'active' }),
      cancel: jest.fn(),
    },
  };
  e.dispatch = jest.fn((a: any) => {
    e.state = reducer(e.state, a);
  });
  return e;
}

test('가입하지 않은 섬을 구경하다 떠날 때 확인창은 방문당 1번만 뜬다(사이에 다른 dispatch 가 있어도)', async () => {
  const e = visitEnv({
    items: [isl('a', '하나', { arrivedBefore: true })],
    currentIslandId: 'a',
  });
  const screen = await renderMembers(e);
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.confirm).toHaveBeenCalledTimes(1);
  expect(e.confirm.mock.calls[0][0]).toBe('가입하지 않고 떠날까요?');
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'VISIT_LEAVE_ASKED' });
  expect(e.islands.switchCurrent).not.toHaveBeenCalled();
  // 앱 루트의 가입 확인창을 네이티브 소속 섬 선택창이 덮지 않아야 한다.
  expect(screen.queryByText('어느 섬으로 갈까요?')).toBeNull();
  // 리듀서가 매 액션마다 상태를 깊은 복사한다 — 방문 중 다른 액션이 끼어도 다시 묻지 않는다
  await act(async () => e.dispatch({ type: 'TRAVEL_FROM', name: '구경섬' }));
  await screen.rerender(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByLabelText('소속 섬으로'));
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.confirm).toHaveBeenCalledTimes(1);
  expect(e.islands.switchCurrent).toHaveBeenCalledWith('a');
  // 시트를 닫았다 다시 열어도(같은 방문) 바로 떠난다
  await screen.unmount();
  const again = await renderMembers(e);
  await fireEvent.press(again.getByText('하나섬으로'));
  expect(e.confirm).toHaveBeenCalledTimes(1);
  expect(e.islands.switchCurrent).toHaveBeenCalledTimes(2);
});

test('확인창을 거쳐 「떠나기」를 고르면 그때 이동한다', async () => {
  const e = visitEnv({
    items: [isl('a', '하나', { arrivedBefore: true })],
    currentIslandId: 'a',
  });
  const screen = await renderMembers(e);
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.confirm.mock.calls[0][3]).toEqual({
    ok: '떠나기',
    cancel: '이 섬에 가입',
    onCancel: expect.any(Function),
  });
  await act(async () => e.confirm.mock.calls[0][2]());
  expect(e.islands.switchCurrent).toHaveBeenCalledWith('a');
  expect(e.islands.join).not.toHaveBeenCalled();
});

test('확인창의 취소 자리는 가입 버튼이고 누르면 가입만 한다(떠나기 동작은 돌리지 않는다)', async () => {
  const e = visitEnv();
  const screen = await renderMembers(e);
  await pressSea(screen);
  const opts = e.confirm.mock.calls[0][3];
  expect(opts.cancel).toBe('이 섬에 가입');
  await act(async () => opts.onCancel());
  expect(e.islands.join).toHaveBeenCalledTimes(1);
  expect(e.islands.join).toHaveBeenCalledWith('v', { showApproval: false });
  // 바로 가입이면 가입 훅이 구경을 끝내고 홈으로 보낸다 — endVisit 이었다면 소속 섬이 없어 chooseIsland 였다
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
  expect(e.reset).toHaveBeenCalledTimes(1);
  expect(e.reset).toHaveBeenCalledWith('home');
  expect(e.notify).toHaveBeenCalledWith('구경섬 주민이 됐어요');
  expect(e.islands.switchCurrent).not.toHaveBeenCalled();
});

test('승인제 섬이면 가입 버튼 글자는 「가입 신청」이고 신청만 보내고 구경은 이어진다', async () => {
  const e = visitEnv({
    items: [isl('a', '하나', { arrivedBefore: true })],
    currentIslandId: 'a',
    island: { approvalRequired: true },
  });
  e.islands.join.mockResolvedValue({ status: 'pending' });
  const screen = await renderMembers(e);
  await fireEvent.press(screen.getByText('하나섬으로'));
  const opts = e.confirm.mock.calls[0][3];
  expect(opts.cancel).toBe('가입 신청');
  await act(async () => opts.onCancel());
  expect(e.islands.join).toHaveBeenCalledTimes(1);
  expect(e.notify).toHaveBeenCalledWith('참여 신청이 완료됐어요. 방장이 확인하면 알려드릴게요.');
  expect(e.reset).not.toHaveBeenCalled();
  expect(e.islands.switchCurrent).not.toHaveBeenCalled();
});

test('정원이 찬 섬이면 취소 자리는 기본 「취소」다(가입 버튼 없음)', async () => {
  const full = visitEnv({ island: { maxMembers: 1, memberCount: 1 } });
  const screen = await renderMembers(full);
  await pressSea(screen);
  expect(full.confirm).toHaveBeenCalledTimes(1);
  expect(full.confirm.mock.calls[0][3]).toEqual({ ok: '떠나기' });
});

test('가입 신청을 이미 낸 사람은 membershipStatus 가 아직 none 이어도 확인 없이 떠난다', async () => {
  const request = { id: 'r1', islandId: 'v', status: 'pending', version: 1 };
  // 소속 섬으로 이동
  const move = visitEnv({
    items: [isl('a', '하나', { arrivedBefore: true })],
    currentIslandId: 'a',
    joinRequest: request,
  });
  const moveScreen = await renderMembers(move);
  await fireEvent.press(moveScreen.getByText('하나섬으로'));
  expect(move.confirm).not.toHaveBeenCalled();
  expect(move.dispatch).not.toHaveBeenCalledWith({ type: 'VISIT_LEAVE_ASKED' });
  expect(move.islands.switchCurrent).toHaveBeenCalledWith('a');
  await moveScreen.unmount();

  // 구경 끝내기
  const end = visitEnv({ joinRequest: request });
  const endScreen = await renderMembers(end);
  await pressSea(endScreen);
  expect(end.confirm).not.toHaveBeenCalled();
  expect(end.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
  expect(end.reset).toHaveBeenCalledWith('sea');
});

test.each(['pending', 'active'])(
  '가입 상태가 %s 면 확인창 없이 떠난다',
  async (membershipStatus) => {
    const e = visitEnv({
      items: [isl('a', '하나', { arrivedBefore: true })],
      currentIslandId: 'a',
      membershipStatus,
    });
    const screen = await renderMembers(e);
    await fireEvent.press(screen.getByText('하나섬으로'));
    expect(e.confirm).not.toHaveBeenCalled();
    expect(e.islands.switchCurrent).toHaveBeenCalledWith('a');
  },
);

test('소속 섬이 없어도 방문 중에는 「구경 끝내기」가 있어 확인 뒤 구경을 끝내고 섬 선택으로 간다', async () => {
  const e = visitEnv();
  const screen = await renderMembers(e);
  expect(screen.getByText('이동할 수 있는 소속 섬이 없어요.')).toBeTruthy();
  await pressSea(screen);
  expect(e.confirm).toHaveBeenCalledTimes(1);
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'VISIT_LEAVE_ASKED' });
  expect(e.reset).not.toHaveBeenCalled();
  await act(async () => e.confirm.mock.calls[0][2]());
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
  expect(e.reset).toHaveBeenCalledWith('sea');
  expect(e.state.visitingIslandId).toBeNull();
});

test('현재 섬이 있으면 「구경 끝내기」는 home 으로 간다(이미 물었으면 확인창 없이)', async () => {
  const e = visitEnv({
    items: [isl('a', '하나', { arrivedBefore: true })],
    currentIslandId: 'a',
  });
  e.dispatch({ type: 'VISIT_LEAVE_ASKED' });
  const screen = await renderMembers(e);
  await pressSea(screen);
  expect(e.confirm).not.toHaveBeenCalled();
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
  expect(e.reset).toHaveBeenCalledWith('sea');
});

test('방문 스냅샷이 구경 중인 섬과 다르면 가입 여부를 알 수 없어 확인 없이 떠난다(구경 끝내기도 막히지 않는다)', async () => {
  const e = visitEnv({
    items: [isl('a', '하나', { arrivedBefore: true })],
    currentIslandId: 'a',
  });
  // ISLAND_VISIT 가 visit 만 바꾸고 visitingIslandId 는 그대로인 구간 — visit 는 v, 구경 중인 섬은 other
  e.state = { ...e.state, visitingIslandId: 'other' };
  const screen = await renderMembers(e);
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.confirm).not.toHaveBeenCalled();
  expect(e.islands.switchCurrent).toHaveBeenCalledWith('a');
  await screen.unmount();

  const again = await renderMembers(e);
  await pressSea(again);
  expect(e.confirm).not.toHaveBeenCalled();
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
  expect(e.reset).toHaveBeenCalledWith('sea');
});

test('「구경 끝내기」는 방문 중에만 보인다', async () => {
  const screen = await renderMembers(env());
  expect(screen.queryByText('구경 끝내기')).toBeNull();
});

test('소속 섬 창의 구분선과 뒤로가기는 목록 안에서 처리한다', async () => {
  const e = env('b');
  const screen = await renderMembers(e);
  const topBorder = (label: string) =>
    StyleSheet.flatten(screen.getByLabelText(label + ', 가 본 소속 섬').props.style).borderTopWidth;
  expect(topBorder('하나섬으로')).toBe(0);
  expect(topBorder('둘섬으로')).toBe(1);
  await act(async () => {
    e.backOverride.current?.();
  });
  expect(screen.queryByText('어느 섬으로 갈까요?')).toBeNull();
  expect(screen.getByLabelText('바다로 출항')).toBeTruthy();
});

test('방문 중 항해 출발지는 방문 섬 이름이다', async () => {
  const e = env('b');
  const screen = await renderMembers(e);
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect((await screen.findByTestId('sailing-from')).props.children).toBe('둘');
});

test('항해 출발지는 누른 시점의 섬 이름이다 — 이동 응답의 소속 동기화가 현재 섬을 바꿔도 목적지로 바뀌지 않는다', async () => {
  const e = env();
  e.islands.switchCurrent.mockImplementation(async () => {
    e.state = reducer(e.state, {
      type: 'ISLAND_SYNC',
      memberships: {
        ...e.state.serverIslands!,
        currentIslandId: 'b',
        items: e.state.serverIslands!.memberships,
      },
    });
  });
  const screen = await renderMembers(e);
  await fireEvent.press(screen.getByText('둘섬으로'));
  expect(e.state.serverIslands!.currentIslandId).toBe('b');
  expect((await screen.findByTestId('sailing-from')).props.children).toBe('하나');
});

test('요청이 끝나도 그 사이 다른 곳이 갈아 끼운 뒤로가기 처리는 지우지 않는다', async () => {
  const e = env('b');
  let fail!: (error: Error) => void;
  e.islands.switchCurrent.mockReturnValue(new Promise<void>((_, reject) => (fail = reject)));
  const screen = await renderMembers(e);
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.backOverride.current?.()).toBe(true); // 요청 중 = 삼킴
  const other = () => false;
  e.backOverride.current = other;
  await act(async () => fail(new ApiError('ISLAND_NOT_ARRIVED', '아직', 403)));
  expect(screen.queryByTestId('sailing')).toBeNull();
  expect(e.backOverride.current).toBe(other);
});

test('요청 중 언마운트되면 응답이 와도 아무것도 하지 않는다(reset 0·경고 0)', async () => {
  const e = env('b');
  let finish!: () => void;
  e.islands.switchCurrent.mockReturnValue(new Promise<void>((r) => (finish = r)));
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  const screen = await renderMembers(e);
  await fireEvent.press(screen.getByText('하나섬으로'));
  await screen.unmount();
  await act(async () => finish());
  expect(e.reset).not.toHaveBeenCalled();
  expect(e.notify).not.toHaveBeenCalled();
  expect(err).not.toHaveBeenCalled();
  err.mockRestore();
});

test('마운트된 채 세션 세대가 바뀌면 항해·토스트 없이 요청 중 표시만 풀린다', async () => {
  const e = env('b');
  let finish!: () => void;
  e.islands.switchCurrent.mockReturnValueOnce(new Promise<void>((r) => (finish = r)));
  const screen = await renderMembers(e);
  await fireEvent.press(screen.getByText('하나섬으로'));
  mockGeneration += 1;
  await act(async () => finish());
  expect(screen.queryByTestId('sailing')).toBeNull();
  expect(e.notify).not.toHaveBeenCalled();
  expect(e.reset).not.toHaveBeenCalled();
  expect(e.backOverride.current).toBeNull();
  // 다시 소속 섬 창을 열어 선택할 수 있다(pending 해제).
  await fireEvent.press(screen.getByLabelText('소속 섬으로'));
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.islands.switchCurrent).toHaveBeenCalledTimes(2);
});

test('세대 변경과 언마운트가 겹쳐도 reset 하지 않는다', async () => {
  const e = env('b');
  let finish!: () => void;
  e.islands.switchCurrent.mockReturnValue(new Promise<void>((r) => (finish = r)));
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  const screen = await renderMembers(e);
  await fireEvent.press(screen.getByText('하나섬으로'));
  mockGeneration += 1;
  await screen.unmount();
  await act(async () => finish());
  expect(e.reset).not.toHaveBeenCalled();
  expect(e.notify).not.toHaveBeenCalled();
  expect(err).not.toHaveBeenCalled();
  err.mockRestore();
});

test('마지막 목적지는 저장본 복원 뒤에도 선택 상태로 보인다', async () => {
  const e = env();
  const chosen = reducer(e.state, { type: 'RAFT_DESTINATION', destination: 'sea' });
  e.state = reducer(initialState(true), { type: 'LOAD', state: chosen });
  const screen = await render(<RaftDestinations e={e} />);
  expect(screen.getByLabelText('바다로 출항').props.accessibilityState.selected).toBe(true);
});

test('영어에서도 두 목적지와 소속 섬 선택 창을 연다', async () => {
  applyLocalePref('en');
  try {
    const screen = await render(<RaftDestinations e={env()} />);
    expect(screen.getByText('Where shall we sail?')).toBeTruthy();
    expect(screen.getByLabelText('Start focusing')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('My islands'));
    expect(screen.getByText('Which island?')).toBeTruthy();
    expect(screen.getByText('To 둘')).toBeTruthy();
  } finally {
    applyLocalePref('ko');
  }
});

test('지금 소속 섬을 고르면 다시 항해하지 않고 섬 홈으로 돌아간다', async () => {
  const e = env();
  const screen = await renderMembers(e);
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.reset).toHaveBeenCalledWith('home');
  expect(e.islands.switchCurrent).not.toHaveBeenCalled();
  expect(screen.queryByTestId('sailing')).toBeNull();
});

test('섬 이름에 이미 섬이 들어 있으면 도착 문구에 중복해서 붙이지 않는다', async () => {
  const e = env();
  e.state.serverIslands!.memberships[1].name = '구름섬';
  const screen = await renderMembers(e);
  expect(screen.getByText('구름섬으로')).toBeTruthy();
  expect(screen.queryByText('구름섬섬으로')).toBeNull();
});
