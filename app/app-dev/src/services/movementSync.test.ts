/**
 * 이동 동기화 순수 로직(GROMO-2248) — 명령 번호·ready 게이트·낡은 경로 무시·서버 대기,
 * 스냅샷 버퍼(PathAccepted 전 폐기·경로 위 거리 보간·300ms 정지·Arrived 고정), 정지 상태 보정.
 */
import assert from 'node:assert/strict';
import {
  createMovementController,
  remainingPath,
  sameCells,
  SERVER_LAG_MS,
  SnapshotBuffer,
  type MoveIntent,
  type RemotePosition,
} from '@/services/movementSync';
import type { WorldPoint } from '@/utils/worldCoords';

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SPAWN = { x: 38.5, y: 45.5 };

const actor = (userId: string, at: WorldPoint, over: object = {}) => ({
  userId,
  ...at,
  state: 'IDLE',
  pathId: 0,
  lastCommandSeq: 0,
  ...over,
});
const fullState = (actors: object[], over: object = {}) => ({
  type: 'FullState',
  navRevision: 1,
  serverTick: 100,
  tickMs: 50,
  speed: 10.989,
  actors,
  ...over,
});
const pathAccepted = (
  userId: string,
  commandSeq: number,
  pathId: number,
  start: WorldPoint,
  waypoints: WorldPoint[],
) => ({
  type: 'PathAccepted',
  userId,
  commandSeq,
  pathId,
  navRevision: 1,
  startTick: 101,
  start,
  goal: waypoints[waypoints.length - 1] ?? start,
  speed: 10.989,
  waypoints,
});
const arrived = (userId: string, pathId: number, position: WorldPoint) => ({
  type: 'Arrived',
  userId,
  pathId,
  serverTick: 120,
  position,
});
const snapshot = (serverTick: number, entities: object[]) => ({
  type: 'Snapshot',
  serverTick,
  navRevision: 1,
  entities,
});
const entity = (userId: string, pathId: number, at: WorldPoint, over: object = {}) => ({
  userId,
  pathId,
  ...at,
  segmentIndex: 0,
  state: 'MOVING',
  lastCommandSeq: 0,
  ...over,
});

const setup = (start: WorldPoint = SPAWN) => {
  const sent: MoveIntent[] = [];
  const paths: [WorldPoint[], number, number, WorldPoint][] = [];
  const arrivals: WorldPoint[] = [];
  const corrections: WorldPoint[] = [];
  const remote: [string, RemotePosition][] = [];
  const env = { here: start, walking: false, clock: 0 };
  const controller = createMovementController({
    me: ME,
    send: (intent) => {
      sent.push(intent);
      return true;
    },
    position: () => env.here,
    walking: () => env.walking,
    now: () => env.clock,
    onMyPath: (...args) => paths.push(args),
    onMyArrived: (p) => arrivals.push(p),
    onMyCorrection: (p) => corrections.push(p),
    onRemotePosition: (userId, p) => remote.push([userId, p]),
  });
  return { controller, sent, paths, arrivals, corrections, remote, env };
};
const ready = (start: WorldPoint = SPAWN, others: object[] = []) => {
  const t = setup(start);
  t.controller.onMessage(fullState([actor(ME, start), ...others]));
  return t;
};

describe('명령(MoveIntent)', () => {
  test('FullState 전에는 목적지를 보내지 않고(로컬만), ready 가 되면 마지막 목적지 하나만 보낸다', () => {
    const t = setup();
    assert.equal(t.controller.intend({ x: 50, y: 50 }), false);
    assert.equal(t.controller.intend({ x: 60.123, y: 40.456 }), false);
    assert.deepEqual(t.sent, []);
    assert.equal(t.controller.state().ready, false);
    t.controller.onMessage(fullState([actor(ME, SPAWN)]));
    assert.deepEqual(t.sent, [{ commandSeq: 1, navRevision: 1, goalX: 60.12, goalY: 40.46 }]);
    assert.equal(t.controller.state().ready, true);
  });

  test('commandSeq 는 1부터 늘고 목적지는 소수 2자리, navRevision 은 FullState 값을 되돌려 보낸다', () => {
    const t = setup();
    t.controller.onMessage(fullState([actor(ME, SPAWN)], { navRevision: 3 }));
    assert.equal(t.controller.intend({ x: 67.456, y: 27.501 }), true);
    assert.equal(t.controller.intend({ x: 10, y: 10 }), true);
    assert.deepEqual(t.sent, [
      { commandSeq: 1, navRevision: 3, goalX: 67.46, goalY: 27.5 },
      { commandSeq: 2, navRevision: 3, goalX: 10, goalY: 10 },
    ]);
  });

  test('서버가 이미 처리한 번호(FullState 의 lastCommandSeq)는 다시 쓰지 않는다', () => {
    const t = setup();
    t.controller.onMessage(fullState([actor(ME, SPAWN, { lastCommandSeq: 7 })]));
    t.controller.intend({ x: 40, y: 40 });
    assert.equal(t.sent[0].commandSeq, 8);
  });

  test('월드 범위 밖·비유한 목적지는 보내지 않는다(경계 100 은 안쪽)', () => {
    const t = ready();
    for (const goal of [
      { x: 100.01, y: 3 },
      { x: -0.01, y: 3 },
      { x: 3, y: 101 },
      { x: Number.NaN, y: 3 },
      { x: 3, y: Number.POSITIVE_INFINITY },
    ])
      assert.equal(t.controller.intend(goal), false);
    assert.deepEqual(t.sent, []);
    assert.equal(t.controller.intend({ x: 100, y: 0 }), true);
  });

  test('보낸 목적지에 2초 넘게 응답이 없으면 serverLag, PathAccepted 가 오면 풀린다', () => {
    const t = ready();
    t.controller.intend({ x: 42.5, y: 45.5 });
    t.env.clock = SERVER_LAG_MS - 1;
    assert.equal(t.controller.state().serverLag, false);
    t.env.clock = SERVER_LAG_MS + 1;
    assert.equal(t.controller.state().serverLag, true);
    t.controller.onMessage(pathAccepted(ME, 1, 1, SPAWN, [{ x: 39.5, y: 45.5 }]));
    assert.equal(t.controller.state().serverLag, false);
  });

  test('거절(deny) 뒤에는 보내지도 받지도 않는다', () => {
    const t = ready();
    t.controller.deny();
    assert.equal(t.controller.intend({ x: 40, y: 40 }), false);
    t.controller.onMessage(fullState([actor(ME, SPAWN)]));
    assert.deepEqual(t.sent, []);
    assert.equal(t.controller.state().denied, true);
  });

  test('FullState 에서 내 actor 가 빠지면 목적지를 보내지 않는다(로컬 폴백)', () => {
    const t = ready();
    t.controller.onMessage(fullState([actor(B, { x: 40.5, y: 45.5 })]));
    assert.equal(t.controller.intend({ x: 40, y: 40 }), false);
    assert.deepEqual(t.sent, []);
  });
});

describe('내 경로(PathAccepted·Arrived)', () => {
  test('옛 commandSeq 의 PathAccepted 는 무시하고 최신 명령의 경로만 채택한다', () => {
    const t = ready();
    t.controller.intend({ x: 42.5, y: 45.5 });
    t.controller.intend({ x: 42.5, y: 46.5 });
    t.controller.onMessage(pathAccepted(ME, 1, 5, SPAWN, [{ x: 39.5, y: 45.5 }]));
    assert.deepEqual(t.paths, []);
    const waypoints = [
      { x: 39.5, y: 46.5 },
      { x: 40.5, y: 46.5 },
    ];
    t.controller.onMessage(pathAccepted(ME, 2, 6, SPAWN, waypoints));
    assert.deepEqual(t.paths, [[waypoints, 10.989, 6, SPAWN]]);
    assert.equal(t.controller.state().lastPath?.pathId, 6);
  });

  test('내 Arrived 는 현재 경로일 때만 — 더 새 명령을 보내 두었으면 옛 경로 도착은 무시한다', () => {
    const t = ready();
    t.controller.intend({ x: 40.5, y: 45.5 });
    t.controller.onMessage(pathAccepted(ME, 1, 7, SPAWN, [{ x: 39.5, y: 45.5 }]));
    t.controller.onMessage(arrived(ME, 6, { x: 1, y: 1 }));
    assert.deepEqual(t.arrivals, []);
    t.controller.intend({ x: 44.5, y: 45.5 });
    t.controller.onMessage(arrived(ME, 7, { x: 40.5, y: 45.5 }));
    assert.deepEqual(t.arrivals, []);
    t.controller.onMessage(pathAccepted(ME, 2, 8, SPAWN, [{ x: 39.5, y: 45.5 }]));
    t.controller.onMessage(arrived(ME, 8, { x: 39.5, y: 45.5 }));
    assert.deepEqual(t.arrivals, [{ x: 39.5, y: 45.5 }]);
  });
});

describe('정지 상태 보정(onMyCorrection)', () => {
  test('FullState 의 내 위치는 1 unit 보다 가까워도 채택한다 — 스폰 차이 보정', () => {
    const t = setup({ x: 38.02, y: 46.09 });
    t.controller.onMessage(fullState([actor(ME, SPAWN)]));
    assert.deepEqual(t.corrections, [SPAWN]);
  });

  test('걷는 중에 온 FullState 는 내 위치를 덮지 않는다', () => {
    const t = setup({ x: 38.02, y: 46.09 });
    t.env.walking = true;
    t.controller.onMessage(fullState([actor(ME, SPAWN)]));
    assert.deepEqual(t.corrections, []);
  });

  test('둘 다 멈췄을 때 스냅샷의 내 위치가 1 unit 보다 멀 때만 맞춘다', () => {
    const t = ready();
    t.controller.onMessage(snapshot(110, [entity(ME, 0, { x: 39.3, y: 45.5 }, { state: 'IDLE' })]));
    assert.deepEqual(t.corrections, [], '0.8 unit 은 무시한다');
    t.controller.onMessage(snapshot(111, [entity(ME, 0, { x: 40, y: 45.5 }, { state: 'IDLE' })]));
    assert.deepEqual(t.corrections, [{ x: 40, y: 45.5 }], '1.5 unit 은 맞춘다');
    assert.equal(typeof t.controller.state().lastCorrectionAt, 'number');
  });

  test('서버가 걷는 중이거나 내가 걷는 중이면 차이가 커도 맞추지 않는다(지연만큼 뒤처진 위치)', () => {
    const t = ready();
    t.controller.onMessage(snapshot(110, [entity(ME, 0, { x: 43, y: 45.5 })]));
    t.env.walking = true;
    t.controller.onMessage(snapshot(111, [entity(ME, 0, { x: 43, y: 45.5 }, { state: 'IDLE' })]));
    assert.deepEqual(t.corrections, []);
    // 내 걷기가 끝나면(settle) 다시 판단한다.
    t.env.walking = false;
    t.controller.settle();
    assert.deepEqual(t.corrections, [{ x: 43, y: 45.5 }]);
  });

  test('서버가 내 최신 명령을 아직 처리하지 않았으면 맞추지 않는다', () => {
    const t = ready();
    t.controller.intend({ x: 42.5, y: 45.5 });
    t.controller.onMessage(snapshot(110, [entity(ME, 0, { x: 43, y: 45.5 }, { state: 'IDLE' })]));
    assert.deepEqual(t.corrections, []);
  });
});

describe('다른 주민 스냅샷 버퍼', () => {
  test('PathAccepted 전에 온 스냅샷(pathId 3)은 버리고, 경로를 받은 뒤 같은 스냅샷은 채택한다', () => {
    const t = ready(SPAWN, [actor(B, SPAWN)]);
    t.remote.length = 0;
    const snap = snapshot(12350, [entity(B, 3, { x: 39.21, y: 44.79 }, { segmentIndex: 1 })]);
    t.controller.onMessage(snap);
    assert.deepEqual(t.remote, []);
    t.controller.onMessage(
      pathAccepted(B, 7, 3, SPAWN, [
        { x: 39.5, y: 44.5 },
        { x: 40.5, y: 43.5 },
      ]),
    );
    t.controller.onMessage(snap);
    assert.deepEqual(t.remote, [[B, { x: 39.21, y: 44.79, moving: true }]]);
  });

  // ㄱ자 경로: (10.5,10.5) → 오른쪽 2칸 → 아래 2칸. 모서리는 (12.5,10.5).
  const corner = [
    { x: 10.5, y: 10.5 },
    { x: 11.5, y: 10.5 },
    { x: 12.5, y: 10.5 },
    { x: 12.5, y: 11.5 },
    { x: 12.5, y: 12.5 },
  ];
  const sample = (serverTick: number, at: WorldPoint, pathId = 1) => ({
    serverTick,
    pathId,
    ...at,
    segmentIndex: 0,
    moving: true,
  });
  const xyOf = (p: RemotePosition | null) => p && { x: p.x, y: p.y };

  test('보간은 경로 위 누적 거리로 한다 — ㄱ자 경로에서 모서리 안쪽 점을 내지 않는다', () => {
    const buf = new SnapshotBuffer();
    buf.addPath(B, 1, corner);
    assert.equal(buf.push(B, sample(10, { x: 11.5, y: 10.5 })), true);
    assert.equal(buf.push(B, sample(12, { x: 12.5, y: 11.5 })), true);
    // 직선 보간이면 (12, 11) — 건물 모서리를 관통한다. 경로 위 거리 보간은 모서리 꼭짓점이다.
    assert.deepEqual(xyOf(buf.positionAt(B, 11)), { x: 12.5, y: 10.5 });
    buf.push(B, sample(14, { x: 12.5, y: 12.5 }));
    // (12.5,11.5) → (12.5,12.5) 의 가운데 — 세로 다리 위.
    assert.deepEqual(xyOf(buf.positionAt(B, 13)), { x: 12.5, y: 12 });
  });

  test('샘플이 1개면 그 점, 데이터 끝 너머는 외삽하지 않는다', () => {
    const buf = new SnapshotBuffer();
    buf.addPath(B, 1, corner);
    buf.push(B, sample(10, { x: 11.5, y: 10.5 }));
    assert.deepEqual(buf.positionAt(B, 8), { x: 11.5, y: 10.5, moving: true });
    assert.deepEqual(buf.positionAt(B, 12), { x: 11.5, y: 10.5, moving: true });
  });

  test('샘플이 300ms(6틱) 이상 끊기면 보간하지 않고 마지막 점에 멈춘다', () => {
    const buf = new SnapshotBuffer();
    buf.addPath(B, 1, [
      { x: 10.5, y: 10.5 },
      { x: 20.5, y: 10.5 },
    ]);
    buf.push(B, sample(10, { x: 11.5, y: 10.5 }));
    buf.push(B, sample(16, { x: 17.5, y: 10.5 }));
    assert.deepEqual(buf.positionAt(B, 13), { x: 11.5, y: 10.5, moving: false });
    // 마지막 샘플 뒤 6틱이 지나면 걷는 자세도 멈춘다.
    assert.deepEqual(buf.positionAt(B, 21), { x: 17.5, y: 10.5, moving: true });
    assert.deepEqual(buf.positionAt(B, 22), { x: 17.5, y: 10.5, moving: false });
  });

  test('샘플은 주민당 최근 8개만 두고 지난 틱·모르는 경로 샘플은 버린다', () => {
    const buf = new SnapshotBuffer();
    buf.addPath(B, 1, [
      { x: 0.5, y: 10.5 },
      { x: 30.5, y: 10.5 },
    ]);
    for (let tick = 1; tick <= 10; tick++) buf.push(B, sample(tick, { x: tick + 0.5, y: 10.5 }));
    // 첫 두 샘플(1·2틱)은 밀려났다 — 그 앞 렌더 틱은 남은 가장 오래된 샘플(3틱)에 선다.
    assert.deepEqual(xyOf(buf.positionAt(B, 1)), { x: 3.5, y: 10.5 });
    assert.equal(buf.push(B, sample(10, { x: 9, y: 10.5 })), false);
    assert.equal(buf.push(B, sample(11, { x: 9, y: 10.5 }, 2)), false);
  });

  test('새 pathId 의 PathAccepted 뒤 늦게 온 이전 경로의 샘플은 버리고(되돌아가지 않음), 새 경로의 샘플은 채택한다', () => {
    const buf = new SnapshotBuffer();
    buf.addPath(B, 1, corner);
    assert.equal(buf.push(B, sample(10, { x: 11.5, y: 10.5 }, 1)), true);
    buf.addPath(B, 2, [
      { x: 12.5, y: 12.5 },
      { x: 13.5, y: 12.5 },
    ]);
    // tick 은 last(10) 보다 새롭지만(11>10) pathId(1)가 latestPathId(2)보다 오래됐다 — 버린다.
    assert.equal(buf.push(B, sample(11, { x: 12, y: 10.5 }, 1)), false);
    assert.equal(buf.push(B, sample(12, { x: 13, y: 12.5 }, 2)), true);
    // 거부된 path1 샘플로 되돌아가지 않고 path2 위에 선다.
    assert.deepEqual(xyOf(buf.positionAt(B, 12)), { x: 13, y: 12.5 });
  });

  test('Arrived 가 오면 도착점에 고정하고 샘플을 비운다 — 같은 경로의 늦은 좌표도 무시한다', () => {
    const buf = new SnapshotBuffer();
    buf.addPath(B, 1, corner);
    buf.push(B, sample(10, { x: 11.5, y: 10.5 }));
    buf.push(B, sample(11, { x: 12, y: 10.5 }));
    assert.equal(buf.arrive(B, 1, { x: 12.5, y: 12.5 }), true);
    assert.deepEqual(buf.positionAt(B, 9), { x: 12.5, y: 12.5, moving: false });
    assert.equal(buf.push(B, sample(12, { x: 12.5, y: 11 })), false);
    // 새 경로를 받으면 다시 움직인다.
    buf.addPath(B, 2, [
      { x: 12.5, y: 12.5 },
      { x: 13.5, y: 12.5 },
    ]);
    assert.equal(buf.push(B, sample(13, { x: 13, y: 12.5 }, 2)), true);
    assert.deepEqual(buf.positionAt(B, 11), { x: 13, y: 12.5, moving: true });
  });
});

describe('경로 비교·갈아타기', () => {
  test('sameCells 는 셀 열이 같은지만 본다', () => {
    const a = [
      { x: 39.5, y: 45.5 },
      { x: 40.5, y: 45.5 },
    ];
    assert.equal(
      sameCells(a, [
        { x: 39.2, y: 45.9 },
        { x: 40.5, y: 45.5 },
      ]),
      true,
    );
    assert.equal(sameCells(a, [{ x: 39.5, y: 45.5 }]), false);
    assert.equal(
      sameCells(a, [
        { x: 39.5, y: 46.5 },
        { x: 40.5, y: 46.5 },
      ]),
      false,
    );
  });

  test('remainingPath 는 지금 자리를 경로에 투영해 이미 지난 꼭짓점으로 되돌아가지 않는다', () => {
    const path = [
      { x: 38.5, y: 45.5 },
      { x: 39.5, y: 44.5 },
      { x: 40.5, y: 43.5 },
      { x: 41.5, y: 43.5 },
    ];
    // 서버 출발점보다 앞서 (40.2,44.1) 근처까지 와 있다 — 두 번째 선분 위.
    assert.deepEqual(remainingPath(path, { x: 40.2, y: 44.1 }), path.slice(2));
    assert.deepEqual(remainingPath(path, path[0]), path.slice(1));
    assert.deepEqual(remainingPath([path[0]], path[0]), []);
  });
});
