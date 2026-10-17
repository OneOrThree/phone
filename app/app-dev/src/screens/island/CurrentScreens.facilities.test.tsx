import assert from 'node:assert/strict';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { getIslandNews } from '@/services/api/magazine';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { t } from '@/i18n';
import { buildingNames, initialState, reducer } from '@/services/model';

jest.mock('@/screens/island/useFriendsScreen', () => ({
  useFriendsScreen: () => ({ data: null }),
}));
jest.mock('@/screens/island/useBoardHomeIndicator', () => ({ useBoardHomeIndicator: () => null }));
jest.mock('@/screens/island/WorldMap', () => ({
  FinalIsland: ({ onReturnFromVisit }: any) => {
    const { Pressable } = require('react-native');
    return <Pressable testID="visit-map" onPress={onReturnFromVisit} />;
  },
}));
jest.mock('@/screens/island/VisitorBoard', () => ({
  VisitorBoard: ({ onClose }: any) => {
    const { Pressable } = require('react-native');
    return <Pressable testID="visitor-board" onPress={onClose} />;
  },
}));
jest.mock('@/screens/island/Hall', () => ({
  Hall: ({ e }: any) => {
    const { Pressable } = require('react-native');
    return <Pressable testID="hall-open" onPress={e.back} />;
  },
}));
jest.mock('@/screens/island/Library', () => ({
  Library: () => {
    const { View } = require('react-native');
    return <View testID="library-open" />;
  },
}));
// 전망대 화면(랭킹·섬 이름 검색) 자체는 Screens.test.tsx 가 본다 — 여기서는 입구(시설 잠금)만 본다.
jest.mock('@/screens/island/Screens', () => {
  const actual = jest.requireActual('@/screens/island/Screens');
  const { View } = require('react-native');
  return { ...actual, RedesignScreens: ({ e }: any) => <View testID={`redesign-${e.route}`} /> };
});
jest.mock('@/services/api/magazine', () => ({
  ...jest.requireActual('@/services/api/magazine'),
  getIslandNews: jest.fn(async () => []),
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
  replace: jest.fn(),
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

const visiting = () =>
  reducer(
    reducer(state(), {
      type: 'ISLAND_VISIT',
      visit: { island: { id: 'visitor' }, buildings: ['hall', 'board'] },
    }),
    { type: 'SERVER_VISITING', islandId: 'visitor' },
  );

test.each(['manage', 'board'])('방문 %s를 닫으면 방문 섬 지도로 돌아간다', async (route) => {
  const e = env(visiting(), route);
  const screen = await render(<CurrentScreens e={e} />);
  await fireEvent.press(screen.getByTestId(route === 'manage' ? 'hall-open' : 'visitor-board'));
  expect(e.replace).toHaveBeenCalledWith('visitIsland', 'visitor');
  expect(e.dispatch).not.toHaveBeenCalled();
});

test('방문 지도에서 귀환하면 방문만 종료하고 원래 서버 섬을 유지한다', async () => {
  const s = visiting();
  const e = env(s, 'visitIsland');
  const screen = await render(<CurrentScreens e={e} />);
  await fireEvent.press(screen.getByTestId('visit-map'));
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
  expect(e.reset).toHaveBeenCalledWith('home');
  expect(s.serverIslands!.currentIslandId).toBe('server');
});

test('방문 시설이 미완공이면 내 섬의 완공 여부와 무관하게 열리지 않는다', async () => {
  const s = visiting();
  s.serverIslands!.visit!.buildings = ['hall'];
  const e = env(s, 'board');
  const screen = await render(<CurrentScreens e={e} />);
  screen.getByText('아직 게시판이 없어요');
  expect(screen.queryByTestId('visitor-board')).toBeNull();
  await fireEvent.press(screen.getByText('확인'));
  expect(e.replace).toHaveBeenCalledWith('visitIsland', 'visitor');
});

// 전망대(GROMO-2269) — 주간 랭킹(tower)과 섬 이름 검색(explore)은 전망대를 지은 주민에게만 열린다.
const withBuildings = (built: string[]) =>
  reducer(state(), {
    type: 'SERVER_HOME',
    facts: {
      islandId: 'server',
      completedBuildings: built,
      home: { island: { id: 'server', role: 'member' }, wallets: { villagePoints: 0 } },
    },
  });

test.each(['tower', 'explore'])(
  '전망대를 짓지 않은 섬에서는 %s 입구가 잠겨 있다',
  async (route) => {
    const screen = await render(
      <CurrentScreens e={env(withBuildings(['hall', 'board']), route)} />,
    );
    screen.getByText(t('home.lock.missing', { building: buildingNames.tower }));
    assert.equal(screen.queryByTestId(`redesign-${route}`), null);
  },
);

test.each(['tower', 'explore'])('전망대를 지은 섬에서는 %s 가 열린다', async (route) => {
  const screen = await render(<CurrentScreens e={env(withBuildings(['hall', 'tower']), route)} />);
  screen.getByTestId(`redesign-${route}`);
  assert.equal(screen.queryByText(t('home.lock.missing', { building: buildingNames.tower })), null);
});

test.each(['tower', 'explore'])(
  '전망대는 남의 섬을 방문 중이면 %s 가 열리지 않는다',
  async (route) => {
    const screen = await render(<CurrentScreens e={env(visiting(), route)} />);
    screen.getByText('주민만 이용할 수 있어요');
    assert.equal(screen.queryByTestId(`redesign-${route}`), null);
  },
);

test('주민 소식(홍보 토스트)은 서버 역할로 주민임을 확인한 뒤에만 읽는다 — 홈 스냅샷 전에는 섬장일 수도 있다(GROMO-2289)', async () => {
  const news = getIslandNews as jest.Mock;
  news.mockClear();
  const withRole = (role: 'host' | 'member') =>
    reducer(state(), {
      type: 'SERVER_HOME',
      facts: {
        islandId: 'server',
        completedBuildings: ['hall'],
        home: { island: { id: 'server', role }, wallets: { villagePoints: 0 } },
      },
    });
  for (const s of [state(), withRole('host')]) {
    const screen = await render(<CurrentScreens e={env(s, 'home')} />);
    await act(async () => {});
    await screen.unmount();
  }
  assert.equal(news.mock.calls.length, 0);
  const member = await render(<CurrentScreens e={env(withRole('member'), 'home')} />);
  await act(async () => {});
  assert.equal(news.mock.calls[0]?.[0], 'server');
  await member.unmount();
});
