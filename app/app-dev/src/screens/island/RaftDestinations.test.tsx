import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RaftDestinations } from '@/screens/island/RaftDestinations';
import { initialState, reducer } from '@/services/model';
import { ApiError } from '@/services/api/client';

// 세션 세대를 테스트가 바꿀 수 있게 한다(나머지 export 는 실제 구현 유지).
let mockGeneration = 0;
jest.mock('@/services/api/session', () => ({
  ...jest.requireActual('@/services/api/session'),
  sessionGeneration: () => mockGeneration,
}));
beforeEach(() => {
  mockGeneration = 0;
});

// 시트 틀만 목으로 바꾸고 SheetGroup·SheetRow 는 실제 구현을 쓴다 — 구분선 인덱스(divider)까지 같이 본다.
jest.mock('@/screens/island/IslandSheet', () => ({
  ...jest.requireActual('@/screens/island/IslandSheet'),
  IslandSheet: ({ children }: any) => {
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
}));
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

test('도착한 적 없는 섬과 현재 섬은 빼고, arrivedBefore 가 없으면 포함한다', async () => {
  const e = env();
  const screen = await render(<RaftDestinations e={e} />);
  expect(screen.getByText('둘섬으로')).toBeTruthy();
  expect(screen.getByText('넷섬으로')).toBeTruthy();
  expect(screen.queryByText('하나섬으로')).toBeNull();
  expect(screen.queryByText('셋섬으로')).toBeNull();
  expect(screen.getByText('앞바다 낚시섬')).toBeTruthy();
  expect(screen.getByText('망원경')).toBeTruthy();
  expect(screen.getByText('내 뗏목')).toBeTruthy();
});

test('「○○섬으로」는 switchCurrent 뒤 항해 연출을 거쳐 home 으로 reset 한다', async () => {
  const e = env();
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('둘섬으로'));
  expect(e.islands.switchCurrent).toHaveBeenCalledWith('b');
  await fireEvent.press(await screen.findByTestId('sailing'));
  expect(e.reset).toHaveBeenCalledWith('home');
  expect(e.dispatch).not.toHaveBeenCalled();
});

test('거절되면 서버 문구를 알리고 연출하지 않는다', async () => {
  const e = env();
  e.islands.switchCurrent.mockRejectedValue(
    new ApiError('ISLAND_NOT_ARRIVED', '아직 가 본 적 없는 섬이에요.', 403),
  );
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('둘섬으로'));
  await act(async () => {});
  expect(e.notify).toHaveBeenCalledWith('아직 가 본 적 없는 섬이에요. 망원경에서 항해해 주세요.');
  expect(screen.queryByTestId('sailing')).toBeNull();
});

test('방문 중에는 소속 섬 전부(방문 섬 포함, 미도착 제외)만 보이고 떠나면 END_VISIT 한다', async () => {
  const e = env('b');
  const screen = await render(<RaftDestinations e={e} />);
  expect(screen.getByText('하나섬으로')).toBeTruthy();
  expect(screen.getByText('둘섬으로')).toBeTruthy();
  expect(screen.getByText('넷섬으로')).toBeTruthy();
  expect(screen.queryByText('셋섬으로')).toBeNull();
  expect(screen.queryByText('앞바다 낚시섬')).toBeNull();
  expect(screen.queryByText('망원경')).toBeNull();
  expect(screen.queryByText('내 뗏목')).toBeNull();
  await fireEvent.press(screen.getByText('하나섬으로'));
  await fireEvent.press(await screen.findByTestId('sailing'));
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
  expect(e.reset).toHaveBeenCalledWith('home');
});

test('방문 중 시트를 닫으면 방문 섬 지도로, 항해 중 뒤로가기는 삼킨다', async () => {
  const e = env('b');
  const screen = await render(<RaftDestinations e={e} />);
  expect(e.backOverride.current).toBeNull();
  await fireEvent.press(screen.getByText('하나섬으로'));
  await screen.findByTestId('sailing');
  expect(e.backOverride.current?.()).toBe(true);
  expect(e.home).not.toHaveBeenCalled();
});

test('이동 요청 중에는 닫기·뒤로가기·다른 행이 막히고 완료 뒤 항해로 간다', async () => {
  const e = env('b');
  let finish!: () => void;
  e.islands.switchCurrent.mockReturnValue(new Promise<void>((r) => (finish = r)));
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.backOverride.current?.()).toBe(true);
  await fireEvent.press(screen.getByText('넷섬으로'));
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
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.confirm).toHaveBeenCalledTimes(1);
  expect(e.confirm.mock.calls[0][0]).toBe('가입하지 않고 떠날까요?');
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'VISIT_LEAVE_ASKED' });
  expect(e.islands.switchCurrent).not.toHaveBeenCalled();
  // 리듀서가 매 액션마다 상태를 깊은 복사한다 — 방문 중 다른 액션이 끼어도 다시 묻지 않는다
  await act(async () => e.dispatch({ type: 'TRAVEL_FROM', name: '구경섬' }));
  await screen.rerender(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.confirm).toHaveBeenCalledTimes(1);
  expect(e.islands.switchCurrent).toHaveBeenCalledWith('a');
  // 시트를 닫았다 다시 열어도(같은 방문) 바로 떠난다
  await screen.unmount();
  const again = await render(<RaftDestinations e={e} />);
  await fireEvent.press(again.getByText('하나섬으로'));
  expect(e.confirm).toHaveBeenCalledTimes(1);
  expect(e.islands.switchCurrent).toHaveBeenCalledTimes(2);
});

test('확인창을 거쳐 「떠나기」를 고르면 그때 이동한다', async () => {
  const e = visitEnv({
    items: [isl('a', '하나', { arrivedBefore: true })],
    currentIslandId: 'a',
  });
  const screen = await render(<RaftDestinations e={e} />);
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
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('구경 끝내기'));
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
  const screen = await render(<RaftDestinations e={e} />);
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
  const screen = await render(<RaftDestinations e={full} />);
  await fireEvent.press(screen.getByText('구경 끝내기'));
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
  const moveScreen = await render(<RaftDestinations e={move} />);
  await fireEvent.press(moveScreen.getByText('하나섬으로'));
  expect(move.confirm).not.toHaveBeenCalled();
  expect(move.dispatch).not.toHaveBeenCalledWith({ type: 'VISIT_LEAVE_ASKED' });
  expect(move.islands.switchCurrent).toHaveBeenCalledWith('a');
  await moveScreen.unmount();

  // 구경 끝내기
  const end = visitEnv({ joinRequest: request });
  const endScreen = await render(<RaftDestinations e={end} />);
  await fireEvent.press(endScreen.getByText('구경 끝내기'));
  expect(end.confirm).not.toHaveBeenCalled();
  expect(end.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
  expect(end.reset).toHaveBeenCalledWith('chooseIsland');
});

test.each(['pending', 'active'])(
  '가입 상태가 %s 면 확인창 없이 떠난다',
  async (membershipStatus) => {
    const e = visitEnv({
      items: [isl('a', '하나', { arrivedBefore: true })],
      currentIslandId: 'a',
      membershipStatus,
    });
    const screen = await render(<RaftDestinations e={e} />);
    await fireEvent.press(screen.getByText('하나섬으로'));
    expect(e.confirm).not.toHaveBeenCalled();
    expect(e.islands.switchCurrent).toHaveBeenCalledWith('a');
  },
);

test('소속 섬이 없어도 방문 중에는 「구경 끝내기」가 있어 확인 뒤 구경을 끝내고 섬 선택으로 간다', async () => {
  const e = visitEnv();
  const screen = await render(<RaftDestinations e={e} />);
  expect(screen.queryByText(/섬으로$/)).toBeNull();
  await fireEvent.press(screen.getByText('구경 끝내기'));
  expect(e.confirm).toHaveBeenCalledTimes(1);
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'VISIT_LEAVE_ASKED' });
  expect(e.reset).not.toHaveBeenCalled();
  await act(async () => e.confirm.mock.calls[0][2]());
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
  expect(e.reset).toHaveBeenCalledWith('chooseIsland');
  expect(e.state.visitingIslandId).toBeNull();
});

test('현재 섬이 있으면 「구경 끝내기」는 home 으로 간다(이미 물었으면 확인창 없이)', async () => {
  const e = visitEnv({
    items: [isl('a', '하나', { arrivedBefore: true })],
    currentIslandId: 'a',
  });
  e.dispatch({ type: 'VISIT_LEAVE_ASKED' });
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('구경 끝내기'));
  expect(e.confirm).not.toHaveBeenCalled();
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
  expect(e.reset).toHaveBeenCalledWith('home');
});

test('방문 스냅샷이 구경 중인 섬과 다르면 가입 여부를 알 수 없어 확인 없이 떠난다(구경 끝내기도 막히지 않는다)', async () => {
  const e = visitEnv({
    items: [isl('a', '하나', { arrivedBefore: true })],
    currentIslandId: 'a',
  });
  // ISLAND_VISIT 가 visit 만 바꾸고 visitingIslandId 는 그대로인 구간 — visit 는 v, 구경 중인 섬은 other
  e.state = { ...e.state, visitingIslandId: 'other' };
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.confirm).not.toHaveBeenCalled();
  expect(e.islands.switchCurrent).toHaveBeenCalledWith('a');
  await screen.unmount();

  const again = await render(<RaftDestinations e={e} />);
  await fireEvent.press(again.getByText('구경 끝내기'));
  expect(e.confirm).not.toHaveBeenCalled();
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
  expect(e.reset).toHaveBeenCalledWith('home');
});

test('「구경 끝내기」는 방문 중에만 보인다', async () => {
  const screen = await render(<RaftDestinations e={env()} />);
  expect(screen.queryByText('구경 끝내기')).toBeNull();
});

test('조건부로 빠진 행이 구분선 위치를 어긋나게 하지 않는다', async () => {
  const topBorder = (label: string, screen: any) =>
    StyleSheet.flatten(screen.getByLabelText(label).props.style).borderTopWidth;
  // 방문 중: 첫 행 위에는 선이 없고 그 아래 행(구경 끝내기 포함)마다 있다
  const visiting = await render(<RaftDestinations e={env('b')} />);
  expect(topBorder('하나섬으로', visiting)).toBe(0);
  expect(topBorder('둘섬으로', visiting)).toBe(1);
  expect(topBorder('구경 끝내기', visiting)).toBe(1);
  await visiting.unmount();
  // 평상시: 낚시섬이 첫 행
  const home = await render(<RaftDestinations e={env()} />);
  expect(topBorder('앞바다 낚시섬', home)).toBe(0);
  expect(topBorder('둘섬으로', home)).toBe(1);
  expect(topBorder('내 뗏목', home)).toBe(1);
});

test('방문 중 항해 출발지는 방문 섬 이름이다', async () => {
  const e = env('b');
  const screen = await render(<RaftDestinations e={e} />);
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
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('둘섬으로'));
  expect(e.state.serverIslands!.currentIslandId).toBe('b');
  expect((await screen.findByTestId('sailing-from')).props.children).toBe('하나');
});

test('요청 중 언마운트되면 응답이 와도 아무것도 하지 않는다(reset 0·경고 0)', async () => {
  const e = env('b');
  let finish!: () => void;
  e.islands.switchCurrent.mockReturnValue(new Promise<void>((r) => (finish = r)));
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  const screen = await render(<RaftDestinations e={e} />);
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
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('하나섬으로'));
  mockGeneration += 1;
  await act(async () => finish());
  expect(screen.queryByTestId('sailing')).toBeNull();
  expect(e.notify).not.toHaveBeenCalled();
  expect(e.reset).not.toHaveBeenCalled();
  expect(e.backOverride.current).toBeNull();
  // 행이 다시 눌린다(pending 해제)
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.islands.switchCurrent).toHaveBeenCalledTimes(2);
});

test('세대 변경과 언마운트가 겹쳐도 reset 하지 않는다', async () => {
  const e = env('b');
  let finish!: () => void;
  e.islands.switchCurrent.mockReturnValue(new Promise<void>((r) => (finish = r)));
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('하나섬으로'));
  mockGeneration += 1;
  await screen.unmount();
  await act(async () => finish());
  expect(e.reset).not.toHaveBeenCalled();
  expect(e.notify).not.toHaveBeenCalled();
  expect(err).not.toHaveBeenCalled();
  err.mockRestore();
});
