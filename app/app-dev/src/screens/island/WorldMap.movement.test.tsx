/**
 * 홈 섬 이동 동기화 배선(GROMO-2248) — 플래그 on + 타일 섬 + 서버 홈이면 이동 전용 채널을 열고,
 * 내 고양이는 서버 확정 경로·도착을 따르며 다른 주민은 Wanderer 대신 서버 위치(RemoteResident)로 그린다.
 * 플래그 off·목업 섬·채널 거절이면 이 PR 이전과 같다(채널 없음·로컬 걷기·Wanderer).
 */
import React from 'react';
import { Animated } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { initialState } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';
import type { IslandChannelOpts } from '@/services/islandRealtime';
import { imageToWorld, worldToImage, worldToCell, type WorldPoint } from '@/utils/worldCoords';
import { loadNav } from '@/utils/nav-path';
// tilePath 를 하나의 탭에서만 가짜로 바꾸는 스파이용 — 네임스페이스로 가져와야 jest.spyOn 대상이 된다.
import * as navPathModule from '@/utils/nav-path';
import bundledNavJson from '@/assets/village-world/v1/nav.json';

// jest.mock 팩토리는 mock 접두 변수만 참조할 수 있다.
const mockLayoutHeight = 874;
jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: mockLayoutHeight,
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
// 캔버스는 Skia mock 에서 그려지지 않는다 — 호스트 뷰로만 둔다(WorldMap.tileIsland.test.tsx 와 같다).
jest.mock('./TileTerrainCanvas', () => {
  const { View } = require('react-native');
  return {
    ...jest.requireActual('./TileTerrainCanvas'),
    TileTerrainCanvas: (props: object) => <View testID="tile-terrain" {...props} />,
  };
});
// 고양이 스프라이트는 자세(motion)·색만 드러내는 호스트 뷰로 바꾼다.
jest.mock('@/components/CatSprite', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    ...jest.requireActual('@/components/CatSprite'),
    CatSprite: ({ testID, motion, color }: { testID?: string; motion?: string; color: string }) =>
      ReactActual.createElement(View, {
        testID: testID ?? 'mock-cat-sprite',
        testPropMotion: motion,
        testPropColor: color,
      }),
  };
});
// 이동 채널은 가짜로 바꿔 서버 메시지를 직접 흘린다. 격리 로드한 모듈이 연 채널도 같은 배열에 모인다.
type MockChannel = { opts: IslandChannelOpts; send: jest.Mock; close: jest.Mock };
const mockChannels: MockChannel[] = [];
jest.mock('@/services/islandRealtime', () => ({
  ...jest.requireActual('@/services/islandRealtime'),
  stompIslandChannel: (opts: unknown) => {
    const channel = {
      opts,
      send: jest.fn(() => true),
      setEmoteEnabled: jest.fn(),
      reopen: jest.fn(),
      close: jest.fn(),
    };
    mockChannels.push(channel as never);
    return channel;
  },
}));
// 이동 보기 오버레이(GROMO-2249)는 controller.subscribe() 로 알림을 받는다 — 구독 호출 자체를 스파이로 확인한다.
// 실제 컨트롤러 로직은 그대로 두고 subscribe 만 jest.fn 으로 감싼다.
type MockController = ReturnType<
  typeof import('@/services/movementSync').createMovementController
> & {
  subscribe: jest.Mock;
};
const controllers: MockController[] = [];
jest.mock('@/services/movementSync', () => {
  const actual = jest.requireActual('@/services/movementSync');
  return {
    ...actual,
    createMovementController: (opts: Parameters<typeof actual.createMovementController>[0]) => {
      const controller = actual.createMovementController(opts);
      const wrapped = { ...controller, subscribe: jest.fn(controller.subscribe) };
      controllers.push(wrapped);
      return wrapped;
    },
  };
});

// 플래그는 모듈 로드 때 상수로 굳는다 — env 를 먼저 세우고 require 한다(import 는 호이스팅된다).
process.env.EXPO_PUBLIC_TILE_ISLAND = '1';
process.env.EXPO_PUBLIC_MOVEMENT_SYNC = '1';
const { FinalIsland } = require('./WorldMap') as typeof import('./WorldMap');

const ME = 'a0000000-0000-4000-8000-000000000001';
const U1 = 'a0000000-0000-4000-8000-000000000002';
const U2 = 'a0000000-0000-4000-8000-000000000003';
// 명단에 있지만 털색을 고르지 않았다(catColor null) — 임의 색으로 그리지 않는다.
const U3 = 'a0000000-0000-4000-8000-000000000004';
// 명단(facts.members)에 없다.
const STRANGER = 'a0000000-0000-4000-8000-000000000005';
// 서버 스폰 = nav.json spawns.character (38,45) 셀 중심.
const SPAWN = { x: 38.5, y: 45.5 };
const SIZE = { imageWidth: 1536, imageHeight: 1024 };
// 운영 식: WorldMap.tsx 의 홈 카메라 배율 `(((L.height / 874) * 402) / 1536) * 2.8`(z=1).
const SCALE = (((mockLayoutHeight / 874) * 402) / 1536) * 2.8;
// homePositions 는 섬별 모듈 상태라 테스트마다 새 섬 id 를 쓴다.
let islandSeq = 0;
const nextIsland = () => `b0000000-0000-4000-8000-${String(++islandSeq).padStart(12, '0')}`;

const member = (id: string, catColor: string | null) => ({
  id,
  name: `주민-${id.slice(-1)}`,
  catColor,
  role: 'member',
  appearance: null,
});
const serverState = (islandId: string) => {
  const state = initialState();
  state.serverIslands = {
    memberships: [],
    currentIslandId: islandId,
    lossReason: null,
    candidates: [],
    nextCursor: null,
    visit: null,
    joinRequests: [],
    requestStatus: [],
    home: {
      islandId,
      home: {
        island: {
          id: islandId,
          name: '이동섬',
          intro: '',
          approvalRequired: false,
          maxMembers: 15,
          role: 'member',
        },
        wallets: { villagePoints: 0 },
        focusSummary: { totalSeconds: 0 },
      },
      completedBuildings: ['hall'],
      members: [member(ME, 'cream'), member(U1, 'ginger'), member(U2, 'white'), member(U3, null)],
    },
    clientConstruction: null,
  } as never;
  return state;
};

const actor = (userId: string, at: WorldPoint, over: object = {}) => ({
  userId,
  ...at,
  state: 'IDLE',
  pathId: 0,
  lastCommandSeq: 0,
  ...over,
});
const fullState = (actors: object[]) => ({
  type: 'FullState',
  navRevision: 1,
  serverTick: 100,
  tickMs: 50,
  speed: 10.989,
  actors,
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
  serverTick: 130,
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

type Screen = Awaited<ReturnType<typeof render>>;
const channel = () => mockChannels[mockChannels.length - 1];
const emit = (body: unknown) => act(async () => channel().opts.onEvent(body));
const flat = (style: unknown) => Object.assign({}, ...[style].flat(3)) as Record<string, number>;
// 내 고양이 컨테이너(left = x·s − hit/2, top = y·s − cat/2 − hit/2)에서 월드 좌표를 되돌린다.
const myCat = (screen: Screen) => {
  const st = flat(screen.getByTestId('home-cat-container').props.style);
  return imageToWorld(
    {
      x: (st.left + st.width / 2) / SCALE,
      y: (st.top + (70 * SCALE) / 2 + st.height / 2) / SCALE,
    },
    SIZE,
  );
};
const myMotion = (screen: Screen) => screen.getByTestId('home-cat-sprite').props.testPropMotion;
const residentAt = (screen: Screen, userId: string) => {
  const st = flat(screen.getByTestId(`remote-resident-${userId}`).props.style);
  return imageToWorld({ x: st.left / SCALE, y: st.top / SCALE }, SIZE);
};
const residentMotion = (screen: Screen, userId: string) =>
  within(screen.getByTestId(`remote-resident-${userId}`)).getByTestId('mock-cat-sprite').props
    .testPropMotion;
const residents = (screen: Screen) =>
  screen
    .queryAllByTestId(/^remote-resident-/)
    .map((n) => n.props.testID)
    .sort();
// 이름 없는 고양이 스프라이트 = Wanderer 또는 RemoteResident(내 고양이는 home-cat-sprite).
const otherCats = (screen: Screen) => screen.queryAllByTestId('mock-cat-sprite').length;
// 바닥 탭 — 지형 Pressable 은 접근성에서 빠져 있어(accessible=false) 이미지 전체 크기로 찾는다.
const tapGround = async (screen: Screen, at: WorldPoint) => {
  const [ground] = screen.container.queryAll(
    (n) =>
      n.props.accessible === false &&
      Math.abs((flat(n.props.style).width ?? 0) - SIZE.imageWidth * SCALE) < 1e-6,
  );
  const px = worldToImage(at, SIZE);
  await fireEvent.press(ground, {
    nativeEvent: { locationX: px.x * SCALE, locationY: px.y * SCALE },
  });
};
// 걷기가 끝날 때까지 50ms 씩 돌리며 지나간 위치를 모은다.
const walkToEnd = async (screen: Screen) => {
  const trail: WorldPoint[] = [];
  for (let i = 0; i < 200 && myMotion(screen) === 'walking'; i++) {
    await act(async () => jest.advanceTimersByTime(50));
    trail.push(myCat(screen));
  }
  return trail;
};
const renderHome = (islandId: string, props: object = {}) =>
  render(<FinalIsland state={serverState(islandId)} go={jest.fn()} build={jest.fn()} {...props} />);

beforeEach(async () => {
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: ME });
});
afterEach(() => {
  jest.useRealTimers();
});

it('바닥을 탭하면 로컬로 곧장 걷고 같은 목적지를 intent 1건으로 보낸다(commandSeq 1, 월드 좌표) — 떠나면 채널을 닫는다', async () => {
  jest.useFakeTimers();
  const island = nextIsland();
  const screen = await renderHome(island);
  expect(channel().opts).toMatchObject({
    islandId: island,
    presence: false,
    emote: false,
    movement: true,
  });
  await emit(fullState([actor(ME, SPAWN)]));
  await tapGround(screen, { x: 42.5, y: 45.5 });
  expect(channel().send.mock.calls).toEqual([
    [
      `/app/islands/${island}/movement/intent`,
      { commandSeq: 1, navRevision: 1, goalX: 42.5, goalY: 45.5 },
    ],
  ]);
  expect(myMotion(screen)).toBe('walking');
  const opened = channel();
  await screen.unmount();
  expect(opened.close).toHaveBeenCalled();
});

it('섬 전환 뒤 옛 채널로 FullState 를 흘려도 새 섬의 위치·주민 목록이 안 바뀐다(닫히는 중 도착한 메시지)', async () => {
  jest.useFakeTimers();
  const islandA = nextIsland();
  const islandB = nextIsland();
  const screen = await renderHome(islandA);
  await emit(fullState([actor(ME, SPAWN), actor(U1, { x: 40.5, y: 45.5 })]));
  const oldChannel = channel();
  await screen.rerender(
    <FinalIsland state={serverState(islandB)} go={jest.fn()} build={jest.fn()} />,
  );
  const newSpawn = { x: 10.5, y: 10.5 };
  await emit(fullState([actor(ME, newSpawn), actor(U2, { x: 20.5, y: 20.5 })]));
  const expectedCat = myCat(screen);
  const expectedResidents = residents(screen);
  // 옛 채널(A)로 늦게 도착한 FullState — close() 의 deactivate() 가 끝나기 전 도착한 메시지를 흉내낸다.
  await act(async () =>
    oldChannel.opts.onEvent(fullState([actor(ME, SPAWN), actor(U1, { x: 40.5, y: 45.5 })])),
  );
  expect(myCat(screen)).toEqual(expectedCat);
  expect(residents(screen)).toEqual(expectedResidents);
  await screen.unmount();
});

it('FullState 의 내 actor 위치를 채택한다 — 옛 격자 스폰과 서버 스폰의 차이를 맞춘다', async () => {
  const screen = await renderHome(nextIsland());
  const before = myCat(screen);
  expect(Math.hypot(before.x - SPAWN.x, before.y - SPAWN.y)).toBeGreaterThan(0.1);
  await emit(fullState([actor(ME, SPAWN)]));
  const after = myCat(screen);
  expect(after.x).toBeCloseTo(SPAWN.x, 6);
  expect(after.y).toBeCloseTo(SPAWN.y, 6);
  await screen.unmount();
});

it('PathAccepted 경로가 로컬과 다르면 지금 자리에서 서버 경로로 갈아타고(뒤로 돌아가지 않음) 걷는 중 받은 Arrived 위치에 선다', async () => {
  jest.useFakeTimers();
  const screen = await renderHome(nextIsland());
  await emit(fullState([actor(ME, SPAWN)]));
  // 로컬 A*: 오른쪽으로 곧장 4칸(39.5..42.5, 45.5).
  await tapGround(screen, { x: 42.5, y: 45.5 });
  // 왕복 지연 동안 로컬로 1칸 반쯤 먼저 걸어 나간다.
  await act(async () => jest.advanceTimersByTime(150));
  const ahead = myCat(screen);
  expect(ahead.x).toBeGreaterThan(SPAWN.x + 1);
  // 서버는 한 줄 아래로 가는 경로를 확정했다.
  await emit(
    pathAccepted(ME, 1, 1, SPAWN, [
      { x: 39.5, y: 46.5 },
      { x: 40.5, y: 46.5 },
      { x: 41.5, y: 46.5 },
      { x: 42.5, y: 46.5 },
    ]),
  );
  // 서버가 먼저 도착했다 — 걷기를 마친 뒤 그 자리에 선다.
  await emit(arrived(ME, 1, { x: 42.6, y: 46.4 }));
  const trail = await walkToEnd(screen);
  expect(myMotion(screen)).not.toBe('walking');
  // 이미 지나온 서버 꼭짓점(39.5,46.5)으로 되돌아가지 않는다.
  for (const p of trail) expect(p.x).toBeGreaterThanOrEqual(ahead.x - 1e-6);
  // 도착 위치에 서기 전부터(걷는 도중) 서버 경로의 아랫줄을 걷는다.
  expect(trail.slice(0, -1).some((p) => p.y > 46)).toBe(true);
  const end = myCat(screen);
  expect(end.x).toBeCloseTo(42.6, 6);
  expect(end.y).toBeCloseTo(46.4, 6);
  // 갈아타기는 새 명령을 보내지 않는다.
  expect(channel().send).toHaveBeenCalledTimes(1);
  await screen.unmount();
});

it('로컬 예측과 서버 경로가 멀리 떨어져 있어도 갈아탄 연결 구간은 인접한 통행 셀로만 잇는다(장애물 관통 금지)', async () => {
  jest.useFakeTimers();
  const screen = await renderHome(nextIsland());
  await emit(fullState([actor(ME, SPAWN)]));
  // 로컬 A*: 오른쪽으로 곧장(39.5..42.5, 45.5) — 아직 한 틱도 안 지났다(here == SPAWN).
  await tapGround(screen, { x: 42.5, y: 45.5 });
  // Animated.timing 을 즉시 끝내 갈아타는 걷기 전체를 한 번에 풀고, 거친 꼭짓점(toValue)을 전부 기록한다.
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(
    (_value: Animated.Value | Animated.ValueXY, _config: Animated.TimingAnimationConfig) =>
      ({
        start: (callback?: Animated.EndCallback) => callback?.({ finished: true }),
        stop: jest.fn(),
        reset: jest.fn(),
      }) as unknown as Animated.CompositeAnimation,
  );
  let verts: WorldPoint[] = [SPAWN];
  try {
    // 서버는 지금 자리(SPAWN)에서 4칸 떨어진 아래쪽 줄로 경로를 확정했다 — 직선이면 건너뛴다.
    await emit(
      pathAccepted(ME, 1, 1, SPAWN, [
        { x: 39.5, y: 49.5 },
        { x: 40.5, y: 49.5 },
        { x: 41.5, y: 49.5 },
      ]),
    );
    // mockRestore 는 mock.calls 기록도 지운다 — 복원 전에 먼저 읽어 둔다.
    verts = [
      SPAWN,
      ...timing.mock.calls.map((call) =>
        imageToWorld(
          (call[1] as Animated.TimingAnimationConfig).toValue as unknown as WorldPoint,
          SIZE,
        ),
      ),
    ];
  } finally {
    timing.mockRestore();
  }
  // 단일 직선 점프(here → rest[0], 꼭짓점 4개)가 아니라 로컬 A* 로 여러 꼭짓점을 거쳐 간다.
  expect(verts.length).toBeGreaterThan(4);
  const nav = loadNav(bundledNavJson as never, ['hall']);
  for (let i = 1; i < verts.length; i++) {
    const a = worldToCell(verts[i - 1]),
      b = worldToCell(verts[i]);
    // 8방향 인접(체비셰프 거리 1 이하) — 장애물 반대편으로 건너뛰지 않는다는 관찰 가능한 형태.
    expect(Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy))).toBeLessThanOrEqual(1);
    expect(nav.walkable[b.cy * nav.cols + b.cx]).toBe(1);
  }
  await screen.unmount();
});

it('같은 셀을 탭해도 intent 를 보내고, 빈 경로 PathAccepted 뒤 Arrived 로 서버 위치에 정지한다', async () => {
  jest.useFakeTimers();
  const screen = await renderHome(nextIsland());
  await emit(fullState([actor(ME, SPAWN)]));
  await tapGround(screen, { x: 38.7, y: 45.3 });
  expect(channel().send).toHaveBeenCalledWith(expect.any(String), {
    commandSeq: 1,
    navRevision: 1,
    goalX: 38.7,
    goalY: 45.3,
  });
  await emit(pathAccepted(ME, 1, 1, SPAWN, []));
  await emit(arrived(ME, 1, { x: 38.7, y: 45.3 }));
  expect(myMotion(screen)).toBe('idle');
  const at = myCat(screen);
  expect(at.x).toBeCloseTo(38.7, 6);
  expect(at.y).toBeCloseTo(45.3, 6);
  await screen.unmount();
});

it('도달 불가 탭은 로컬도 걷지 않고 서버 intent 도 보내지 않는다(tilePath 가 [])', async () => {
  jest.useFakeTimers();
  const screen = await renderHome(nextIsland());
  await emit(fullState([actor(ME, SPAWN)]));
  const spy = jest.spyOn(navPathModule, 'tilePath').mockReturnValueOnce([]);
  try {
    await tapGround(screen, { x: 42.5, y: 45.5 });
  } finally {
    spy.mockRestore();
  }
  expect(channel().send).not.toHaveBeenCalled();
  expect(myMotion(screen)).not.toBe('walking');
  await screen.unmount();
});

it('셀 열이 같아도 서버 speed 가 로컬과 다르면 남은 구간을 그 속도로 다시 걷는다', async () => {
  jest.useFakeTimers();
  const screen = await renderHome(nextIsland());
  await emit(fullState([actor(ME, SPAWN)]));
  // 로컬 A*: 오른쪽으로 곧장(39.5..42.5, 45.5) — 아직 한 틱도 안 지났다(here == SPAWN).
  await tapGround(screen, { x: 42.5, y: 45.5 });
  // Animated.timing 을 즉시 끝내 갈아타는 걷기 전체를 한 번에 풀고, duration 을 전부 기록한다.
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(
    (_value: Animated.Value | Animated.ValueXY, _config: Animated.TimingAnimationConfig) =>
      ({
        start: (callback?: Animated.EndCallback) => callback?.({ finished: true }),
        stop: jest.fn(),
        reset: jest.fn(),
      }) as unknown as Animated.CompositeAnimation,
  );
  let durations: number[] = [];
  try {
    // 서버는 로컬과 같은 셀 경로를 확정했지만 속도(1000/5=200ms/unit)는 로컬 기본값(91ms/unit)과 다르다.
    await emit({
      ...pathAccepted(ME, 1, 1, SPAWN, [
        { x: 39.5, y: 45.5 },
        { x: 40.5, y: 45.5 },
        { x: 41.5, y: 45.5 },
        { x: 42.5, y: 45.5 },
      ]),
      speed: 5,
    });
    durations = timing.mock.calls.map(
      (call) => (call[1] as Animated.TimingAnimationConfig).duration as number,
    );
  } finally {
    timing.mockRestore();
  }
  expect(durations.length).toBeGreaterThan(0);
  for (const d of durations) expect(d).toBeCloseTo(200, 1);
  await screen.unmount();
});

it('다른 주민은 FullState 로 Wanderer 대신 RemoteResident 가 되고 — 명단 밖·털색 미선택·나는 그리지 않는다 — 스냅샷 위치로 걷는다', async () => {
  jest.useFakeTimers();
  const screen = await renderHome(nextIsland());
  // FullState 전에는 이전처럼 Wanderer 둘(ginger·white).
  expect(residents(screen)).toEqual([]);
  expect(otherCats(screen)).toBe(2);
  await emit(
    fullState([
      actor(ME, SPAWN),
      actor(U1, { x: 40.5, y: 45.5 }),
      actor(U2, { x: 36.5, y: 45.5 }),
      actor(U3, { x: 38.5, y: 47.5 }),
      actor(STRANGER, { x: 41.5, y: 47.5 }),
    ]),
  );
  expect(residents(screen)).toEqual([`remote-resident-${U1}`, `remote-resident-${U2}`].sort());
  // Wanderer 는 사라지고 주민 둘만 남는다.
  expect(otherCats(screen)).toBe(2);
  expect(residentAt(screen, U2).x).toBeCloseTo(36.5, 6);
  expect(residentAt(screen, U2).y).toBeCloseTo(45.5, 6);
  // U1 의 경로를 받은 뒤 온 스냅샷 위치로 걷는다.
  await emit(
    pathAccepted(U1, 3, 1, { x: 40.5, y: 45.5 }, [
      { x: 41.5, y: 45.5 },
      { x: 42.5, y: 45.5 },
    ]),
  );
  await emit(
    snapshot(101, [
      entity(U1, 1, { x: 41, y: 45.5 }),
      entity(U2, 0, { x: 36.5, y: 45.5 }, { state: 'IDLE' }),
    ]),
  );
  await act(async () => jest.advanceTimersByTime(60));
  expect(residentAt(screen, U1).x).toBeCloseTo(41, 6);
  expect(residentMotion(screen, U1)).toBe('walking');
  // 300ms 넘게 위치가 안 오면 제자리걸음을 멈춘다.
  await act(async () => jest.advanceTimersByTime(300));
  expect(residentMotion(screen, U1)).toBe('blink');
  await screen.unmount();
});

it('이동 채널이 영구 거절되면(onMovementDenied) 토스트 없이 동기화를 끄고 Wanderer·로컬 걷기로 돌아간다', async () => {
  jest.useFakeTimers();
  const notify = jest.fn();
  const screen = await renderHome(nextIsland(), { notify });
  await emit(
    fullState([actor(ME, SPAWN), actor(U1, { x: 40.5, y: 45.5 }), actor(U2, { x: 36.5, y: 45.5 })]),
  );
  expect(residents(screen)).toHaveLength(2);
  const denied = channel();
  await act(async () => denied.opts.onMovementDenied?.());
  expect(denied.close).toHaveBeenCalled();
  expect(residents(screen)).toEqual([]);
  expect(otherCats(screen)).toBe(2);
  await tapGround(screen, { x: 42.5, y: 45.5 });
  expect(denied.send).not.toHaveBeenCalled();
  expect(myMotion(screen)).toBe('walking');
  expect(notify).not.toHaveBeenCalled();
  await screen.unmount();
});

describe('이동 보기 오버레이 (GROMO-2249)', () => {
  it('꺼져 있으면 controller.subscribe 를 부르지 않고 tile-terrain.navDebug 도 null 이다', async () => {
    const screen = await renderHome(nextIsland());
    const ctl = controllers[controllers.length - 1];
    await emit(fullState([actor(ME, SPAWN)]));
    expect(screen.getByTestId('tile-terrain').props.navDebug).toBeNull();
    expect(ctl.subscribe).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('켜면 서버 경로·스냅샷·보정 시각을 100ms 쓰로틀로 tile-terrain.navDebug.server 에 채운다', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    const ctl = controllers[controllers.length - 1];
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    expect(ctl.subscribe).toHaveBeenCalled();

    // FullState 채택(스폰 차이)이 보정이다 — Snapshot 은 아직 없어 server.snapshot 은 null.
    await emit(fullState([actor(ME, SPAWN)]));
    await act(async () => jest.advanceTimersByTime(100));
    let server = screen.getByTestId('tile-terrain').props.navDebug.server;
    expect(server.correctedAt).not.toBeNull();
    expect(server.snapshot).toBeNull();
    expect(server.predicted).toEqual(worldToImage(SPAWN, SIZE));

    // 로컬과 다른 PathAccepted — server.path 에 서버 경로(출발점 포함, 이미지 px)가 실린다.
    const sentAt = Date.now();
    await tapGround(screen, { x: 42.5, y: 45.5 });
    // 응답(PathAccepted) 전 — server.waitingSince 는 state().sentAt 그대로다(commandSeq 추정 아님).
    await act(async () => jest.advanceTimersByTime(100));
    server = screen.getByTestId('tile-terrain').props.navDebug.server;
    expect(server.waitingSince).toBe(sentAt);
    await emit(
      pathAccepted(ME, 1, 1, SPAWN, [
        { x: 39.5, y: 46.5 },
        { x: 40.5, y: 46.5 },
      ]),
    );
    await act(async () => jest.advanceTimersByTime(100));
    server = screen.getByTestId('tile-terrain').props.navDebug.server;
    expect(server.path).toEqual(
      [SPAWN, { x: 39.5, y: 46.5 }, { x: 40.5, y: 46.5 }].map((p) => worldToImage(p, SIZE)),
    );
    // 응답을 받았으니 다시 null.
    expect(server.waitingSince).toBeNull();

    // Snapshot 수신 — server.snapshot 에 실린다.
    await emit(snapshot(101, [entity(ME, 1, { x: 39.8, y: 46.2 })]));
    await act(async () => jest.advanceTimersByTime(100));
    server = screen.getByTestId('tile-terrain').props.navDebug.server;
    expect(server.snapshot).toEqual(worldToImage({ x: 39.8, y: 46.2 }, SIZE));
    // server.snapshotAgeMs 는 state().lastSnapshot.receivedAt 기준 경과(ms) — serverTick 추정 아님(쓰로틀 한 틀 = 100ms).
    expect(server.snapshotAgeMs).toBe(100);

    // 끄면 다시 null — 더 이상 쓰로틀 타이머도 돌지 않는다.
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    expect(screen.getByTestId('tile-terrain').props.navDebug).toBeNull();
    await screen.unmount();
  });
});

it('이동 채널의 onError(그 외 오류 큐 코드)는 동기화를 끄지 않는다 — deny 는 onMovementDenied 로만 한다', async () => {
  jest.useFakeTimers();
  const screen = await renderHome(nextIsland());
  await emit(fullState([actor(ME, SPAWN), actor(U1, { x: 40.5, y: 45.5 })]));
  expect(residents(screen)).toHaveLength(1);
  const ch = channel();
  await act(async () => ch.opts.onError('명령이 낡았어요. 다시 시도해주세요.'));
  expect(ch.close).not.toHaveBeenCalled();
  expect(residents(screen)).toHaveLength(1);
  await tapGround(screen, { x: 42.5, y: 45.5 });
  expect(ch.send).toHaveBeenCalled();
  await screen.unmount();
});

describe('플래그 off·서버 홈 아님', () => {
  // 플래그는 모듈 로드 때 굳으므로 격리 로드한다. 격리 레지스트리가 React 를 따로 만들면 훅이 깨진다.
  const isolatedIsland = (env: Record<string, string | undefined>) => {
    const keys = ['EXPO_PUBLIC_TILE_ISLAND', 'EXPO_PUBLIC_MOVEMENT_SYNC'];
    const saved = keys.map((k) => process.env[k]);
    keys.forEach((k) => (env[k] === undefined ? delete process.env[k] : (process.env[k] = env[k])));
    try {
      let Island!: typeof FinalIsland;
      jest.isolateModules(() => {
        jest.doMock('react', () => React);
        Island = (require('./WorldMap') as typeof import('./WorldMap')).FinalIsland;
      });
      return Island;
    } finally {
      keys.forEach((k, n) =>
        saved[n] === undefined ? delete process.env[k] : (process.env[k] = saved[n]),
      );
    }
  };
  afterAll(() => jest.dontMock('react'));

  it('EXPO_PUBLIC_MOVEMENT_SYNC 가 없으면 서버 홈이어도 채널을 열지 않고 Wanderer·로컬 걷기 그대로다', async () => {
    jest.useFakeTimers();
    const opened = mockChannels.length;
    const Island = isolatedIsland({ EXPO_PUBLIC_TILE_ISLAND: '1' });
    const screen = await render(
      <Island state={serverState(nextIsland())} go={jest.fn()} build={jest.fn()} />,
    );
    await tapGround(screen, { x: 42.5, y: 45.5 });
    expect(mockChannels.length).toBe(opened);
    expect(myMotion(screen)).toBe('walking');
    expect(residents(screen)).toEqual([]);
    expect(otherCats(screen)).toBe(2);
    await screen.unmount();
  });

  it('플래그 on 이어도 서버 홈(facts)이 없는 목업 섬이면 채널을 열지 않는다', async () => {
    const opened = mockChannels.length;
    const screen = await render(
      <FinalIsland state={initialState()} go={jest.fn()} build={jest.fn()} />,
    );
    expect(mockChannels.length).toBe(opened);
    await screen.unmount();
  });

  it('배경으로 깔린 홈(showActions=false)은 서버 홈이어도 채널을 열지 않는다 — 구독은 방 입장이다', async () => {
    const opened = mockChannels.length;
    const screen = await renderHome(nextIsland(), { showActions: false });
    expect(mockChannels.length).toBe(opened);
    expect(otherCats(screen)).toBe(2);
    await screen.unmount();
  });
});
