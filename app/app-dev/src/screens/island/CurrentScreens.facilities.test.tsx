import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveSession, clearSession } from '@/services/api/session';
import { saveAccountGuides } from '@/services/accountGuides';
import * as homeApi from '@/services/api/home';
import assert from 'node:assert/strict';
import React from 'react';
import { AppState } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { getIslandNews } from '@/services/api/magazine';
import { CurrentScreens } from '@/screens/island/CurrentScreens';
import { initialState, reducer } from '@/services/model';

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
// 전망대 화면(랭킹·섬 이름 검색) 자체는 Screens.test.tsx 가 본다 — 여기서는 입구(시설 잠금)만 본다.
jest.mock('@/screens/island/Screens', () => ({
  RedesignScreens: ({ e }: any) => {
    const { View, Pressable } = require('react-native');
    return (
      <View testID={`redesign-${e.route}`}>
        <View testID={`screen-${e.route}`}>
          {['hall', 'board', 'sound', 'library', 'mail', 'tower', 'shop'].map((route) => (
            <Pressable key={route} testID={`enter-${route}`} onPress={() => e.go(route)} />
          ))}
        </View>
      </View>
    );
  },
}));
jest.mock('@/services/api/magazine', () => ({
  ...jest.requireActual('@/services/api/magazine'),
  getIslandNews: jest.fn(async () => []),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
// 채팅방(GROMO-2499)이 여는 서버 요청 — 섬 채팅 목록과 차단 목록
jest.mock('@/services/api/letters', () => ({
  ...jest.requireActual('@/services/api/letters'),
  listIslandMessages: jest.fn(async () => ({ items: [], nextCursor: null })),
}));
jest.mock('@/services/api/safety', () => ({
  ...jest.requireActual('@/services/api/safety'),
  getBlockedUsers: jest.fn(async () => []),
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

test('우체통이 없어도 채팅방은 섬 홈 위 시트로 열리고 내 섬 채팅을 읽는다(GROMO-2499)', async () => {
  const { listIslandMessages } = jest.requireMock('@/services/api/letters');
  // 채팅은 앱이 앞에 있을 때만 읽는다
  AppState.currentState = 'active';
  const s = reducer(state(), {
    type: 'SERVER_HOME',
    facts: {
      islandId: 'server',
      completedBuildings: ['hall'],
      home: { island: { id: 'server', role: 'member' }, wallets: { villagePoints: 0 } },
    },
  });
  const screen = await render(<CurrentScreens e={{ ...env(s, 'chat'), back: jest.fn() }} />);
  screen.getByText('우리 섬 채팅방');
  screen.getByTestId('island-message-input');
  assert.equal(screen.queryByText('아직 우체통이 없어요'), null);
  await waitFor(() => expect(listIslandMessages).toHaveBeenCalledWith('server'));
  await screen.unmount();
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

test.each([
  ['LEFT', 'sea'],
  [null, 'sea'],
] as const)(
  '현재 섬 없이 방문 지도에서 귀환하면 상실 사유 %s 는 %s 로 간다(GROMO-2366)',
  async (lossReason, to) => {
    const s = visiting();
    s.serverIslands!.currentIslandId = null;
    s.serverIslands!.lossReason = lossReason;
    const e = env(s, 'visitIsland');
    const screen = await render(<CurrentScreens e={e} />);
    await fireEvent.press(screen.getByTestId('visit-map'));
    expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
    expect(e.reset).toHaveBeenCalledWith(to);
  },
);

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
test.each(['tower', 'explore'])(
  '전망대를 짓지 않은 섬에서는 %s 입구가 잠겨 있다',
  async (route) => {
    const screen = await render(
      <CurrentScreens e={env(withBuildings(['hall', 'board']), route)} />,
    );
    screen.getByText('아직 전망대가 없어요');
    assert.equal(screen.queryByTestId(`redesign-${route}`), null);
  },
);

// 받침 있는 건물(전망대·축음기)은 «이» 가 아니라 «가» — 건물명 뒤 조사를 받침에 맞춘다(GROMO-2283)
test('축음기를 짓지 않은 섬에서는 «아직 축음기가 없어요» 로 잠겨 있다', async () => {
  const screen = await render(
    <CurrentScreens e={env(withBuildings(['hall', 'board']), 'sound')} />,
  );
  screen.getByText('아직 축음기가 없어요');
});

test.each(['tower', 'explore'])('전망대를 지은 섬에서는 %s 가 열린다', async (route) => {
  const screen = await render(<CurrentScreens e={env(withBuildings(['hall', 'tower']), route)} />);
  screen.getByTestId(`redesign-${route}`);
  assert.equal(screen.queryByText('아직 전망대가 없어요'), null);
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
  await fireEvent.press(screen.getByTestId('enter-mail'));
  await waitFor(() =>
    expect(screen.getByText('난 친구들의 편지를 배달하는 펠리컨이야.')).toBeTruthy(),
  );
  expect(screen.getByTestId('screen-home')).toBeTruthy();
  expect(home.go).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('안내 그만 보기'));
  await waitFor(() => expect(home.go).toHaveBeenCalledWith('mail'));
  expect(screen.queryByTestId('building-guide')).toBeNull();
  const next = env(withBuildings(['mail'], 'next-island'), 'home');
  await screen.rerender(<CurrentScreens e={next} />);
  await fireEvent.press(screen.getByTestId('enter-mail'));
  expect(next.go).toHaveBeenCalledWith('mail');
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

function NavigationHarness({ s, go }: { s: ReturnType<typeof state>; go: jest.Mock }) {
  const [route, setRoute] = React.useState('home');
  return (
    <CurrentScreens
      e={{
        ...env(s, route),
        go: (next: string) => {
          go(next);
          setRoute(next);
        },
      }}
    />
  );
}

test.each([
  ['hall', 'hall'],
  ['board', 'board'],
  ['gram', 'sound'],
  ['library', 'library'],
  ['mail', 'mail'],
  ['tower', 'tower'],
  ['shop', 'shop'],
])('%s 첫 설명은 섬 위에서 끝내고 내부 화면을 연다', async (building, route) => {
  await signInGuideUser();
  jest
    .spyOn(homeApi, 'getConstructionOptions')
    .mockResolvedValue({ contributedCompletions: [] } as any);
  const go = jest.fn();
  const screen = await render(<NavigationHarness s={withBuildings([building])} go={go} />);
  await fireEvent.press(screen.getByTestId(`enter-${route}`));
  await waitFor(() => expect(screen.getByTestId('building-guide')).toBeTruthy());
  expect(screen.getByTestId('screen-home')).toBeTruthy();
  expect(screen.queryByTestId('hall-open')).toBeNull();
  expect(screen.queryByTestId('library-open')).toBeNull();
  expect(go).not.toHaveBeenCalled();
  while (screen.queryByText('다음')) await fireEvent.press(screen.getByText('다음'));
  await fireEvent.press(screen.getByText('확인'));
  await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
  expect(go).toHaveBeenCalledWith(route);
  expect(screen.queryByTestId('screen-home')).toBeNull();
  expect(screen.queryByTestId('building-guide')).toBeNull();
});

test('설명 저장 실패 시 섬에 남고 재시도 저장이 끝난 뒤 한 번만 진입한다', async () => {
  await signInGuideUser();
  jest
    .spyOn(homeApi, 'getConstructionOptions')
    .mockResolvedValue({ contributedCompletions: [] } as any);
  const go = jest.fn();
  const screen = await render(<NavigationHarness s={withBuildings(['mail'])} go={go} />);
  await fireEvent.press(screen.getByTestId('enter-mail'));
  await waitFor(() => expect(screen.getByTestId('building-guide')).toBeTruthy());
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
  await fireEvent.press(screen.getByText('안내 그만 보기'));
  await waitFor(() => expect(screen.getByText(/안내 이력을 저장하지 못했어요/)).toBeTruthy());
  expect(screen.getByTestId('screen-home')).toBeTruthy();
  expect(go).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText('안내 그만 보기'));
  await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
});

test('이력 조회가 늦어도 내부 화면을 먼저 열지 않고 조회 후 섬에서 설명한다', async () => {
  await signInGuideUser();
  jest
    .spyOn(homeApi, 'getConstructionOptions')
    .mockResolvedValue({ contributedCompletions: [] } as any);
  let resolve!: (value: string | null) => void;
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const e = env(withBuildings(['mail']), 'home');
  const screen = await render(<CurrentScreens e={e} />);
  await fireEvent.press(screen.getByTestId('enter-mail'));
  expect(screen.getByText('안내 이력을 확인하고 있어요.')).toBeTruthy();
  expect(e.go).not.toHaveBeenCalled();
  await act(async () => resolve(null));
  await waitFor(() => expect(screen.getByTestId('building-guide')).toBeTruthy());
  expect(screen.getByTestId('screen-home')).toBeTruthy();
  expect(e.go).not.toHaveBeenCalled();
});

test('설명 저장 중 섬을 옮기면 늦은 저장 결과로 건물을 열지 않는다', async () => {
  await signInGuideUser();
  jest
    .spyOn(homeApi, 'getConstructionOptions')
    .mockResolvedValue({ contributedCompletions: [] } as any);
  const e = env(withBuildings(['mail']), 'home');
  const screen = await render(<CurrentScreens e={e} />);
  await fireEvent.press(screen.getByTestId('enter-mail'));
  await waitFor(() => expect(screen.getByTestId('building-guide')).toBeTruthy());
  let resolve!: () => void;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await fireEvent.press(screen.getByText('안내 그만 보기'));
  const next = env(withBuildings(['mail'], 'next-island'), 'home');
  await screen.rerender(<CurrentScreens e={next} />);
  await act(async () => resolve());
  expect(screen.queryByTestId('building-guide')).toBeNull();
  expect(e.go).not.toHaveBeenCalled();
  expect(next.go).not.toHaveBeenCalled();
});

test.each(['닫기', '뒤로가기'])(
  '안내 이력이 손상돼도 %s로 진입 요청만 취소하고 섬에 남는다',
  async (action) => {
    await signInGuideUser();
    const key = 'gromo:account-guides:v1:guide-user';
    await AsyncStorage.setItem(key, '{broken');
    jest
      .spyOn(homeApi, 'getConstructionOptions')
      .mockResolvedValue({ contributedCompletions: [] } as any);
    const e = env(withBuildings(['mail']), 'home');
    const screen = await render(<CurrentScreens e={e} />);
    expect(await fireEvent(screen.getByTestId('enter-mail'), 'press')).toBe(false);
    await waitFor(() => expect(screen.getByText('다시 시도')).toBeTruthy());
    if (action === '닫기') await fireEvent.press(screen.getByText('닫기'));
    else await fireEvent(screen.getByTestId('building-entry-pending'), 'requestClose');
    expect(screen.queryByTestId('building-entry-pending')).toBeNull();
    expect(screen.getByTestId('screen-home')).toBeTruthy();
    expect(e.go).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(key)).toBe('{broken');
    expect(await fireEvent(screen.getByTestId('enter-mail'), 'press')).toBe(false);
    expect(screen.getByTestId('building-entry-pending')).toBeTruthy();
    expect(e.go).not.toHaveBeenCalled();
  },
);

test('이력 조회 중 진입을 취소하면 늦은 조회 성공으로 안내나 건물을 열지 않는다', async () => {
  await signInGuideUser();
  jest
    .spyOn(homeApi, 'getConstructionOptions')
    .mockResolvedValue({ contributedCompletions: [] } as any);
  let resolve!: (value: string | null) => void;
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const e = env(withBuildings(['mail']), 'home');
  const screen = await render(<CurrentScreens e={e} />);
  await fireEvent.press(screen.getByTestId('enter-mail'));
  await fireEvent.press(screen.getByText('닫기'));
  await act(async () => resolve(null));
  expect(screen.queryByTestId('building-entry-pending')).toBeNull();
  expect(screen.queryByTestId('building-guide')).toBeNull();
  expect(screen.getByTestId('screen-home')).toBeTruthy();
  expect(e.go).not.toHaveBeenCalled();
});
