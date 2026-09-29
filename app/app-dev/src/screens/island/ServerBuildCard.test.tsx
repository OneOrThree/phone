import assert from 'node:assert/strict';
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { FinalIsland } from '@/screens/island/WorldMap';
import { initialState } from '@/services/model';
import * as home from '@/services/api/home';
import * as islands from '@/services/api/islands';

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
jest.mock('@/services/api/home', () => ({
  ...jest.requireActual('@/services/api/home'),
  getConstructionOptions: jest.fn(),
  getMembers: jest.fn(),
  startConstruction: jest.fn(),
}));
jest.mock('@/services/api/islands', () => ({
  ...jest.requireActual('@/services/api/islands'),
  myIslands: jest.fn(),
}));

const api = home as jest.Mocked<typeof home>;
const mine = islands as jest.Mocked<typeof islands>;

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

const serverState = (role: 'host' | 'member', completedBuildings: string[] = []) => {
  const state = initialState(true);
  state.serverIslands = {
    currentIslandId: 'srv1',
    home: {
      islandId: 'srv1',
      home: {
        island: { id: 'srv1', name: '새섬', intro: '', maxMembers: 15, role },
        wallets: { villagePoints: 70 },
        focusSummary: { totalSeconds: 0 },
      },
      completedBuildings,
      members: [],
    },
  } as any;
  return state;
};

const hallOptions = {
  islandVersion: 3,
  costPolicyVersion: 1,
  selectedBuildingId: null,
  villagePoints: 70,
  walletVersion: 2,
  items: [
    {
      id: 'hall',
      name: '마을회관',
      cost: 60,
      currency: 'village_points',
      selectable: true,
      buildable: true,
      blockedReason: null,
    },
  ],
} as any;

test('회관 없는 섬의 방장은 홈에서 서버 건설로 회관을 짓고 홈 스냅샷을 다시 읽는다', async () => {
  mine.myIslands.mockResolvedValue({
    items: [{ id: 'srv1' }],
    currentIslandId: 'srv1',
  } as any);
  api.getMembers.mockResolvedValue({ items: [], nextCursor: null, version: 1 } as any);
  api.getConstructionOptions.mockResolvedValue(hallOptions);
  api.startConstruction.mockResolvedValue({
    buildingId: 'hall',
    status: 'BUILDING',
    spent: { currency: 'village_points', amount: 60 },
    version: 4,
    villagePoints: 10,
    walletVersion: 3,
    startedAt: '2026-09-29T00:00:00Z',
    completesAt: '2026-09-29T00:10:00Z',
  } as any);
  const build = jest.fn(),
    dispatch = jest.fn(),
    onServerBuilt = jest.fn();
  const screen = await render(
    <FinalIsland
      state={serverState('host')}
      go={jest.fn()}
      build={build}
      dispatch={dispatch}
      onServerBuilt={onServerBuilt}
    />,
  );
  // 접힌 카드는 스냅샷만 그린다 — 홈 진입에 건설 조회를 더하지 않는다
  expect(screen.getByText('마을회관 짓기')).toBeTruthy();
  assert.equal(api.getConstructionOptions.mock.calls.length, 0);

  await act(async () => fireEvent.press(screen.getByTestId('server-build-open')));
  await act(async () => fireEvent.press(await screen.findByTestId('server-build-start')));

  assert.equal(api.getConstructionOptions.mock.calls[0][0], 'srv1');
  const [islandId, buildingId, version, costVersion] = api.startConstruction.mock.calls[0];
  assert.equal(islandId, 'srv1');
  assert.equal(buildingId, 'hall');
  assert.equal(version, 3);
  assert.equal(costVersion, 1);
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'SERVER_CONSTRUCTION_STARTED',
      islandId: 'srv1',
      building: 'hall',
      startedAt: Date.parse('2026-09-29T00:00:00Z'),
      endsAt: Date.parse('2026-09-29T00:10:00Z'),
    }),
  );
  assert.equal(onServerBuilt.mock.calls.length, 1);
  // 로컬 BUILD 는 부르지 않는다
  assert.equal(build.mock.calls.length, 0);
});

test('회관을 지은 뒤에는 게시판을 짓는 카드가 뜬다', async () => {
  const screen = await render(
    <FinalIsland
      state={serverState('host', ['hall'])}
      go={jest.fn()}
      build={jest.fn()}
      onServerBuilt={jest.fn()}
    />,
  );
  expect(screen.getByText('게시판 짓기')).toBeTruthy();
});

test('주민(member)에게는 서버 건설 카드가 렌더링되지 않는다', async () => {
  const screen = await render(
    <FinalIsland
      state={serverState('member')}
      go={jest.fn()}
      build={jest.fn()}
      onServerBuilt={jest.fn()}
    />,
  );
  expect(screen.queryByTestId('server-build-card')).toBeNull();
  expect(screen.queryByText('건설하기')).toBeNull();
});
