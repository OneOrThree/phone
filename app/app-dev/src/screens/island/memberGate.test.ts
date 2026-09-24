/** GROMO-2138 — 서버 모드 주민 화면 가드는 로컬 목업 섬이 아니라 서버 current·홈 스냅샷으로 판정한다. */
import assert from 'node:assert/strict';
import { memberGate } from '@/screens/island/CurrentScreens';
import { initialState, reducer, State } from '@/services/model';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const act = (s: State, type: string, p: Record<string, unknown> = {}) =>
  reducer(s, { type, ...p } as never);
const synced = (current: string | null) =>
  act(initialState(), 'ISLAND_SYNC', {
    memberships: {
      items: current ? [{ id: current, name: '서버 섬' }] : [],
      nextCursor: null,
      currentIslandId: current,
      lossReason: null,
    },
  });

test('서버 current 가 있으면 로컬 목업 섬과 무관하게 주민이고, 스냅샷 전에는 건물을 잠그지 않는다', () => {
  const gate = memberGate(synced('srv1'), true);
  assert.equal(gate.joined, true);
  assert.equal(gate.built, undefined);
  assert.equal(gate.host, false);
});

test('스냅샷이 오면 완공 건물과 방장 여부를 서버 값으로 판정한다', () => {
  const s = act(synced('srv1'), 'SERVER_HOME', {
    facts: { islandId: 'srv1', completedBuildings: ['hall'], home: { island: { role: 'host' } } },
  });
  const gate = memberGate(s, true);
  assert.deepEqual([...(gate.built ?? [])], ['hall']);
  assert.equal(gate.host, true);
});

test('서버 current 가 없으면 주민이 아니다', () => {
  assert.equal(memberGate(synced(null), true).joined, false);
});
