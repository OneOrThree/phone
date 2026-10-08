import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ServerVisit } from '@/screens/island/ServerVisit';
import { initialState, reducer } from '@/services/model';
import { ApiError } from '@/services/api/client';

jest.mock('@/screens/island/IslandSheet', () => ({
  IslandSheet: ({ children }: any) => {
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
}));

function env(joined = false) {
  const island = {
    id: 'visitor',
    name: '방문할 서버 섬',
    intro: '실제 소개',
    memberCount: 3,
    maxMembers: 15,
    approvalRequired: false,
  };
  let state = reducer(initialState(true), {
    type: 'ISLAND_SYNC',
    memberships: {
      items: joined ? [island] : [],
      currentIslandId: null,
      nextCursor: null,
      lossReason: null,
    },
  });
  state = reducer(state, {
    type: 'ISLAND_VISIT',
    visit: { island, members: { items: [], nextCursor: null }, joinRequest: null },
  });
  return {
    state,
    detail: 'visitor',
    dispatch: jest.fn(),
    reset: jest.fn(),
    replace: jest.fn(),
    go: jest.fn(),
    back: jest.fn(),
    islands: {
      visit: jest.fn().mockResolvedValue(undefined),
      switchCurrent: jest.fn(),
      join: jest.fn(),
    },
  };
}

test('방문 게시판은 대상 섬을 지정하고 읽기 전용 경로로 연다', async () => {
  const e = env();
  const screen = await render(<ServerVisit e={e} />);
  await screen.findByText('방문할 서버 섬');
  expect(screen.queryByText('소다 섬')).toBeNull();
  await fireEvent.press(screen.getByText('게시판 둘러보기'));
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'SERVER_VISITING', islandId: 'visitor' });
  expect(e.replace).toHaveBeenCalledWith('board');
  expect(e.islands.join).not.toHaveBeenCalled();
});

test('소속 섬 입장은 서버 전환이 끝난 뒤에만 이동하고 중복 탭은 무시한다', async () => {
  const e = env(true);
  let finish!: () => void;
  e.islands.switchCurrent.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const screen = await render(<ServerVisit e={e} />);
  const enter = await screen.findByText('이 섬으로 이동하기');
  await fireEvent.press(enter);
  await fireEvent.press(screen.getByText('처리 중이에요'));
  expect(e.islands.switchCurrent).toHaveBeenCalledTimes(1);
  expect(e.islands.switchCurrent).toHaveBeenCalledWith('visitor');
  expect(e.reset).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(e.reset).toHaveBeenCalledWith('guide');
});

test('가입 실패는 방문 화면에 남고 승인이 필요한 응답도 홈으로 보내지 않는다', async () => {
  const e = env();
  e.islands.join.mockRejectedValueOnce(new ApiError('STATE_CONFLICT', 'internal', 409));
  const screen = await render(<ServerVisit e={e} />);
  await fireEvent.press(await screen.findByText('이 섬에 가입하기'));
  await screen.findByText('섬 정보가 바뀌었어요. 최신 상태로 다시 시도해 주세요.');
  expect(e.reset).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('다시 불러오기'));
  await screen.findByText('이 섬에 가입하기');
  e.islands.join.mockResolvedValue({ status: 'pending', requestId: 'request' });
  await fireEvent.press(screen.getByText('이 섬에 가입하기'));
  expect(e.reset).not.toHaveBeenCalled();
});
