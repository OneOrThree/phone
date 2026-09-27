import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react-native';
import {
  fishingSpotsForActors,
  useFishingPeerActors,
  type FishingPeer,
} from '@/screens/focus/useFishingPeerActors';
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
  assert.equal(fishingSpotsForActors(result.current.actors).length, 1);
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
  assert.equal(fishingSpotsForActors(result.current.actors).length, 0);
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
  assert.equal(fishingSpotsForActors(result.current.actors).length, 0);
  assert.deepEqual(result.current.actors[0].spot, seat);
  assert.deepEqual(result.current.actors[0].position, LANDING);
  assert.ok(PEER_SPOTS.includes(seat));
  const enterGeneration = result.current.actors[0].generation;
  await act(async () => result.current.entered('u1:s1', enterGeneration));
  assert.equal(result.current.actors[0].phase, 'casting');
  assert.equal(fishingSpotsForActors(result.current.actors).length, 0);
  const castGeneration = result.current.actors[0].generation;
  await act(async () => result.current.cast('u1:s1', castGeneration));
  assert.equal(fishingSpotsForActors(result.current.actors).length, 1);
});

test('채널이 ready가 아니면 이전 actor·자리·대기 전이를 모두 비운다', async () => {
  let members: FishingPeer[] = [peer],
    ready = true,
    snapshotVersion = 1;
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({ members, ready, reduce: false, snapshotVersion }),
  );
  assert.equal(result.current.actors.length, 1);

  ready = false;
  members = [];
  await rerender(undefined);
  assert.equal(result.current.actors.length, 0);

  ready = true;
  snapshotVersion = 2;
  members = [{ ...peer, userId: 'u2', sessionId: 's2' }];
  await rerender(undefined);
  assert.equal(result.current.actors[0].key, 'u2:s2');
  assert.equal(result.current.actors[0].slot, 0);
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

  const previousSpot = result.current.actors[0].spot;
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
  assert.deepEqual(result.current.actors[0].spot, previousSpot);
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

test('같은 주민의 active 세션이 교체되면 이전 actor를 남기지 않고 같은 슬롯에서 다시 입장한다', async () => {
  const { result } = await renderHook(() =>
    useFishingPeerActors({ members: [peer], ready: true, reduce: false }),
  );
  const previous = member('active'),
    current = { ...member('active'), sessionId: 's2' };
  const seat = result.current.actors[0].spot;

  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u1',
      previous,
      current,
    }),
  );

  assert.equal(result.current.actors.length, 1);
  assert.equal(result.current.actors[0].key, 'u1:s2');
  assert.equal(result.current.actors[0].phase, 'entering');
  assert.deepEqual(result.current.actors[0].spot, seat);
});

test('완료 퇴장 중 새 세션이 시작되면 퇴장 actor와 슬롯을 새 actor로 교체한다', async () => {
  let members: FishingPeer[] = [peer];
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({ members, ready: true, reduce: false }),
  );
  const seat = result.current.actors[0].spot;

  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u1',
      previous: member('active'),
      current: null,
    }),
  );
  const finishingGeneration = result.current.actors[0].generation;
  await act(async () => result.current.stretched('u1:s1', finishingGeneration));
  const staleExitGeneration = result.current.actors[0].generation;

  const nextPeer = { ...peer, sessionId: 's2' };
  members = [nextPeer];
  await rerender(undefined);
  await act(async () =>
    result.current.onTransition({
      source: 'event-gap',
      kind: 'focus',
      userId: 'u1',
      previous: null,
      current: { ...member('active'), sessionId: 's2' },
    }),
  );

  assert.equal(result.current.actors.length, 1);
  assert.equal(result.current.actors[0].key, 'u1:s2');
  assert.equal(result.current.actors[0].phase, 'entering');
  assert.deepEqual(result.current.actors[0].spot, seat);
  assert.equal(new Set(result.current.actors.map((actor) => actor.slot)).size, 1);

  await act(async () => result.current.leftForComplete('u1:s1', staleExitGeneration));
  assert.equal(result.current.actors.length, 1);
  assert.equal(result.current.actors[0].key, 'u1:s2');
});

test('event-gap에서 처음 확인된 paused 주민도 숨긴 actor와 자리를 예약한다', async () => {
  const pausedPeer = { ...peer, userId: 'u2', sessionId: 's2', status: 'paused' as const };
  let members: FishingPeer[] = [peer];
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({ members, ready: true, reduce: false, snapshotVersion: 1 }),
  );
  members = [peer, pausedPeer];
  await rerender(undefined);

  const paused = { ...member('paused'), userId: 'u2', sessionId: 's2' };
  await act(async () =>
    result.current.onTransition({
      source: 'event-gap',
      kind: 'focus',
      userId: 'u2',
      previous: null,
      current: paused,
    }),
  );

  const actor = result.current.actors.find((item) => item.key === 'u2:s2');
  assert.equal(actor?.phase, 'paused');
  assert.equal(actor?.visible, false);
  assert.notEqual(actor?.slot, result.current.actors.find((item) => item.key === 'u1:s1')?.slot);
});

test('재동기화 중 replay된 전이는 스냅숏 기준 상태에서 모션을 시작한다', async () => {
  let members: FishingPeer[] = [peer],
    snapshotVersion = 1,
    snapshotTransitions: IslandPresenceTransition[] = [];
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({
      members,
      ready: true,
      reduce: false,
      snapshotVersion,
      snapshotTransitions,
    }),
  );
  const transition: IslandPresenceTransition = {
    source: 'event',
    kind: 'focus',
    userId: 'u1',
    previous: member('active'),
    current: member('paused'),
  };
  members = [{ ...peer, status: 'paused' }];
  snapshotVersion = 2;
  snapshotTransitions = [transition];
  await rerender(undefined);

  assert.equal(result.current.actors[0].phase, 'fishing');
  await act(async () => result.current.onTransition(transition));
  assert.equal(result.current.actors[0].phase, 'leaving-pause');
});

test('방문 화면의 최대 정원 15명에게 서로 다른 자리를 배정한다', async () => {
  const peers = Array.from({ length: 15 }, (_, index) => ({
    ...peer,
    userId: `u${index}`,
    sessionId: `s${index}`,
  }));
  const { result } = await renderHook(() =>
    useFishingPeerActors({ members: peers, ready: true, reduce: false }),
  );

  assert.equal(result.current.actors.length, 15);
  assert.equal(new Set(result.current.actors.map((actor) => actor.slot)).size, 15);
  assert.equal(new Set(result.current.actors.map((actor) => actor.spot)).size, 15);
});

test('만석에서 퇴장 중 새 주민은 빈 자리가 생긴 뒤 입장한다', async () => {
  let peers = Array.from({ length: 15 }, (_, index) => ({
    ...peer,
    userId: `u${index}`,
    sessionId: `s${index}`,
  }));
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({
      members: peers,
      ready: true,
      reduce: false,
      realtime: true,
      snapshotVersion: 1,
    }),
  );
  const leavingMember = { ...member('active'), userId: 'u14', sessionId: 's14' };
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u14',
      previous: leavingMember,
      current: null,
    }),
  );
  const stretchGeneration = result.current.actors.find(
    (actor) => actor.key === 'u14:s14',
  )!.generation;
  await act(async () => result.current.stretched('u14:s14', stretchGeneration));
  const exitGeneration = result.current.actors.find((actor) => actor.key === 'u14:s14')!.generation;

  const newcomer = { ...peer, userId: 'u15', sessionId: 's15', status: 'active' as const };
  peers = [...peers.slice(0, 14), newcomer];
  await rerender(undefined);
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u15',
      previous: null,
      current: { ...member('active'), userId: 'u15', sessionId: 's15' },
    }),
  );
  assert.equal(
    result.current.actors.some((actor) => actor.key === 'u15:s15'),
    false,
  );

  await act(async () => result.current.leftForComplete('u14:s14', exitGeneration));
  const entrant = result.current.actors.find((actor) => actor.key === 'u15:s15');
  assert.equal(entrant?.phase, 'entering');
  assert.equal(entrant?.slot, 14);
  assert.equal(new Set(result.current.actors.map((actor) => actor.slot)).size, 15);
});

test('Reduce Motion이 퇴장 슬롯을 즉시 반환해도 보류된 입장을 재처리한다', async () => {
  let reduce = false;
  let peers = Array.from({ length: 15 }, (_, index) => ({
    ...peer,
    userId: `u${index}`,
    sessionId: `s${index}`,
  }));
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({ members: peers, ready: true, reduce, snapshotVersion: 1 }),
  );
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u14',
      previous: { ...member('active'), userId: 'u14', sessionId: 's14' },
      current: null,
    }),
  );
  const generation = result.current.actors.find((actor) => actor.key === 'u14:s14')!.generation;
  await act(async () => result.current.stretched('u14:s14', generation));
  peers = [...peers.slice(0, 14), { ...peer, userId: 'u15', sessionId: 's15' }];
  await rerender(undefined);
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u15',
      previous: null,
      current: { ...member('active'), userId: 'u15', sessionId: 's15' },
    }),
  );
  assert.equal(
    result.current.actors.some((actor) => actor.key === 'u15:s15'),
    false,
  );

  reduce = true;
  await rerender(undefined);
  assert.equal(
    result.current.actors.some((actor) => actor.key === 'u14:s14'),
    false,
  );
  assert.equal(
    result.current.actors.some((actor) => actor.key === 'u15:s15'),
    true,
  );
});

test('만석에서 보류된 주민이 먼저 완료되면 이후 빈 슬롯에 입장시키지 않는다', async () => {
  let peers = Array.from({ length: 15 }, (_, index) => ({
    ...peer,
    userId: `u${index}`,
    sessionId: `s${index}`,
  }));
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({ members: peers, ready: true, reduce: false, snapshotVersion: 1 }),
  );
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u14',
      previous: { ...member('active'), userId: 'u14', sessionId: 's14' },
      current: null,
    }),
  );
  const stretchGeneration = result.current.actors.find(
    (actor) => actor.key === 'u14:s14',
  )!.generation;
  await act(async () => result.current.stretched('u14:s14', stretchGeneration));
  const exitGeneration = result.current.actors.find((actor) => actor.key === 'u14:s14')!.generation;

  const newcomer = { ...peer, userId: 'u15', sessionId: 's15' };
  peers = [...peers.slice(0, 14), newcomer];
  await rerender(undefined);
  const liveNewcomer = { ...member('active'), userId: 'u15', sessionId: 's15' };
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u15',
      previous: null,
      current: liveNewcomer,
    }),
  );
  peers = peers.slice(0, 14);
  await rerender(undefined);
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u15',
      previous: liveNewcomer,
      current: null,
    }),
  );
  await act(async () => result.current.leftForComplete('u14:s14', exitGeneration));
  assert.equal(
    result.current.actors.some((actor) => actor.key === 'u15:s15'),
    false,
  );
});

test('숨겨진 paused 주민 완료로 슬롯이 반환되면 보류된 입장을 재처리한다', async () => {
  let peers = Array.from({ length: 15 }, (_, index) => ({
    ...peer,
    userId: `u${index}`,
    sessionId: `s${index}`,
    status: index === 14 ? ('paused' as const) : ('active' as const),
  }));
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({ members: peers, ready: true, reduce: false, snapshotVersion: 1 }),
  );
  assert.equal(result.current.actors.find((actor) => actor.key === 'u14:s14')?.visible, false);

  const newcomer = { ...peer, userId: 'u15', sessionId: 's15', status: 'active' as const };
  peers = [...peers.slice(0, 14), newcomer];
  await rerender(undefined);
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u15',
      previous: null,
      current: { ...member('active'), userId: 'u15', sessionId: 's15' },
    }),
  );
  assert.equal(
    result.current.actors.some((actor) => actor.key === 'u15:s15'),
    false,
  );
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u14',
      previous: { ...member('paused'), userId: 'u14', sessionId: 's14' },
      current: null,
    }),
  );

  assert.equal(
    result.current.actors.some((actor) => actor.key === 'u14:s14'),
    false,
  );
  assert.equal(
    result.current.actors.some((actor) => actor.key === 'u15:s15'),
    true,
  );
  assert.equal(new Set(result.current.actors.map((actor) => actor.slot)).size, 15);
});
