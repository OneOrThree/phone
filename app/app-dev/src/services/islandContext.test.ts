import assert from 'node:assert/strict';
import {
  displayIsland,
  homeIsland,
  initialState,
  isHost,
  reducer,
  residentCount,
  viewIsland,
  type State,
} from '@/services/model';
import type { IslandSummary } from '@/services/api/islands';
import type { HomeWorldFacts } from '@/services/homeSnapshot';

const summary = (id: string): IslandSummary => ({
  id,
  name: `${id} 서버 섬`,
  intro: '실제 소개',
  visibility: 'public',
  approvalRequired: false,
  memberCount: 4,
  maxMembers: 15,
  membershipStatus: 'active',
  joinRequestId: null,
  growthStage: null,
  themeId: null,
});
const sync = (state: State, id: string | null) =>
  reducer(state, {
    type: 'ISLAND_SYNC',
    memberships: {
      items: [summary('a'), summary('b')],
      currentIslandId: id,
      nextCursor: null,
      lossReason: null,
    },
    mainIslandId: 'b',
  });
const home = (state: State, id: string, role: 'member' | 'host') =>
  reducer(state, {
    type: 'SERVER_HOME',
    facts: {
      islandId: id,
      completedBuildings: ['hall', 'board'],
      home: {
        island: { ...summary(id), role, version: 1 },
        wallets: { villagePoints: 42 },
        playback: null,
      },
    } as unknown as HomeWorldFacts,
  });

test('서버 표시 섬은 목업 이름·주민·시설을 이어받지 않는다', () => {
  const state = sync(initialState(true), 'a');
  const island = displayIsland(state);
  assert.equal(island.id, 'a');
  assert.equal(island.name, 'a 서버 섬');
  assert.deepEqual(island.buildings, []);
  assert.deepEqual(island.members, []);
  assert.equal(isHost(island), false);
  assert.equal(residentCount(island), 4);
});

test('서버 주민은 빈 표시용 주민 목록이어도 방장이 되지 않는다', () => {
  let state = home(sync(initialState(true), 'a'), 'a', 'member');
  assert.equal(isHost(displayIsland(state)), false);
  assert.deepEqual(displayIsland(state).buildings, ['hall', 'board']);
  state = home(state, 'a', 'host');
  assert.equal(isHost(displayIsland(state)), true);
});

test('소속이 있지만 현재 섬을 고르기 전에는 다른 섬을 대신 표시하지 않는다', () => {
  const state = sync(initialState(true), null);
  assert.equal(displayIsland(state).id, '');
  assert.equal(displayIsland(state).name, '');
  assert.equal(displayIsland(state).joined, false);
});

test('현재 섬 변경 뒤 이전 홈 응답은 새 섬의 시설 정보를 덮어쓰지 않는다', () => {
  let state = sync(home(sync(initialState(true), 'a'), 'a', 'host'), 'b');
  state = home(state, 'a', 'host');
  assert.equal(state.serverIslands?.home, null);
  assert.equal(displayIsland(state).name, 'b 서버 섬');
  assert.equal(isHost(displayIsland(state)), false);
});
