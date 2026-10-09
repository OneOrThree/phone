import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ServerVisit } from '@/screens/island/ServerVisit';
import { initialState, reducer } from '@/services/model';
import { ApiError } from '@/services/api/client';
import { applyLocalePref } from '@/i18n';

jest.mock('@/screens/island/IslandSheet', () => ({
  IslandSheet: ({ children }: any) => {
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
}));

afterEach(() => applyLocalePref('system'));

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
    visit: {
      island,
      buildings: ['hall', 'board'],
      members: { items: [], nextCursor: null },
      joinRequest: null,
    },
  });
  return {
    state,
    detail: 'visitor',
    dispatch: jest.fn(),
    reset: jest.fn(),
    replace: jest.fn(),
    go: jest.fn(),
    back: jest.fn(),
    notify: jest.fn(),
    islands: {
      visit: jest.fn().mockResolvedValue(undefined),
      switchCurrent: jest.fn(),
      join: jest.fn(),
    },
  };
}

test('소속 후 미리보기의 둘러보기는 방문 섬 지도로 연결하고 가입은 회관에 둔다', async () => {
  const e = env();
  e.state.onboarded = true;
  const screen = await render(<ServerVisit e={e} />);
  await screen.findByText('방문할 서버 섬');
  expect(screen.queryByText('소다 섬')).toBeNull();
  expect(screen.queryByText('이 섬에 가입하기')).toBeNull();
  await fireEvent.press(screen.getByText('섬 둘러보기'));
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'SERVER_VISITING', islandId: 'visitor' });
  expect(e.replace).toHaveBeenCalledWith('visitIsland', 'visitor');
  expect(e.islands.join).not.toHaveBeenCalled();
});

test('이전 서버가 완공 정보를 안 주면 섬을 지어내지 않고 둘러보기를 잠근다', async () => {
  const e = env();
  e.state.onboarded = true;
  delete e.state.serverIslands!.visit!.buildings;
  const screen = await render(<ServerVisit e={e} />);
  await fireEvent.press(await screen.findByText('섬 둘러보기'));
  expect(e.dispatch).not.toHaveBeenCalled();
  screen.getByText('섬 모습을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.');
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

test('영어 방문 상세에서 상태와 둘러보기·세션 안내를 번역한다', async () => {
  applyLocalePref('en');
  const e = env();
  e.state.onboarded = true;
  e.state.session = { id: 'focus' } as any;
  const screen = await render(<ServerVisit e={e} />);
  await screen.findByText('Residents 3/15 · Visiting');
  await fireEvent.press(screen.getByText('Explore Island'));
  expect(e.notify).toHaveBeenCalledWith(
    'Finish your focus session or break before exploring the island.',
  );
  expect(e.replace).not.toHaveBeenCalled();
  expect(screen.queryByText('섬 둘러보기')).toBeNull();
});

test.each([false, true])(
  '영어 온보딩에서 승인제 %s에 맞는 가입 버튼을 표시한다',
  async (approvalRequired) => {
    applyLocalePref('en');
    const e = env();
    e.state.serverIslands!.visit!.island.approvalRequired = approvalRequired;
    const screen = await render(<ServerVisit e={e} />);
    await screen.findByText(approvalRequired ? 'Request to Join' : 'Join This Island');
  },
);

test('영어 방문 상세 조회 실패의 오류와 재시도를 번역한다', async () => {
  applyLocalePref('en');
  const e = env(true);
  e.islands.visit.mockRejectedValueOnce(new ApiError('CLIENT_NETWORK_ERROR', '연결 실패', 0));
  const screen = await render(<ServerVisit e={e} />);
  await screen.findByText("Can't connect to the network. Please check your connection.");
  await fireEvent.press(screen.getByText('Reload'));
  await screen.findByText('Go to This Island');
  expect(e.islands.visit).toHaveBeenCalledTimes(2);
});
