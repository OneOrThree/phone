import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react-native';
import {
  fishingSpotsForActors,
  useFishingPeerActors,
  type FishingPeer,
} from '@/screens/focus/useFishingPeerActors';
import type { IslandPresenceTransition, LiveFocusMember } from '@/services/islandRealtime';
import {
  castSpot,
  catchOverlapsCat,
  DEFAULT_CATCH_PLACEMENT,
  DEFAULT_SPOT,
  fishingCatchPlacement,
  PEER_SPOTS,
  LANDING,
  fishingGrid,
  occupied,
  underDefaultCatch,
} from '@/screens/focus/FishingIsland';
import { onLand } from '@/utils/world-grid';
import { markUserBlocked, markUserUnblocked, replaceBlockedUsers } from '@/services/blockedUsers';

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

// GROMO-2478 — 서버가 준 자리(seat)에 앉히고, 못 쓰는 자리·내 자리 곁 칸은 슬롯 배정으로 비켜 간다.
test('seat 가 땅 위면 그 자리, null·범위 밖·물이면 슬롯에 앉힌다', async () => {
  const members: FishingPeer[] = [
    { ...peer, userId: 'seated', sessionId: 's-a', seat: DEFAULT_SPOT },
    { ...peer, userId: 'none', sessionId: 's-b', seat: null },
    { ...peer, userId: 'outside', sessionId: 's-c', seat: { x: 340, y: 55.9 } },
    { ...peer, userId: 'water', sessionId: 's-d', seat: { x: 0, y: 0 } },
  ];
  const { result } = await renderHook(() =>
    useFishingPeerActors({ members, ready: true, reduce: false }),
  );
  const [seated, none, outside, water] = result.current.actors;
  assert.deepEqual([seated.spot.x, seated.spot.y], [DEFAULT_SPOT.x, DEFAULT_SPOT.y]);
  assert.equal(seated.slot, -1);
  assert.deepEqual(
    [none, outside, water].map((actor) => actor.slot),
    [0, 1, 2],
  );
});

test('이벤트로 들어온 주민도 seat 자리에 앉는다(active·paused)', async () => {
  const seat = { x: PEER_SPOTS[3].x, y: PEER_SPOTS[3].y };
  let members: FishingPeer[] = [];
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({ members, ready: true, reduce: false, snapshotVersion: 1 }),
  );
  members = [
    { ...peer, seat: DEFAULT_SPOT },
    { ...peer, userId: 'u2', sessionId: 's2', status: 'paused', seat },
  ];
  await rerender(undefined);
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u1',
      previous: null,
      current: { ...member('active'), seat: DEFAULT_SPOT },
    } as IslandPresenceTransition),
  );
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u2',
      previous: null,
      current: { ...member('paused'), userId: 'u2', sessionId: 's2', seat },
    } as IslandPresenceTransition),
  );
  const at = (userId: string) => {
    const spot = result.current.actors.find((actor) => actor.userId === userId)?.spot;
    return [spot?.x, spot?.y];
  };
  assert.deepEqual(at('u1'), [DEFAULT_SPOT.x, DEFAULT_SPOT.y]);
  assert.deepEqual(at('u2'), [seat.x, seat.y]);
});

test('슬롯 배정은 내 자리(SEAT_GAP) 곁 칸을 건너뛰고, 내 자리 곁 seat 도 슬롯으로 비켜 간다', async () => {
  const members: FishingPeer[] = [
    { ...peer, userId: 'u1', sessionId: 's1' },
    {
      ...peer,
      userId: 'u2',
      sessionId: 's2',
      seat: { x: PEER_SPOTS[0].x + 1, y: PEER_SPOTS[0].y },
    },
  ];
  const { result } = await renderHook(() =>
    useFishingPeerActors({ members, ready: true, reduce: false, mine: PEER_SPOTS[0] }),
  );
  // 칸 0 은 내 자리 곁이라 건너뛴다 — 쓸 수 있는 seat 가 없어 스냅숏 순서대로 u1 은 칸 1, 내 자리에 막힌 u2 는 칸 2
  assert.deepEqual(
    result.current.actors.map((actor) => actor.slot),
    [1, 2],
  );
});

test('내 자리가 고정 칸 둘을 막아도 정원 안 주민 14명은 모두 겹치지 않게 앉는다', async () => {
  const mine = { x: 75, y: 52 };
  assert.equal(PEER_SPOTS.filter((spot) => occupied(spot, [mine])).length, 2);
  const members = Array.from({ length: 14 }, (_, index) => ({
    ...peer,
    userId: `u${index}`,
    sessionId: `s${index}`,
  }));
  const { result } = await renderHook(() =>
    useFishingPeerActors({ members, ready: true, reduce: false, mine }),
  );
  const spots = result.current.actors.map((actor) => actor.spot);
  assert.equal(spots.length, 14);
  spots.forEach((spot, index) =>
    assert.equal(occupied(spot, [mine, ...spots.filter((_, other) => other !== index)]), false),
  );
});

test('같은 주민의 세션이 교체되면 이전 자리 곁으로 옮긴 새 seat 를 그대로 쓴다', async () => {
  const before = { x: 34.1, y: 55.9 },
    after = { x: 35.1, y: 55.9 };
  const { result } = await renderHook(() =>
    useFishingPeerActors({ members: [{ ...peer, seat: before }], ready: true, reduce: false }),
  );
  assert.deepEqual(
    [result.current.actors[0].spot.x, result.current.actors[0].spot.y],
    [34.1, 55.9],
  );
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u1',
      previous: { ...member('active'), seat: before },
      current: { ...member('active'), sessionId: 's2', seat: after },
    } as IslandPresenceTransition),
  );
  assert.equal(result.current.actors.length, 1);
  assert.equal(result.current.actors[0].key, 'u1:s2');
  assert.deepEqual(
    [result.current.actors[0].spot.x, result.current.actors[0].spot.y],
    [35.1, 55.9],
  );
});

test('스냅숏에서 좌표 없는 주민이 앞에 와도 뒤 주민의 서버 seat 를 먼저 예약한다', async () => {
  const seat = { x: PEER_SPOTS[0].x, y: PEER_SPOTS[0].y };
  const { result } = await renderHook(() =>
    useFishingPeerActors({
      members: [
        { ...peer, userId: 'none', sessionId: 's-none', seat: null },
        { ...peer, userId: 'seated', sessionId: 's-seated', seat },
      ],
      ready: true,
      reduce: false,
    }),
  );
  const [none, seated] = result.current.actors;
  assert.deepEqual([seated.spot.x, seated.spot.y], [seat.x, seat.y]);
  assert.equal(occupied(none.spot, [seated.spot]), false);
});

test('내가 자리로 걷는 사이 같은 seat 로 들어온 주민은 내 자리가 정해지면 비켜 앉고, 풀리면 돌아온다', async () => {
  let members: FishingPeer[] = [],
    mine: { x: number; y: number } | undefined;
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({ members, ready: true, reduce: true, snapshotVersion: 1, mine }),
  );
  members = [{ ...peer, seat: DEFAULT_SPOT }];
  await rerender(undefined);
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'u1',
      previous: null,
      current: { ...member('active'), seat: DEFAULT_SPOT },
    } as IslandPresenceTransition),
  );
  const at = () => [result.current.actors[0].spot.x, result.current.actors[0].spot.y];
  assert.deepEqual(at(), [DEFAULT_SPOT.x, DEFAULT_SPOT.y]);
  mine = DEFAULT_SPOT; // 걷기를 마치고 준비 화면 — 내 자리가 생긴다
  await rerender(undefined);
  assert.equal(occupied(result.current.actors[0].spot, [DEFAULT_SPOT]), false);
  mine = undefined;
  await rerender(undefined);
  assert.deepEqual(at(), [DEFAULT_SPOT.x, DEFAULT_SPOT.y]);
});

test('서버 자리 주민의 물고기 그림은 곁 주민 고양이를 덮지 않는다', async () => {
  const first = { x: 60.2, y: 44.1 },
    second = { x: 75, y: 45 };
  // 회피 없이 정한 첫 주민의 물고기 자리는 둘째 고양이를 덮는다(그러면 둘째의 판정이 null)
  const naive = { ...castSpot(first), catchPlacement: fishingCatchPlacement(castSpot(first)) };
  assert.equal(fishingCatchPlacement(castSpot(second), [naive]), null);
  const { result } = await renderHook(() =>
    useFishingPeerActors({
      members: [
        { ...peer, userId: 'a', sessionId: 's-a', seat: first },
        { ...peer, userId: 'b', sessionId: 's-b', seat: second },
      ],
      ready: true,
      reduce: false,
    }),
  );
  const [a, b] = result.current.actors;
  assert.deepEqual([a.spot.x, b.spot.x], [first.x, second.x]);
  assert.ok(a.spot.catchPlacement);
  assert.notEqual(fishingCatchPlacement(castSpot(second), [a.spot]), null);
});

test('스냅숏은 서버 seat 를 전부 먼저 예약한 뒤 내 자리에 막힌 주민의 대체 칸을 정한다', async () => {
  const seatB = { x: PEER_SPOTS[0].x, y: PEER_SPOTS[0].y },
    members: FishingPeer[] = [
      { ...peer, userId: 'a', sessionId: 's-a', seat: DEFAULT_SPOT },
      { ...peer, userId: 'b', sessionId: 's-b', seat: seatB },
    ];
  let mine: { x: number; y: number } | undefined = DEFAULT_SPOT;
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({ members, ready: true, reduce: false, mine }),
  );
  const at = (index: number) => {
    const spot = result.current.actors[index].spot;
    return [spot.x, spot.y];
  };
  // A 가 내 자리에 막혀 대체 칸(0번)을 먼저 가져가면 B 의 정상 seat 까지 밀려난다
  assert.deepEqual(at(1), [seatB.x, seatB.y]);
  assert.equal(occupied(result.current.actors[0].spot, [DEFAULT_SPOT, seatB]), false);
  mine = undefined;
  await rerender(undefined);
  assert.deepEqual(at(0), [DEFAULT_SPOT.x, DEFAULT_SPOT.y]);
  assert.deepEqual(at(1), [seatB.x, seatB.y]);
});

test('내가 DEFAULT_SPOT 에 앉으면 고정 물고기 더미 아래 seat 주민은 비켜 앉고, 다른 자리로 옮기면 돌아온다', async () => {
  // 내 고양이와는 SEAT_GAP 보다 멀어 거리 검사는 통과하지만 고정 더미(DEFAULT_CATCH_PLACEMENT)가 고양이를 덮는 땅 자리
  const seat = { x: 20, y: 59 },
    members = [{ ...peer, seat }];
  assert.ok(onLand(fishingGrid, seat));
  assert.equal(occupied(seat, [DEFAULT_SPOT]), false);
  assert.ok(underDefaultCatch(seat));
  let mine: { x: number; y: number } | undefined = DEFAULT_SPOT;
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({ members, ready: true, reduce: false, mine }),
  );
  const at = () => [result.current.actors[0].spot.x, result.current.actors[0].spot.y];
  assert.notDeepEqual(at(), [seat.x, seat.y]);
  assert.equal(underDefaultCatch(result.current.actors[0].spot), false);
  // DEFAULT_SPOT 이 아닌 땅 자리 — 내 물고기 더미는 화면이 주민을 피해 정한다
  mine = { x: PEER_SPOTS[1].x, y: PEER_SPOTS[1].y };
  await rerender(undefined);
  assert.deepEqual(at(), [seat.x, seat.y]);
  // 다시 DEFAULT_SPOT 에 앉는 순간 더미 아래 주민을 비켜 앉힌다(내 자리 변경 effect)
  mine = DEFAULT_SPOT;
  await rerender(undefined);
  assert.equal(underDefaultCatch(result.current.actors[0].spot), false);
});

test('내가 DEFAULT_SPOT 에 앉으면 서버 자리 주민의 물고기 더미는 내 고정 더미를 피한다', async () => {
  // 물고기 프레임(고양이 크기 1.1배) 영역 — FishingIsland 의 catchBounds 와 같은 식
  const pile = (spot: { x: number; y: number }, placement: { left: number; top: number }) => {
      const left = spot.x + (placement.left - 0.5) * 7.7,
        top = spot.y + (placement.top - 0.90625) * 11.55;
      return { left, right: left + 8.47, top, bottom: top + 12.705 };
    },
    overlap = (a: ReturnType<typeof pile>, b: ReturnType<typeof pile>) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
    myPile = pile(DEFAULT_SPOT, DEFAULT_CATCH_PLACEMENT!),
    seat = { x: 24, y: 52 };
  // 땅 위이고 내 고양이 곁도 고정 더미 아래도 아니라 seat 그대로 앉지만, 내 고양이만 피한 더미는 내 고정 더미와 겹친다.
  // 고정 더미를 피하고도 곁에 더미 놓을 땅이 남는 자리다({x:27,y:46} 처럼 남지 않으면 더미를 숨긴다 — null)
  assert.ok(onLand(fishingGrid, seat));
  assert.equal(occupied(seat, [DEFAULT_SPOT]), false);
  assert.equal(underDefaultCatch(seat), false);
  const naive = fishingCatchPlacement(castSpot(seat), [castSpot(DEFAULT_SPOT)]);
  assert.ok(naive && overlap(pile(seat, naive), myPile));
  const { result } = await renderHook(() =>
    useFishingPeerActors({
      members: [{ ...peer, seat }],
      ready: true,
      reduce: false,
      mine: DEFAULT_SPOT,
    }),
  );
  const spot = result.current.actors[0].spot;
  assert.deepEqual([spot.x, spot.y], [seat.x, seat.y]);
  assert.deepEqual(
    spot.catchPlacement,
    fishingCatchPlacement(castSpot(seat), [
      { ...castSpot(DEFAULT_SPOT), catchPlacement: DEFAULT_CATCH_PLACEMENT },
    ]),
  );
  assert.ok(spot.catchPlacement);
  assert.equal(overlap(pile(seat, spot.catchPlacement), myPile), false);
});

test('종료 연출 중인 주민에 막혀 대체 칸에 앉은 seat 주민은 다음 스냅숏에서 서버 자리로 다시 앉는다', async () => {
  const seat = DEFAULT_SPOT,
    a = { ...peer, userId: 'a', sessionId: 's-a', seat },
    b = { ...peer, userId: 'b', sessionId: 's-b', seat },
    live = (userId: string, sessionId: string) => ({
      ...member('active'),
      userId,
      sessionId,
      seat,
    });
  let members: FishingPeer[] = [a],
    snapshotVersion = 1;
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({ members, ready: true, reduce: false, snapshotVersion }),
  );
  const actor = (userId: string) => result.current.actors.find((item) => item.userId === userId);
  // A 가 완료해 종료 연출(finishing)로 자리를 쥔 사이 B 가 같은 seat 로 들어온다 → B 는 대체 칸
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'a',
      previous: live('a', 's-a'),
      current: null,
    } as IslandPresenceTransition),
  );
  assert.equal(actor('a')?.phase, 'finishing');
  members = [b];
  await rerender(undefined);
  await act(async () =>
    result.current.onTransition({
      source: 'event',
      kind: 'focus',
      userId: 'b',
      previous: null,
      current: live('b', 's-b'),
    } as IslandPresenceTransition),
  );
  assert.notDeepEqual([actor('b')?.spot.x, actor('b')?.spot.y], [seat.x, seat.y]);
  // A 가 퇴장을 마쳐 자리를 반납해도 이벤트 경로는 B 를 다시 앉히지 않는다
  await act(async () => result.current.stretched('a:s-a', actor('a')!.generation));
  await act(async () => result.current.leftForComplete('a:s-a', actor('a')!.generation));
  assert.equal(actor('a'), undefined);
  // 새 스냅숏(B 만)은 정본 — B 의 예약을 서버 seat 로 재검증한다
  snapshotVersion = 2;
  await rerender(undefined);
  assert.deepEqual([actor('b')?.spot.x, actor('b')?.spot.y], [seat.x, seat.y]);
});

test('재동기화 스냅숏은 좌표 없는 주민이 쥔 칸도 풀어, 그 칸을 seat 로 받은 새 주민을 먼저 앉힌다', async () => {
  const seat = { x: PEER_SPOTS[0].x, y: PEER_SPOTS[0].y },
    a = { ...peer, userId: 'a', sessionId: 's-a', seat: null },
    b = { ...peer, userId: 'b', sessionId: 's-b', seat };
  let members: FishingPeer[] = [a],
    snapshotVersion = 1;
  const { result, rerender } = await renderHook(() =>
    useFishingPeerActors({ members, ready: true, reduce: false, snapshotVersion }),
  );
  const actor = (userId: string) => result.current.actors.find((item) => item.userId === userId)!;
  assert.equal(actor('a').slot, 0);
  members = [a, b];
  snapshotVersion = 2;
  await rerender(undefined);
  assert.deepEqual([actor('b').spot.x, actor('b').spot.y], [seat.x, seat.y]);
  assert.notEqual(actor('a').slot, 0);
  assert.equal(occupied(actor('a').spot, [actor('b').spot]), false);
  // 처음 연 화면(같은 스냅숏을 바로 받은 기기)과 배치가 같다
  const fresh = await renderHook(() =>
    useFishingPeerActors({ members: [a, b], ready: true, reduce: false }),
  );
  assert.deepEqual(
    result.current.actors.map((item) => [item.spot.x, item.spot.y]),
    fresh.result.current.actors.map((item) => [item.spot.x, item.spot.y]),
  );
});

test('고정 칸(PEER_SPOTS)의 미리 정한 물고기 더미가 서버 자리 주민 고양이를 덮으면 다시 정한다', async () => {
  const seat = { x: 9, y: 39 },
    fixed = PEER_SPOTS[0].catchPlacement!;
  // 고정 칸 0 과는 SEAT_GAP 보다 멀어 둘 다 앉지만, 칸 0 의 미리 정한 더미는 이 seat 고양이를 덮는다
  assert.ok(onLand(fishingGrid, seat));
  assert.equal(occupied(seat, [PEER_SPOTS[0]]), false);
  assert.ok(catchOverlapsCat(PEER_SPOTS[0], fixed, seat));
  const { result } = await renderHook(() =>
    useFishingPeerActors({
      members: [
        { ...peer, userId: 'a', sessionId: 's-a', seat },
        { ...peer, userId: 'b', sessionId: 's-b', seat: null },
      ],
      ready: true,
      reduce: false,
    }),
  );
  const [a, b] = result.current.actors;
  assert.deepEqual([a.spot.x, a.spot.y, b.slot], [seat.x, seat.y, 0]);
  assert.ok(
    b.spot.catchPlacement === null || !catchOverlapsCat(b.spot, b.spot.catchPlacement!, a.spot),
  );
});

test('서버 자리 주민이 없으면 고정 칸의 물고기 더미는 미리 정한 값 그대로다', async () => {
  const members = Array.from({ length: PEER_SPOTS.length }, (_, index) => ({
    ...peer,
    userId: `u${index}`,
    sessionId: `s${index}`,
  }));
  const { result } = await renderHook(() =>
    useFishingPeerActors({ members, ready: true, reduce: false, mine: DEFAULT_SPOT }),
  );
  // 내 자리(DEFAULT_SPOT)는 고정 칸과 멀어 정원 15칸이 모두 찬다
  assert.equal(result.current.actors.length, PEER_SPOTS.length);
  for (const actor of result.current.actors)
    assert.equal(actor.spot.catchPlacement, PEER_SPOTS[actor.slot].catchPlacement);
});

test('차단한 주민(GROMO-2470)은 자리를 쥔 채 숨고(낚싯줄 없음) 다른 주민 슬롯은 스냅숏을 다시 받아도 그대로, 해제하면 같은 자리에 다시 보인다', async () => {
  replaceBlockedUsers([]);
  const members: FishingPeer[] = [
    { ...peer, userId: 'blocked', sessionId: 's-a' },
    { ...peer, userId: 'other', sessionId: 's-b' },
  ];
  const { result, rerender } = await renderHook(
    (p: { snapshotVersion: number }) =>
      useFishingPeerActors({
        members,
        ready: true,
        reduce: false,
        realtime: true,
        snapshotVersion: p.snapshotVersion,
      }),
    { initialProps: { snapshotVersion: 1 } },
  );
  const before = result.current.actors.map((actor) => [actor.userId, actor.slot, actor.spot]);
  assert.deepEqual(
    before.map(([id, slot]) => [id, slot]),
    [
      ['blocked', 0],
      ['other', 1],
    ],
  );
  // UserSafetySheet 의 차단 성공 신호 — 화면을 다시 열지 않아도 바로 숨는다
  await act(async () => markUserBlocked('blocked'));
  const hidden = result.current.actors.find((actor) => actor.userId === 'blocked')!;
  assert.equal(hidden.visible, false);
  assert.equal(hidden.spot, before[0][2]);
  assert.deepEqual(fishingSpotsForActors(result.current.actors), [before[1][2]]);
  // 재연결 스냅숏(같은 명단)이 와도 숨은 주민이 자리를 쥐고 있어 다른 주민이 0번으로 옮기지 않는다
  await rerender({ snapshotVersion: 2 });
  const other = result.current.actors.find((actor) => actor.userId === 'other')!;
  assert.equal(other.slot, 1);
  assert.equal(result.current.actors.find((actor) => actor.userId === 'blocked')!.visible, false);
  await act(async () => markUserUnblocked('blocked'));
  const back = result.current.actors.find((actor) => actor.userId === 'blocked')!;
  assert.equal(back.visible, true);
  assert.equal(back.slot, 0);
  await act(async () => replaceBlockedUsers([]));
});
