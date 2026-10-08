import assert from 'node:assert/strict';
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { initialState, reducer } from '@/services/model';

jest.mock('@/screens/island/useFriendsScreen', () => ({
  useFriendsScreen: () => ({ data: null }),
}));
jest.mock('@/screens/island/useBoardHomeIndicator', () => ({ useBoardHomeIndicator: () => null }));
jest.mock('@/screens/island/WorldMap', () => ({ FinalIsland: () => null }));
jest.mock('@/screens/island/Hall', () => ({
  Hall: () => {
    const { View } = require('react-native');
    return <View testID="hall-open" />;
  },
}));
jest.mock('@/screens/island/Library', () => ({
  Library: () => {
    const { View } = require('react-native');
    return <View testID="library-open" />;
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
const state = () =>
  reducer(initialState(true), {
    type: 'ISLAND_SYNC',
    memberships: {
      items: [{ id: 'server' }],
      currentIslandId: 'server',
      nextCursor: null,
      lossReason: null,
    },
  });
const env = (s: ReturnType<typeof state>, route: string) => ({
  state: s,
  route,
  islands: {},
  dispatch: jest.fn(),
  reset: jest.fn(),
  home: jest.fn(),
  go: jest.fn(),
  now: Date.now(),
  retryHome: jest.fn(),
});

test('시설 스냅샷 조회 전에는 로컬 완공 상태로 회관을 열지 않는다', async () => {
  const screen = await render(<CurrentScreens e={env(state(), 'hall')} />);
  screen.getByText('시설 정보를 확인하고 있어요.');
  assert.equal(screen.queryByTestId('hall-open'), null);
});

test('시설 조회 실패는 재시도할 수 있고 주민 화면은 아직 열리지 않는다', async () => {
  const e = { ...env(state(), 'library'), homeError: true };
  const screen = await render(<CurrentScreens e={e} />);
  await fireEvent.press(screen.getByText('다시 시도'));
  assert.equal(e.retryHome.mock.calls.length, 1);
  assert.equal(screen.queryByTestId('library-open'), null);
});

test('서버 완공 상태만 시설 진입을 연다', async () => {
  const s = reducer(state(), {
    type: 'SERVER_HOME',
    facts: {
      islandId: 'server',
      completedBuildings: ['hall'],
      home: { island: { id: 'server', role: 'member' }, wallets: { villagePoints: 0 } },
    },
  });
  const hall = await render(<CurrentScreens e={env(s, 'hall')} />);
  hall.getByTestId('hall-open');
  await hall.unmount();
  const library = await render(<CurrentScreens e={env(s, 'library')} />);
  library.getByText('아직 도서관이 없어요');
  assert.equal(library.queryByTestId('library-open'), null);
});

test('다른 섬 주민이어도 방문 중인 섬의 도서관에는 들어갈 수 없다', async () => {
  const s = state();
  s.visitingIslandId = 'visitor';
  const screen = await render(<CurrentScreens e={env(s, 'library')} />);
  screen.getByText('주민만 이용할 수 있어요');
  assert.equal(screen.queryByTestId('library-open'), null);
});
