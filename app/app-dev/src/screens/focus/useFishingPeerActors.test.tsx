import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react-native';
import { useFishingPeerActors, type FishingPeer } from '@/screens/focus/useFishingPeerActors';
import type { IslandPresenceTransition, LiveFocusMember } from '@/services/islandRealtime';
import { PEER_SPOTS, LANDING } from '@/screens/focus/FishingIsland';

const peer: FishingPeer = {
  userId: 'u1',
  sessionId: 's1',
  name: '주민',
  color: 'ginger',
  subject: '수학',
  seconds: 0,
  status: 'active',
};
const member = (status: 'active' | 'paused') =>
  ({
    ...peer,
    catColor: 'ginger',
    appearance: null,
    activeSeconds: 0,
    anchorMs: 0,
    status,
  }) as LiveFocusMember;

test('최초 스냅숏은 즉시 배치하고 active→paused→active 동안 같은 자리를 예약한다', async () => {
  const { result } = await renderHook(() =>
    useFishingPeerActors({ members: [peer], ready: true, reduce: false }),
  );
  assert.equal(result.current.actors[0].phase, 'fishing');
  const seat = result.current.actors[0].spot;
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u1',
      previous: member('active'),
      current: member('paused'),
    } as IslandPresenceTransition),
  );
  assert.equal(result.current.actors[0].phase, 'leaving-pause');
  const generation = result.current.actors[0].generation;
  await act(async () => result.current.leftForPause('u1:s1', generation));
  assert.equal(result.current.actors[0].phase, 'paused');
  assert.deepEqual(result.current.actors[0].spot, seat);
  assert.equal(result.current.actors[0].visible, false);
  await act(async () =>
    result.current.onTransition({
      source: 'event-gap',
      kind: 'focus',
      userId: 'u1',
      previous: member('paused'),
      current: member('active'),
    } as IslandPresenceTransition),
  );
  assert.equal(result.current.actors[0].phase, 'entering');
  assert.deepEqual(result.current.actors[0].spot, seat);
  assert.deepEqual(result.current.actors[0].position, LANDING);
  assert.ok(PEER_SPOTS.includes(seat));
});

test('종료는 stretch 이후 이동을 마쳐야 자리를 반납한다', async () => {
  const { result } = await renderHook(() =>
    useFishingPeerActors({ members: [peer], ready: true, reduce: false }),
  );
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u1',
      previous: member('active'),
      current: null,
    } as IslandPresenceTransition),
  );
  assert.equal(result.current.actors[0].phase, 'finishing');
  const generation = result.current.actors[0].generation;
  await act(async () => result.current.stretched('u1:s1', generation));
  const exitGeneration = result.current.actors[0].generation;
  assert.equal(result.current.actors[0].phase, 'leaving-complete');
  await act(async () => result.current.leftForComplete('u1:s1', exitGeneration));
  assert.equal(result.current.actors.length, 0);
});

test('재연결 스냅숏은 입장 모션을 재생하지 않고 즉시 교체한다', async () => {
  const peer2 = { ...peer, userId: 'u2', sessionId: 's2', name: '새 주민' };
  let members: FishingPeer[] = [peer],
    snapshotVersion = 1;
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({
      members,
      ready: true,
      reduce: false,
      realtime: true,
      snapshotVersion,
    }),
  );

  assert.deepEqual(
    result.current.actors.map((actor) => actor.userId),
    ['u1'],
  );
  members = [peer2];
  snapshotVersion = 2;
  await rerender(undefined);
  assert.deepEqual(
    result.current.actors.map((actor) => actor.userId),
    ['u2'],
  );
  assert.equal(result.current.actors[0].phase, 'fishing');
  assert.deepEqual(result.current.actors[0].position, result.current.actors[0].spot);
});

test('퇴장 중 바로 재개하면 이전 퇴장을 취소하고 같은 자리로 돌아온다', async () => {
  const { result } = await renderHook(() =>
    useFishingPeerActors({ members: [peer], ready: true, reduce: false }),
  );
  const seat = result.current.actors[0].spot;
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u1',
      previous: member('active'),
      current: member('paused'),
    }),
  );
  const staleExitGeneration = result.current.actors[0].generation;
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u1',
      previous: member('paused'),
      current: member('active'),
    }),
  );

  assert.equal(result.current.actors[0].phase, 'entering');
  assert.deepEqual(result.current.actors[0].spot, seat);
  await act(async () => result.current.leftForPause('u1:s1', staleExitGeneration));
  assert.equal(result.current.actors[0].phase, 'entering');
  assert.equal(result.current.actors[0].visible, true);
});
