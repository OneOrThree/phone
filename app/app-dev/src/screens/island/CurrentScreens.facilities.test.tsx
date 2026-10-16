import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveSession, clearSession } from '@/services/api/session';
import { saveAccountGuides } from '@/services/accountGuides';
import * as homeApi from '@/services/api/home';
import assert from 'node:assert/strict';
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { initialState, reducer } from '@/services/model';

jest.mock('@/screens/island/Screens', () => ({ RedesignScreens: () => null }));
jest.mock('@/screens/interiors/BuildingInteriors', () => ({ InteriorRoute: () => null }));
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

const withBuildings = (buildings: string[], id = 'server') =>
  reducer(
    reducer(state(), {
      type: 'ISLAND_SYNC',
      memberships: { items: [{ id }], currentIslandId: id, lossReason: null },
    }),
    {
      type: 'SERVER_HOME',
      facts: {
        islandId: id,
        completedBuildings: buildings,
        home: { island: { id, role: 'member' }, wallets: { villagePoints: 0 } },
      },
    },
  );

async function signInGuideUser() {
  await AsyncStorage.clear();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'guide-user' });
}
afterEach(async () => {
  jest.restoreAllMocks();
  await clearSession();
});

test('로컬 우체통이 있어도 실제 섬에 없으면 설명이 나오지 않는다', async () => {
  await signInGuideUser();
  const screen = await render(<CurrentScreens e={env(withBuildings(['hall']), 'mail')} />);
  expect(screen.getByText('아직 우체통이 없어요')).toBeTruthy();
  expect(screen.queryByTestId('building-guide')).toBeNull();
});

test('미열람 신규 주민은 건물을 눌렀을 때만 설명을 보고 다른 섬에서는 반복하지 않는다', async () => {
  await signInGuideUser();
  jest
    .spyOn(homeApi, 'getConstructionOptions')
    .mockResolvedValue({ contributedCompletions: [] } as any);
  const home = env(withBuildings(['hall', 'mail']), 'home');
  const screen = await render(<CurrentScreens e={home} />);
  await waitFor(() => expect(homeApi.getConstructionOptions).toHaveBeenCalled());
  expect(screen.queryByTestId('building-guide')).toBeNull();
  expect(screen.queryByTestId('building-completion-guide')).toBeNull();
  await screen.rerender(<CurrentScreens e={{ ...home, route: 'mail' }} />);
  await waitFor(() =>
    expect(screen.getByText('난 친구들의 편지를 배달하는 펠리컨이야.')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByText('안내 그만 보기'));
  await waitFor(() => expect(screen.queryByTestId('building-guide')).toBeNull());
  await screen.rerender(<CurrentScreens e={env(withBuildings(['mail'], 'next-island'), 'mail')} />);
  expect(screen.queryByTestId('building-guide')).toBeNull();
});

test('이미 설명을 본 기여자는 완공 안내만 받고 이후 홈에서 반복하지 않는다', async () => {
  await signInGuideUser();
  await saveAccountGuides('guide-user', { buildings: ['mail'] });
  jest
    .spyOn(homeApi, 'getConstructionOptions')
    .mockResolvedValue({ contributedCompletions: ['mail'] } as any);
  const e = env(withBuildings(['hall', 'mail']), 'home');
  const screen = await render(<CurrentScreens e={e} />);
  await waitFor(() => expect(screen.getByText(/우체통 공사가 끝났어/)).toBeTruthy());
  expect(screen.queryByText(/편지를 배달하는/)).toBeNull();
  await fireEvent.press(screen.getByText('확인'));
  await waitFor(() => expect(screen.queryByTestId('building-completion-guide')).toBeNull());
  await screen.rerender(<CurrentScreens e={{ ...e, route: 'mail' }} />);
  expect(screen.queryByTestId('building-guide')).toBeNull();
  await screen.rerender(<CurrentScreens e={e} />);
  expect(screen.queryByTestId('building-completion-guide')).toBeNull();
});
