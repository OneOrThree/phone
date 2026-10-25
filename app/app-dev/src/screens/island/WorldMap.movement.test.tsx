/**
 * 홈 섬 이동 동기화 배선(GROMO-2248) — 타일 섬(iOS·Android) + 서버 홈이면 늘 이동 전용 채널을 열고(GROMO-2476),
 * 내 고양이는 서버 확정 경로·도착을 따르며 다른 주민은 서버 위치(RemoteResident)로 그린다.
 * 동기화 위치가 없는 주민(FullState 전·채널 거절·미접속·목업 섬·웹)은 고정 자리(StandingResident)에 서 있다.
 */
import React from 'react';
import { Animated, AppState } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { initialState } from '@/services/model';
import { clearSession, saveSession } from '@/services/api/session';
import type { IslandChannelOpts } from '@/services/islandRealtime';
import { imageToWorld, worldToImage, worldToCell, type WorldPoint } from '@/utils/worldCoords';
import { loadNav } from '@/utils/nav-path';
// tilePath 를 하나의 탭에서만 가짜로 바꾸는 스파이용 — 네임스페이스로 가져와야 jest.spyOn 대상이 된다.
import * as navPathModule from '@/utils/nav-path';
import bundledNavJson from '@/assets/village-world/v1/nav.json';
import { observeAnimatedOnJsDriver } from '@/components/animatedJsDriver.testing';
import { movementStats, STATS_LOG_MS } from '@/services/movementStats';
import grids from '@/constants/world-v2.json';

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
    CatSprite: ({
      testID,
      motion,
      color,
      outfit,
    }: {
      testID?: string;
      motion?: string;
      color: string;
      outfit?: object;
    }) =>
      ReactActual.createElement(View, {
        testID: testID ?? 'mock-cat-sprite',
        testPropMotion: motion,
        testPropColor: color,
        testPropOutfit: outfit,
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

// iOS·Android 는 늘 타일 섬이다(GROMO-2476) — jest 기본 Platform.OS(ios)로 그대로 불러온다.
const { FinalIsland, initialMapAssets, residentSpot } =
  require('./WorldMap') as typeof import('./WorldMap');

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
// 걷는 고양이는 고정 left/top 에 transform 이동을 더해 그린다(GROMO-2374) — 둘을 더한 화면 자리를 읽는다.
const placed = (style: unknown) => {
  const st = flat(style);
  const [{ translateX }, { translateY }] = st.transform as unknown as {
    translateX: number;
    translateY: number;
  }[];
  st.left += translateX;
  st.top += translateY;
  return st;
};
// 내 고양이 컨테이너(left = x·s − hit/2, top = y·s − cat/2 − hit/2)에서 월드 좌표를 되돌린다.
const myCat = (screen: Screen) => {
  const st = placed(screen.getByTestId('home-cat-container').props.style);
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
  const st = placed(screen.getByTestId(`remote-resident-${userId}`).props.style);
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
// 이름 없는 고양이 스프라이트 = StandingResident 또는 RemoteResident(내 고양이는 home-cat-sprite).
const otherCats = (screen: Screen) => screen.queryAllByTestId('mock-cat-sprite').length;
// 동기화 위치가 없어 고정 자리에 선 주민(GROMO-2476) — 이동 없이 left/top 만으로 놓인다.
const standing = (screen: Screen) =>
  screen
    .queryAllByTestId(/^standing-resident-/)
    .map((n) => n.props.testID)
    .sort();
// 서버 홈 명단(ME·U1·U2·U3)에서 나와 털색 없는 U3 를 뺀 순서 — U1 이 0번, U2 가 1번 고정 자리다.
const expectStandingAt = (screen: Screen, userId: string, n: number) => {
  const st = flat(screen.getByTestId(`standing-resident-${userId}`).props.style);
  const spot = residentSpot(grids.home, n);
  expect(st.left / SCALE).toBeCloseTo(spot.x, 6);
  expect(st.top / SCALE).toBeCloseTo(spot.y, 6);
};
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
let jsDriver: ReturnType<typeof observeAnimatedOnJsDriver>;
const renderHome = (islandId: string, props: object = {}) =>
  render(<FinalIsland state={serverState(islandId)} go={jest.fn()} build={jest.fn()} {...props} />);

beforeEach(async () => {
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: ME });
  // 테스트 네이티브 모듈 mock 은 AppState.currentState 기본값이 없다(RN 소스는 null) — appActive 게이트가
  // 막 마운트한 화면에서 채널을 열려면 'active' 로 보이게 한다(RaftWaterMotion.test.tsx 와 같은 패턴, 지적 1).
  (AppState as { currentState: string | null }).currentState = 'active';
  // 고양이 이동은 네이티브 드라이버라 Jest 목에서는 값이 안 움직인다 — 같은 설정을 JS 드라이버로 돌려 위치를 본다.
  jsDriver = observeAnimatedOnJsDriver();
});
afterEach(() => {
  jsDriver.mockRestore();
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

it('앱이 background 로 가면 이동 채널을 닫고 active 복귀 때 다시 연다(codex 지적 1, PR #1111, WorldMap.tsx:1625)', async () => {
  jest.useFakeTimers();
  // AppState 리스너는 이 장면 말고도 FireMotion·RaftWaterMotion 등 다른 모션이 건다 — 전부 모아 한꺼번에 흘린다.
  // jest.spyOn/mockRestore 대신 GoldenFishCutscene.test.tsx 와 같은 defineProperty 패턴을 쓴다 — addEventListener 는
  // AppState 인스턴스의 own property 가 아니라(프로토타입) mockRestore 뒤 복귀 호출이 깨진다(실측).
  const listeners: ((state: string) => void)[] = [];
  const originalAddEventListener = Object.getOwnPropertyDescriptor(AppState, 'addEventListener');
  Object.defineProperty(AppState, 'addEventListener', {
    configurable: true,
    value: ((_type: string, listener: (state: string) => void) => {
      listeners.push(listener);
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener,
  });
  try {
    const screen = await renderHome(nextIsland());
    await emit(fullState([actor(ME, SPAWN)]));
    const opened = channel();
    const openedCount = mockChannels.length;

    // background — 기존 채널 effect 의 cleanup(섬 전환·언마운트와 같은 cleanup)이 close() 를 부른다.
    await act(async () => listeners.forEach((listener) => listener('background')));
    expect(opened.close).toHaveBeenCalledTimes(1);

    // active 복귀 — effect 가 다시 돌아 새 채널을 열고, FullState 로 다시 맞춘다.
    await act(async () => listeners.forEach((listener) => listener('active')));
    expect(mockChannels.length).toBe(openedCount + 1);
    await emit(fullState([actor(ME, SPAWN)]));
    expect(channel()).not.toBe(opened);

    await screen.unmount();
  } finally {
    if (originalAddEventListener) {
      Object.defineProperty(AppState, 'addEventListener', originalAddEventListener);
    }
  }
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
  // beforeEach 의 JS 드라이버 스파이를 그대로 돌려받는다 — 앞선 호출 기록을 지운다.
  timing.mockClear();
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

it('연결 경로(navPath)가 비고 현재 셀이 서버 출발점과 다르면(다른 통행 영역·맵 버전) 직선으로 걷지 않고 서버 출발점으로 맞춘 뒤 서버 경로를 걷는다(리뷰 2)', async () => {
  jest.useFakeTimers();
  const screen = await renderHome(nextIsland());
  await emit(fullState([actor(ME, SPAWN)]));
  // 로컬 A*: 오른쪽으로 곧장(39.5..42.5, 45.5) — 아직 한 틱도 안 지났다(here == SPAWN).
  await tapGround(screen, { x: 42.5, y: 45.5 });
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(
    (_value: Animated.Value | Animated.ValueXY, _config: Animated.TimingAnimationConfig) =>
      ({
        start: (callback?: Animated.EndCallback) => callback?.({ finished: true }),
        stop: jest.fn(),
        reset: jest.fn(),
      }) as unknown as Animated.CompositeAnimation,
  );
  // beforeEach 의 JS 드라이버 스파이를 그대로 돌려받는다 — 앞선 호출 기록을 지운다.
  timing.mockClear();
  let durations: number[] = [];
  let toValues: WorldPoint[] = [];
  try {
    // 서버는 SPAWN 과 전혀 다른 영역(60.5,60.5)에서 출발하는 경로를 확정했다 — 연결(navPath)을 다른
    // 통행 영역·맵 버전처럼 비게 만든다(mock — 실제로 다른 영역인지는 중요하지 않다).
    const nav = jest.spyOn(navPathModule, 'navPath').mockReturnValueOnce([]);
    try {
      await emit(
        pathAccepted(ME, 1, 1, { x: 60.5, y: 60.5 }, [
          { x: 61.5, y: 60.5 },
          { x: 62.5, y: 60.5 },
        ]),
      );
    } finally {
      nav.mockRestore();
    }
    // mockRestore 는 mock.calls 기록도 지운다 — 복원 전에 먼저 읽어 둔다. Animated.timing 을 흉내만 내고
    // xy 를 실제로 바꾸지 않는 mock 이라 myCat() 최종 위치는 못 읽는다 — toValue·duration 으로 검증한다.
    durations = timing.mock.calls.map(
      (call) => (call[1] as Animated.TimingAnimationConfig).duration as number,
    );
    toValues = timing.mock.calls.map((call) =>
      imageToWorld(
        (call[1] as Animated.TimingAnimationConfig).toValue as unknown as WorldPoint,
        SIZE,
      ),
    );
  } finally {
    timing.mockRestore();
  }
  // 직선 점프(SPAWN → 61.5,60.5, 약 27유닛 ≈ 2500ms)였다면 첫 구간이 길다. 서버 출발점으로 먼저
  // 맞춘(place) 뒤 걸었다면 첫 구간은 1유닛(약 91ms)뿐이다.
  expect(durations[0]).toBeLessThan(200);
  // rest(연결 실패로 비는 구간) 가 아니라 서버가 보낸 전체 경로([start, ...waypoints])를 그대로 걷는다.
  expect(toValues).toEqual([
    { x: 61.5, y: 60.5 },
    { x: 62.5, y: 60.5 },
  ]);
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
  // beforeEach 의 JS 드라이버 스파이를 그대로 돌려받는다 — 앞선 호출 기록을 지운다.
  timing.mockClear();
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

it('다른 주민은 응답 appearance 로 머리·목을 입고, member.appearance.updated 는 version 이 큰 것만 바로 반영한다 (GROMO-2390)', async () => {
  jest.useFakeTimers();
  const island = nextIsland();
  const state = serverState(island);
  const members = (state.serverIslands as any).home.members;
  members[1].appearance = { head: 'hat-u1', neck: null, version: 3 }; // U1 ginger
  const screen = await renderHome(island, { state });
  const headOf = (color: string) =>
    screen.queryAllByTestId('mock-cat-sprite').find((n) => n.props.testPropColor === color)?.props
      .testPropOutfit?.head;
  // 이동 동기화 전 고정 자리 주민(ginger·white) — 응답에 옷이 있는 주민만 입는다
  expect(headOf('ginger')).toBe('hat-u1');
  expect(headOf('white')).toBeUndefined();
  await emit(fullState([actor(ME, SPAWN), actor(U1, { x: 40.5, y: 45.5 })]));
  expect(headOf('ginger')).toBe('hat-u1'); // RemoteResident
  const appearance = (head: string | null, version: number) => ({
    eventId: `e${version}`,
    schemaVersion: 1,
    type: 'member.appearance.updated',
    islandId: island,
    aggregateVersion: version,
    payload: { userId: U1, appearance: { head, neck: null }, version },
  });
  await emit(appearance('hat-new', 4));
  expect(headOf('ginger')).toBe('hat-new');
  await emit(appearance('hat-stale', 2)); // 늦게 온 옛 사건
  expect(headOf('ginger')).toBe('hat-new');
  await emit(appearance(null, 5)); // 벗었다
  expect(headOf('ginger')).toBeNull();
  await screen.unmount();
});

it('백그라운드로 채널이 닫혔다 돌아와도 같은 섬의 실시간 외양은 유지한다 (GROMO-2390)', async () => {
  jest.useFakeTimers();
  const listeners: ((state: string) => void)[] = [];
  const originalAddEventListener = Object.getOwnPropertyDescriptor(AppState, 'addEventListener');
  Object.defineProperty(AppState, 'addEventListener', {
    configurable: true,
    value: ((_type: string, listener: (state: string) => void) => {
      listeners.push(listener);
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener,
  });
  try {
    const island = nextIsland();
    const state = serverState(island);
    (state.serverIslands as any).home.members[1].appearance = { head: 'hat-old', version: 3 };
    const screen = await renderHome(island, { state });
    const headOf = (color: string) =>
      screen.queryAllByTestId('mock-cat-sprite').find((n) => n.props.testPropColor === color)?.props
        .testPropOutfit?.head;
    await emit({
      eventId: 'e4',
      schemaVersion: 1,
      type: 'member.appearance.updated',
      islandId: island,
      aggregateVersion: 4,
      payload: { userId: U1, appearance: { head: 'hat-new', neck: null }, version: 4 },
    });
    expect(headOf('ginger')).toBe('hat-new');
    await act(async () => listeners.forEach((listener) => listener('background')));
    await act(async () => listeners.forEach((listener) => listener('active')));
    expect(headOf('ginger')).toBe('hat-new');
    await screen.unmount();
  } finally {
    if (originalAddEventListener)
      Object.defineProperty(AppState, 'addEventListener', originalAddEventListener);
  }
});

it('동기화 위치가 없는 주민은 명단 순서의 고정 자리에 서 있고 시간이 흘러도 그 자리 그대로다 (GROMO-2476)', async () => {
  jest.useFakeTimers();
  const screen = await renderHome(nextIsland());
  // FullState 전 — 나·털색 미선택(U3)을 뺀 U1·U2 만 고정 자리에 선다.
  expect(residents(screen)).toEqual([]);
  expect(standing(screen)).toEqual([`standing-resident-${U1}`, `standing-resident-${U2}`].sort());
  expect(otherCats(screen)).toBe(2);
  expectStandingAt(screen, U1, 0);
  expectStandingAt(screen, U2, 1);
  const residentMotions = () =>
    [U1, U2].map(
      (id) =>
        within(screen.getByTestId(`standing-resident-${id}`)).getByTestId('mock-cat-sprite').props
          .testPropMotion,
    );
  expect(residentMotions()).toEqual(['blink', 'blink']);
  // 예전 배회(첫 출발 1.2초 뒤·걸음 130ms)라면 움직였을 시간을 흘려도 자리·자세가 같다.
  await act(async () => jest.advanceTimersByTime(10_000));
  expectStandingAt(screen, U1, 0);
  expectStandingAt(screen, U2, 1);
  expect(residentMotions()).toEqual(['blink', 'blink']);
  await screen.unmount();
});

it('홈 섬 주민 이름표는 멤버 닉네임이고 이름이 없으면 「주민」이다 — 고정 자리·동기화 위치 모두 (GROMO-2475)', async () => {
  jest.useFakeTimers();
  const islandId = nextIsland();
  const state = serverState(islandId) as any;
  state.serverIslands.home.members[2].name = null; // U2
  const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
  const nameIn = (testID: string) =>
    within(screen.getByTestId(testID)).getByTestId('home-resident-name');
  // U1 은 고정 자리, U2(이름 없음)도 고정 자리
  expect(within(nameIn(`standing-resident-${U1}`)).getByText('주민-2')).toBeTruthy();
  expect(within(nameIn(`standing-resident-${U2}`)).getByText('주민')).toBeTruthy();
  await emit(fullState([actor(ME, SPAWN), actor(U1, { x: 36.5, y: 45.5 })]));
  expect(within(nameIn(`remote-resident-${U1}`)).getByText('주민-2')).toBeTruthy();
  await screen.unmount();
});

it('고정 자리는 홈 격자에서 주민 14명(n=0..13) 모두 서로 다른 땅 칸이다 (GROMO-2476 리뷰)', () => {
  const spots = Array.from({ length: 14 }, (_, n) => JSON.stringify(residentSpot(grids.home, n)));
  expect(new Set(spots).size).toBe(14);
});

it('FullState 뒤 접속한 주민은 동기화 위치로, 명단에 있지만 접속하지 않은 주민은 고정 자리에 그대로 선다 (GROMO-2476)', async () => {
  jest.useFakeTimers();
  const screen = await renderHome(nextIsland());
  await emit(fullState([actor(ME, SPAWN), actor(U2, { x: 36.5, y: 45.5 })]));
  expect(residents(screen)).toEqual([`remote-resident-${U2}`]);
  expect(residentAt(screen, U2).x).toBeCloseTo(36.5, 6);
  expect(residentAt(screen, U2).y).toBeCloseTo(45.5, 6);
  // U1 은 FullState 에 없다(미접속) — 순서 0번 고정 자리 그대로다. 다른 주민 순서가 바뀌어도 자리가 밀리지 않는다.
  expect(standing(screen)).toEqual([`standing-resident-${U1}`]);
  expectStandingAt(screen, U1, 0);
  expect(otherCats(screen)).toBe(2);
  await screen.unmount();
});

it('다른 주민은 FullState 로 RemoteResident 가 되고 — 명단 밖·털색 미선택·나는 그리지 않는다 — 스냅샷 위치로 걷는다', async () => {
  jest.useFakeTimers();
  const screen = await renderHome(nextIsland());
  // FullState 전에는 고정 자리 둘(ginger·white).
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
  // 고정 자리 주민은 사라지고 동기화된 주민 둘만 남는다.
  expect(standing(screen)).toEqual([]);
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

it('걷는 고양이(내 고양이·다른 주민)는 left/top 이 아니라 transform 을 네이티브 드라이버로 옮긴다(GROMO-2374)', async () => {
  jest.useFakeTimers();
  const screen = await renderHome(nextIsland());
  await emit(fullState([actor(ME, SPAWN), actor(U1, { x: 40.5, y: 45.5 })]));
  const box = (id: string) => flat(screen.getByTestId(id).props.style);
  const ids = ['home-cat-container', `remote-resident-${U1}`];
  const before = ids.map(box);
  await tapGround(screen, { x: 42.5, y: 45.5 });
  await emit(pathAccepted(U1, 3, 1, { x: 40.5, y: 45.5 }, [{ x: 41.5, y: 45.5 }]));
  await emit(snapshot(101, [entity(U1, 1, { x: 41, y: 45.5 })]));
  await act(async () => jest.advanceTimersByTime(150));
  // 걷는 동안 left/top 은 그대로(레이아웃 없음)이고 transform 만 바뀐다.
  ids.forEach((id, i) => {
    const now = box(id);
    expect(now.left).toBe(before[i].left);
    expect(now.top).toBe(before[i].top);
    expect(now.transform).not.toEqual(before[i].transform);
  });
  // 걷는 고양이 둘(내 고양이·다른 주민)의 이동이 모두 네이티브 드라이버 설정이다 — 테스트만 JS 로 돌린다(jsDriver).
  // 고정 자리 주민(U2)은 이동 애니메이션 자체가 없다.
  const moves = jsDriver.mock.calls.filter(([value]) => value instanceof Animated.ValueXY);
  expect(new Set(moves.map(([value]) => value)).size).toBe(2);
  for (const [, config] of moves) expect(config.useNativeDriver).toBe(true);
  await screen.unmount();
});

it('이동 채널이 영구 거절되면(onMovementDenied) 토스트 없이 동기화를 끄고 주민 고정 자리·로컬 걷기로 돌아간다', async () => {
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
  // 접속했던 주민도 마지막 수신 자리가 아니라 명단 순서의 고정 자리로 돌아간다.
  expectStandingAt(screen, U1, 0);
  expectStandingAt(screen, U2, 1);
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
    const receivedAt = Date.now();
    await emit(snapshot(101, [entity(ME, 1, { x: 39.8, y: 46.2 })]));
    await act(async () => jest.advanceTimersByTime(100));
    server = screen.getByTestId('tile-terrain').props.navDebug.server;
    expect(server.snapshot).toEqual(worldToImage({ x: 39.8, y: 46.2 }, SIZE));
    // server.snapshotReceivedAt 은 state().lastSnapshot.receivedAt 그대로(절대 시각, serverTick 추정 아님) —
    // 틱 지연(now - 이 값)은 readout 이 그릴 때 계산한다(GROMO-2249 보완 — 항목 3).
    expect(server.snapshotReceivedAt).toBe(receivedAt);

    // 끄면 다시 null — 더 이상 쓰로틀 타이머도 돌지 않는다.
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    expect(screen.getByTestId('tile-terrain').props.navDebug).toBeNull();
    await screen.unmount();
  });

  it('서버 메시지가 끊겨도 snapshotReceivedAt 은 절대 시각 그대로다 — 틱 지연은 readout 이 그릴 때 계산한다(지적 2·보완 3)', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await emit(fullState([actor(ME, SPAWN)]));
    await emit(snapshot(101, [entity(ME, 0, SPAWN)]));
    await act(async () => jest.advanceTimersByTime(100));
    const first = screen.getByTestId('tile-terrain').props.navDebug.server.snapshotReceivedAt;
    expect(first).not.toBeNull();
    // 이후 메시지 없이 500ms 만 지난다 — 구독 콜백(controller.notify)은 더 안 오지만 250ms 인터벌이 같은
    // flush 를 다시 돌린다. 수신 시각은 절대값이라 그대로고(보완 3), 틱 지연은 readout 이 now 로 계산한다.
    await act(async () => jest.advanceTimersByTime(500));
    const second = screen.getByTestId('tile-terrain').props.navDebug.server.snapshotReceivedAt;
    expect(second).toBe(first);
    await screen.unmount();
  });

  it('거절되면(controller.deny()) 보존된 lastPath 대신 status:denied·나머지 null 로 통째로 비운다(지적 3·보완 5)', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await emit(fullState([actor(ME, SPAWN)]));
    await tapGround(screen, { x: 42.5, y: 45.5 });
    await emit(
      pathAccepted(ME, 1, 1, SPAWN, [
        { x: 39.5, y: 46.5 },
        { x: 40.5, y: 46.5 },
      ]),
    );
    await act(async () => jest.advanceTimersByTime(100));
    // 거절 전 — 서버 경로가 오버레이에 실려 있다.
    expect(screen.getByTestId('tile-terrain').props.navDebug.server.path).not.toBeNull();
    // 채널 거절 — movementSync 의 state() 는 denied 만 true 로 바꾸고 lastPath 는 그대로 보존한다.
    const denied = channel();
    await act(async () => denied.opts.onMovementDenied?.());
    await act(async () => jest.advanceTimersByTime(100));
    // off(컨트롤러 없음, 항목 2)와 달리 거절은 server 를 null 이 아니라 status:'denied' 객체로 남긴다(보완 5).
    expect(screen.getByTestId('tile-terrain').props.navDebug.server).toEqual({
      status: 'denied',
      path: null,
      pathId: null,
      snapshot: null,
      predicted: null,
      correctedAt: null,
      snapshotReceivedAt: null,
      waitingSince: null,
    });
    await screen.unmount();
  });

  it('컨트롤러가 없으면(동기화 off·비홈) server 자체가 null 이다 — 전부 null 인 객체가 아니다(보완 2)', async () => {
    // 목업 섬(서버 홈 facts 없음) — syncIslandId 가 null 이라 movement 컨트롤러가 전혀 생기지 않는다.
    const screen = await render(
      <FinalIsland state={initialState()} go={jest.fn()} build={jest.fn()} />,
    );
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    expect(screen.getByTestId('tile-terrain').props.navDebug.server).toBeNull();
    await screen.unmount();
  });

  it('intent 를 보내 sentAt 만 바뀌어도(위치·경로·스냅샷 불변) waitingSince 가 갱신된다(보완4 지적 1)', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await emit(fullState([actor(ME, SPAWN)]));
    await act(async () => jest.advanceTimersByTime(100));
    const before = screen.getByTestId('tile-terrain').props.navDebug.server;
    expect(before.waitingSince).toBeNull();
    // WorldMap 의 walk()/Animated 를 거치지 않고 컨트롤러에 바로 intend 한다 — 탭은 로컬 걷기도 같이
    // 시작시켜 predicted(location.current)까지 함께 바뀐다. 직접 호출하면 waitingSince 만 바뀌는
    // 상황을 그대로 만들 수 있다.
    const ctl = controllers[controllers.length - 1];
    await act(async () => {
      ctl.intend({ x: 42.5, y: 45.5 });
    });
    await act(async () => jest.advanceTimersByTime(100));
    const after = screen.getByTestId('tile-terrain').props.navDebug.server;
    expect(after.waitingSince).not.toBeNull();
    expect(after).toEqual({ ...before, waitingSince: after.waitingSince });
    await screen.unmount();
  });

  it('정지 상태에서 같은 좌표의 새 Snapshot 이 와도(위치 불변) snapshotReceivedAt 이 갱신된다(보완4 지적 1)', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await emit(fullState([actor(ME, SPAWN)]));
    await emit(snapshot(101, [entity(ME, 0, SPAWN, { state: 'IDLE' })]));
    await act(async () => jest.advanceTimersByTime(100));
    const before = screen.getByTestId('tile-terrain').props.navDebug.server;
    expect(before.snapshotReceivedAt).not.toBeNull();
    // 메시지 사이에 시간이 흘러야 다음 Snapshot 의 receivedAt 이 실제로 달라진다.
    await act(async () => jest.advanceTimersByTime(600));
    await emit(snapshot(102, [entity(ME, 0, SPAWN, { state: 'IDLE' })]));
    await act(async () => jest.advanceTimersByTime(100));
    const after = screen.getByTestId('tile-terrain').props.navDebug.server;
    expect(after.snapshotReceivedAt).not.toBe(before.snapshotReceivedAt);
    expect(after).toEqual({ ...before, snapshotReceivedAt: after.snapshotReceivedAt });
    await screen.unmount();
  });

  it('같은 길이·끝점인 새 경로도 pathId 가 다르면 중간 waypoint 변경을 반영한다(보완4 지적 3)', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await emit(fullState([actor(ME, SPAWN)]));
    await tapGround(screen, { x: 41.5, y: 45.5 });
    await emit(
      pathAccepted(ME, 1, 1, SPAWN, [
        { x: 40.5, y: 44.5 },
        { x: 41.5, y: 45.5 },
      ]),
    );
    await act(async () => jest.advanceTimersByTime(100));
    const before = screen.getByTestId('tile-terrain').props.navDebug.server;
    expect(before.pathId).toBe(1);
    const firstPath = before.path;
    // 같은 commandSeq 로 길이·끝점은 같지만 중간 waypoint 만 다른 새 경로(pathId 2)가 확정된다 — 끝점만
    // 보던 종전 비교라면 "같다"고 오판해 옛 경로가 그대로 남는다.
    await emit(
      pathAccepted(ME, 1, 2, SPAWN, [
        { x: 40.5, y: 46.5 },
        { x: 41.5, y: 45.5 },
      ]),
    );
    await act(async () => jest.advanceTimersByTime(100));
    const after = screen.getByTestId('tile-terrain').props.navDebug.server;
    expect(after.pathId).toBe(2);
    expect(after.path).toEqual(
      [SPAWN, { x: 40.5, y: 46.5 }, { x: 41.5, y: 45.5 }].map((p) => worldToImage(p, SIZE)),
    );
    expect(after.path).not.toEqual(firstPath);
    await screen.unmount();
  });

  it('같은 pathId·길이여도 중간 waypoint 가 다르면 경로를 갱신한다 — 서버 재시작 pathId 재사용(보완5 지적 1)', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await emit(fullState([actor(ME, SPAWN)]));
    await tapGround(screen, { x: 41.5, y: 45.5 });
    await emit(
      pathAccepted(ME, 1, 1, SPAWN, [
        { x: 40.5, y: 44.5 },
        { x: 41.5, y: 45.5 },
      ]),
    );
    // 첫 경로를 끝까지 걷게 둔다 — 두 경로의 끝점이 같아(41.5,45.5) 걷기가 끝나면 predicted(고양이
    // 위치)가 어느 경로를 거쳤든 같은 값에 멈춘다. 그래야 "걷는 중이라 predicted 가 달라서" 전체
    // state 가 다르다고 판정되는 거짓 통과 없이 path 비교만을 검증할 수 있다.
    await act(async () => jest.advanceTimersByTime(3000));
    const before = screen.getByTestId('tile-terrain').props.navDebug.server;
    expect(before.pathId).toBe(1);
    const firstPath = before.path;
    // 서버 재시작 뒤 pathId 가 재사용된 상황 — 같은 pathId(1)·같은 길이(2점)·같은 끝점이지만 중간
    // waypoint 만 다른 새 경로가 확정된다(같은 commandSeq 로 또 받아들여지는 것은 movementSync 쪽
    // 동작 — 바로 위 지적 3 테스트와 동일). predicted·snapshot·correctedAt·waitingSince 는 이미
    // 안정된 뒤라 path 비교만이 변수다 — pathId + 길이만 보고 끝내는 지름길이 남아 있으면 전체가
    // "같다"고 오판해 옛 경로가 그대로 남는다(지적 1).
    await emit(
      pathAccepted(ME, 1, 1, SPAWN, [
        { x: 40.5, y: 46.5 },
        { x: 41.5, y: 45.5 },
      ]),
    );
    await act(async () => jest.advanceTimersByTime(3000));
    const after = screen.getByTestId('tile-terrain').props.navDebug.server;
    expect(after).toEqual({ ...before, path: after.path });
    expect(after.pathId).toBe(1);
    expect(after.path).toEqual(
      [SPAWN, { x: 40.5, y: 46.5 }, { x: 41.5, y: 45.5 }].map((p) => worldToImage(p, SIZE)),
    );
    expect(after.path).not.toEqual(firstPath);
    await screen.unmount();
  });

  it('status 가 live 면 메시지가 끊겨도 500ms 마다 다시 그려 틱 지연 readout 숫자가 시간과 함께 커진다(보완4 지적 2)', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await emit(fullState([actor(ME, SPAWN)]));
    await emit(snapshot(101, [entity(ME, 0, SPAWN, { state: 'IDLE' })]));
    await act(async () => jest.advanceTimersByTime(100));
    const readout = () => screen.getByTestId('nav-debug-text').props.children as string;
    const delayOf = (text: string) => Number(/틱 지연 (\d+)ms/.exec(text)?.[1]);
    const before = delayOf(readout());
    expect(Number.isNaN(before)).toBe(false);
    // 그 뒤로 메시지 없이 1초만 흐른다 — TileTerrainCanvas 는 이 파일 상단에서 mock 이라 그 안의
    // 시계는 안 돈다. WorldMap 자신의 시계(debugNow)가 500ms 마다 다시 그려 readout 의 지연 숫자를
    // 갱신해야 한다(지적 2) — 그러지 않으면 멈춘 state 와 함께 숫자도 멈춘다.
    await act(async () => jest.advanceTimersByTime(1000));
    const after = delayOf(readout());
    expect(after).toBeGreaterThan(before);
    await screen.unmount();
  });

  it('debugNow 가 낡은 상태에서 새 Snapshot 이 와도 readout 틱 지연이 음수로 보이지 않는다(보완5 지적 2)', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await emit(fullState([actor(ME, SPAWN)]));
    await emit(snapshot(101, [entity(ME, 0, SPAWN, { state: 'IDLE' })]));
    await act(async () => jest.advanceTimersByTime(100));
    // 보정 깜빡임 창(500ms)을 지나 500ms 주기 모드로 들어간 뒤 다음 눈금 훨씬 전까지 흘린다 — 그 사이
    // debugNow 는 직전 눈금(500ms 째)에 멈춰 있다.
    await act(async () => jest.advanceTimersByTime(600));
    const readout = () => screen.getByTestId('nav-debug-text').props.children as string;
    const delayOf = (text: string) => Number(/틱 지연 (-?\d+)ms/.exec(text)?.[1]);
    // 이 순간 새 Snapshot 이 도착한다 — receivedAt(now) 이 멈춰 있는 debugNow 보다 최신이다. 보완 전에는
    // flush 가 바뀐 상태를 그려도 debugNow 는 다음 눈금까지 그대로라 틱 지연이 음수로 보였다(지적 2).
    await emit(snapshot(102, [entity(ME, 0, SPAWN, { state: 'IDLE' })]));
    await act(async () => jest.advanceTimersByTime(100));
    expect(readout()).not.toContain('지연 -');
    expect(delayOf(readout())).toBeGreaterThanOrEqual(0);
    await screen.unmount();
  });

  it('걷는 중엔 predicted 가 전 꼭짓점(location.current) 대신 화면에 보이는 중간 위치를 따라간다(보완7 지적 2)', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await emit(fullState([actor(ME, SPAWN)]));
    await act(async () => jest.advanceTimersByTime(100));
    // 로컬 A*: 오른쪽으로 곧장 4칸(39.5..42.5, 45.5) — 한 칸은 MS_PER_UNIT(91ms, 위 걷기 테스트들과 같다).
    await tapGround(screen, { x: 42.5, y: 45.5 });
    // 왕복 지연 동안 로컬로 1칸 반쯤 먼저 걸어 나간다(걷기 테스트와 같은 타이밍) — 두 번째 구간
    // (39.5→40.5) 한중간이라 location.current 는 아직 첫 꼭짓점(39.5)에 멈춰 있다.
    await act(async () => jest.advanceTimersByTime(150));
    const server = screen.getByTestId('tile-terrain').props.navDebug.server;
    const predictedWorld = imageToWorld(server.predicted, SIZE);
    // 화면에 실제로 보이는 고양이 위치(myCat, xy 의 같은 애니메이션 중간값)와 가깝다.
    const cat = myCat(screen);
    expect(predictedWorld.x).toBeCloseTo(cat.x, 1);
    expect(predictedWorld.y).toBeCloseTo(cat.y, 1);
    // 전 꼭짓점(39.5)이 아니라 그 사이 값 — location.current 였다면 정확히 39.5다.
    expect(predictedWorld.x).toBeGreaterThan(SPAWN.x + 1);
    expect(predictedWorld.x).toBeLessThan(42.5);
    await screen.unmount();
  });

  it('새 서버 상태 flush 는 debugNow 갱신을 같은 렌더에 배칭해 커밋이 1번만 늘어난다(보완8 항목 2)', async () => {
    jest.useFakeTimers();
    let commits = 0;
    const onRender = () => {
      commits++;
    };
    const screen = await render(
      <React.Profiler id="world-map-flush" onRender={onRender}>
        <FinalIsland state={serverState(nextIsland())} go={jest.fn()} build={jest.fn()} />
      </React.Profiler>,
    );
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await emit(fullState([actor(ME, SPAWN)]));
    await emit(snapshot(101, [entity(ME, 0, SPAWN, { state: 'IDLE' })]));
    await act(async () => jest.advanceTimersByTime(100));
    // 100ms 더 흘려 다음 flush 가 emit() 안에서 바로(동기) 돌 쓰로틀 경계로 미리 맞춘다 — 이 구간 자체의
    // 커밋 수는 재지 않는다(아래 참고).
    await act(async () => jest.advanceTimersByTime(100));

    // snapshotReceivedAt 이 실제로 달라지는 새 Snapshot. flush 가 sameServerDebug 로 "달라졌다"고
    // 판단해 serverDebug·debugNow 를 같은 동기 구간에서 함께 올리면 커밋이 정확히 1번만 늘어야 한다
    // (보완8 항목 2 전엔 debugNow 를 뒤쫓는 WorldMap 쪽 참조 deps effect 가 따로 있어 2번 늘었다).
    // "기준 구간 흘리고 빼기" 방식은 쓰지 않는다 — readout 시계가 보정 창 안에서도 500ms 로 도는
    // (보완9 항목 1) 지금은 그 창이 사라져, 뺄셈으로 상쇄되던 주변 잡음(마운트 직후 가라앉는 비동기
    // effect 등)이 두 구간에 비대칭으로 걸려 거짓 실패를 냈다 — emit 직후 동기 커밋만 재면 그 잡음을
    // 타지 않는다.
    commits = 0;
    await emit(snapshot(102, [entity(ME, 0, SPAWN, { state: 'IDLE' })]));
    expect(commits).toBe(1);
    await screen.unmount();
  });

  it('내 걷기가 끝나 settle() 이 보정을 만들면 250ms 인터벌 전에(쓰로틀 창 안에서) correctedAt 이 갱신된다(보완10 지적 1)', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    // FullState 채택(스폰 차이)이 첫 보정이다 — 100ms 쓰로틀 경계로 흘려 보낸다(기존 관례).
    await emit(fullState([actor(ME, SPAWN)]));
    await act(async () => jest.advanceTimersByTime(100));
    const adopted = screen.getByTestId('tile-terrain').props.navDebug.server.correctedAt;
    expect(adopted).not.toBeNull();

    // 내 위치(SPAWN)와 먼 서버 위치(90,90)를 "보정 없이" self 에 심는다 — PathAccepted 핸들러는 restCheck 를
    // 전혀 부르지 않는다(자리만 바꾼다). waypoints=[]·속도를 로컬 MS_PER_UNIT(91ms/unit, `@/utils/nav-path`)
    // 과 똑같이 맞춰(1000/91) WorldMap.onMyPath 의 sameCells+속도일치 조건으로 조기 반환시킨다 — 로컬 걷기를
    // 전혀 건드리지 않고 self 만 멀어진다.
    const ctl = controllers[controllers.length - 1];
    const FAR = { x: 90, y: 90 };
    await act(async () => {
      ctl.intend(FAR);
    });
    await emit({ ...pathAccepted(ME, 1, 99, FAR, []), speed: 1000 / 91 });

    // 마지막 flush(위 100ms 경계)로부터 100ms 넘게 흘려 다음 notify() 가 쓰로틀 타이머 없이 바로(동기)
    // flush 하도록 미리 맞춘다 — 그 사이 250ms 인터벌이 한 번 돌아도(내용 불변) correctedAt 은 그대로다.
    await act(async () => jest.advanceTimersByTime(260));
    expect(screen.getByTestId('tile-terrain').props.navDebug.server.correctedAt).toBe(adopted);

    // settle() 을 직접 불러 "로컬 걷기가 막 끝난" 상황을 흉내낸다 — 추가로 시간을 흘리지 않고 바로 읽는다.
    // 그 사이 250ms 인터벌이 돌 틈이 전혀 없으므로, 지금 바뀌어 있다면 settle 의 restCheck 가 notify 를
    // 직접 불러 쓰로틀 flush 를 동기로 돌렸다는 뜻이다 — 고치기 전에는 settle 이 notify 를 전혀 안 불러
    // 이 값이 다음 250ms 인터벌까지(최대 250ms) 그대로였다(지적 1).
    await act(async () => {
      ctl.settle();
    });
    const server = screen.getByTestId('tile-terrain').props.navDebug.server;
    expect(server.correctedAt).not.toBe(adopted);
    expect(server.correctedAt).not.toBeNull();

    await screen.unmount();
  });
});

it('섬 전환 뒤 옛 채널의 늦은 onMovementDenied 는 새 컨트롤러를 끄지 않는다(채널 소유권, 리뷰 3)', async () => {
  jest.useFakeTimers();
  const islandA = nextIsland();
  const islandB = nextIsland();
  const screen = await renderHome(islandA);
  await emit(fullState([actor(ME, SPAWN)]));
  const oldChannel = channel();
  await screen.rerender(
    <FinalIsland state={serverState(islandB)} go={jest.fn()} build={jest.fn()} />,
  );
  await emit(fullState([actor(ME, SPAWN)]));
  // 옛 채널(A)의 늦은 영구 거절 — close() 의 deactivate() 가 끝나기 전 도착한 메시지를 흉내낸다.
  await act(async () => oldChannel.opts.onMovementDenied?.());
  const newChannel = channel();
  expect(newChannel.close).not.toHaveBeenCalled();
  // 새 컨트롤러가 꺼졌다면(버그) movement.current 가 null 이 돼 탭이 로컬로만 걷고 intent 를 보내지 않는다.
  await tapGround(screen, { x: 42.5, y: 45.5 });
  expect(newChannel.send).toHaveBeenCalled();
  await screen.unmount();
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

describe('이동 동기화 집계·자동 걷기 (GROMO-2250, 개발 전용)', () => {
  it('이동 보기를 켜면 readout 셋째 줄에 RTT·Snapshot·재접속을 모으고, 껐다 켜면 비운다', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await emit(fullState([actor(ME, SPAWN)]));
    await tapGround(screen, { x: 42.5, y: 45.5 });
    await act(async () => jest.advanceTimersByTime(30));
    await emit(pathAccepted(ME, 1, 1, SPAWN, [{ x: 39.5, y: 46.5 }]));
    await emit(snapshot(101, [entity(ME, 1, SPAWN)]));
    await act(async () => jest.advanceTimersByTime(50));
    await emit(snapshot(102, [entity(ME, 1, { x: 39, y: 46 })]));
    await act(async () => jest.advanceTimersByTime(100));
    const readout = () => screen.getByTestId('nav-debug-text').props.children as string;
    expect(readout()).toContain('RTT 1건 p50 30');
    expect(readout()).toContain('Snap 1건 p50 50');
    // stompjs 재접속 = 같은 채널의 두 번째 onOpen.
    await act(async () => channel().opts.onOpen());
    await act(async () => channel().opts.onOpen());
    await act(async () => jest.advanceTimersByTime(500));
    expect(readout()).toContain('재접속 1');
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await act(async () => jest.advanceTimersByTime(100));
    expect(readout()).toContain('RTT 0건');
    expect(readout()).toContain('재접속 0');
    await screen.unmount();
  });

  // AppState 리스너를 모아 run 에 「상태 바꾸기」로 넘긴다 — 위 「앱이 background 로 가면…」 테스트와 같은
  // defineProperty 패턴이다.
  const withAppState = async (run: (to: (state: string) => Promise<void>) => Promise<void>) => {
    const listeners: ((state: string) => void)[] = [];
    const originalAddEventListener = Object.getOwnPropertyDescriptor(AppState, 'addEventListener');
    Object.defineProperty(AppState, 'addEventListener', {
      configurable: true,
      value: ((_type: string, listener: (state: string) => void) => {
        listeners.push(listener);
        return { remove: jest.fn() };
      }) as typeof AppState.addEventListener,
    });
    try {
      await run((state) => act(async () => listeners.forEach((listener) => listener(state))));
    } finally {
      if (originalAddEventListener) {
        Object.defineProperty(AppState, 'addEventListener', originalAddEventListener);
      }
    }
  };
  // background → active: 채널 effect 가 cleanup 뒤 다시 돌아 새 채널 인스턴스를 열고, 412ms 뒤 FullState 를 받는다.
  const reopenAfterBackground = async (to: (state: string) => Promise<void>) => {
    const before = channel();
    await to('background');
    await to('active');
    expect(channel()).not.toBe(before);
    await act(async () => channel().opts.onOpen());
    await act(async () => jest.advanceTimersByTime(412));
    await emit(fullState([actor(ME, SPAWN)]));
    await act(async () => jest.advanceTimersByTime(500));
  };

  it('background 복귀로 채널 effect 가 다시 돌아 새 채널이 열려도 재접속으로 세고, 첫 FullState 시간은 첫 값을 지킨다', async () => {
    jest.useFakeTimers();
    await withAppState(async (to) => {
      const screen = await renderHome(nextIsland());
      await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
      await act(async () => channel().opts.onOpen());
      await act(async () => jest.advanceTimersByTime(96));
      await emit(fullState([actor(ME, SPAWN)]));
      await reopenAfterBackground(to);
      const readout = screen.getByTestId('nav-debug-text').props.children as string;
      expect(readout).toContain('재접속 1 · FullState 412ms(첫 96ms)');
      await screen.unmount();
    });
  });

  it('채널이 열리고 FullState 까지 받은 뒤 이동 보기를 켜도 다음 열림을 재접속으로 세고, 측정 전 첫 연결은 「—」로 둔다', async () => {
    jest.useFakeTimers();
    await withAppState(async (to) => {
      const screen = await renderHome(nextIsland());
      // 측정 시작 전 — 채널이 열리고 첫 FullState 까지 받았다(집계는 꺼져 있다).
      await act(async () => channel().opts.onOpen());
      await act(async () => jest.advanceTimersByTime(96));
      await emit(fullState([actor(ME, SPAWN)]));
      await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
      await reopenAfterBackground(to);
      const readout = screen.getByTestId('nav-debug-text').props.children as string;
      expect(readout).toContain('재접속 1 · FullState 412ms(첫 —)');
      await screen.unmount();
    });
  });

  it('자동 걷기를 켜면 2초 뒤 탭과 같은 걷기로 intent 를 보내고, 끄면 더 보내지 않는다', async () => {
    jest.useFakeTimers();
    // 무작위 셀 = (42,45) 셀(index 45·100 + 42), 지터 = 0.45425 × 50ms ≈ 23ms.
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.45425);
    const island = nextIsland();
    const screen = await renderHome(island);
    expect(screen.queryByTestId('auto-walk-toggle')).toBeNull();
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await emit(fullState([actor(ME, SPAWN)]));
    await fireEvent.press(screen.getByTestId('auto-walk-toggle'));
    await act(async () => jest.advanceTimersByTime(2100));
    expect(channel().send.mock.calls).toEqual([
      [
        `/app/islands/${island}/movement/intent`,
        { commandSeq: 1, navRevision: 1, goalX: 42.5, goalY: 45.5 },
      ],
    ]);
    await fireEvent.press(screen.getByTestId('auto-walk-toggle'));
    // 다른 셀로 바꿔도 꺼져 있으니 더 보내지 않는다.
    random.mockReturnValue(0.4639);
    await act(async () => jest.advanceTimersByTime(6000));
    expect(channel().send).toHaveBeenCalledTimes(1);
    random.mockRestore();
    await screen.unmount();
  });
  it('점프 표본은 정지 상태 보정만 — FullState 채택·도착 스냅은 잡지 않는다', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    await act(async () => channel().opts.onOpen());
    // FullState 채택 — 옛 격자 스폰과 서버 스폰의 차이(> 0.1 unit)만큼 스냅한다.
    await emit(fullState([actor(ME, SPAWN)]));
    // 도착 스냅 — 같은 셀 탭 → 빈 경로 → Arrived 자리에 선다.
    await tapGround(screen, { x: 38.7, y: 45.3 });
    await emit(pathAccepted(ME, 1, 1, SPAWN, []));
    await emit(arrived(ME, 1, { x: 38.7, y: 45.3 }));
    await act(async () => jest.advanceTimersByTime(500));
    expect(movementStats.summary().jump.maxScreenPx).toBe(0);
    // 정지 상태 보정 — 서버 Snapshot 이 2.8 unit 떨어진 정지 위치를 알려 온다(CORRECTION_UNITS 1 초과).
    await emit(snapshot(140, [entity(ME, 1, { x: 41.5, y: 45.5 }, { state: 'IDLE' })]));
    const from = worldToImage({ x: 38.7, y: 45.3 }, SIZE),
      to = worldToImage({ x: 41.5, y: 45.5 }, SIZE);
    const { jump } = movementStats.summary();
    expect(jump.maxImagePx).toBeCloseTo(Math.hypot(to.x - from.x, to.y - from.y), 6);
    expect(jump.maxScreenPx).toBeCloseTo(jump.maxImagePx * jump.scaleAtMax, 6);
    await screen.unmount();
  });

  it('__DEV__=false 면(이동 보기가 있는 QA 빌드) 이동 보기를 켜도 자동 걷기 버튼이 없다', async () => {
    // CAN_PREVIEW_VILLAGE 는 모듈 로드 때(__DEV__ true) 굳어 이동 보기 버튼이 있다 — QA 빌드
    // (EXPO_PUBLIC_VILLAGE_PREVIEW=1)와 같은 상태다. 자동 걷기는 렌더 때 __DEV__ 를 읽는다.
    const savedDev = (globalThis as { __DEV__?: boolean }).__DEV__;
    const screen = await renderHome(nextIsland());
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    try {
      await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
      expect(screen.getByTestId('nav-debug-text')).toBeTruthy();
      expect(screen.queryByTestId('auto-walk-toggle')).toBeNull();
    } finally {
      if (savedDev === undefined) delete (globalThis as { __DEV__?: boolean }).__DEV__;
      else (globalThis as { __DEV__?: boolean }).__DEV__ = savedDev;
    }
    await screen.unmount();
  });

  it('이동 보기가 꺼져 있으면(기본) 집계 1초 인터벌을 만들지 않고 movementStats.format 도 부르지 않는다', async () => {
    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const format = jest.spyOn(movementStats, 'format');
    try {
      const screen = await renderHome(nextIsland());
      await act(async () => channel().opts.onOpen());
      await emit(fullState([actor(ME, SPAWN)]));
      await tapGround(screen, { x: 42.5, y: 45.5 });
      await emit(pathAccepted(ME, 1, 1, SPAWN, [{ x: 39.5, y: 46.5 }]));
      await emit(snapshot(101, [entity(ME, 1, SPAWN)]));
      await act(async () => jest.advanceTimersByTime(3000));
      expect(screen.queryByTestId('nav-debug-text')).toBeNull();
      // 마운트 시계 인터벌(낮·밤 등)은 계기와 무관하다 — 집계 Metro 로그 주기의 인터벌만 없으면 된다.
      expect(setIntervalSpy.mock.calls.map(([, ms]) => ms)).not.toContain(STATS_LOG_MS);
      expect(format).not.toHaveBeenCalled();
      await screen.unmount();
    } finally {
      setIntervalSpy.mockRestore();
      format.mockRestore();
    }
  });
});

describe('웹(이미지 섬)·서버 홈 아님', () => {
  // 웹 빌드(TILE_ISLAND=false)는 모듈 로드 때 Platform.OS 로 굳으므로 격리 로드하면서 그때만 격리 레지스트리의
  // Platform.OS 를 'web' 으로 둔다 — jest 엔 DOM 이 없어 렌더는 기본 OS 로 되돌린 뒤 한다. 격리 레지스트리가
  // React 를 따로 만들면 훅이 깨진다. 세션은 모듈별 캐시(getSession)라 격리 복사본엔 없다 — 그 복사본의
  // saveSession 도 함께 돌려준다.
  const webIsland = () => {
    let Island!: typeof FinalIsland;
    let isolatedSaveSession!: typeof saveSession;
    jest.isolateModules(() => {
      jest.doMock('react', () => React);
      isolatedSaveSession = (
        require('@/services/api/session') as typeof import('@/services/api/session')
      ).saveSession;
      const platform = (require('react-native') as typeof import('react-native')).Platform;
      const os = platform.OS;
      (platform as { OS: string }).OS = 'web';
      try {
        Island = (require('./WorldMap') as typeof import('./WorldMap')).FinalIsland;
      } finally {
        (platform as { OS: string }).OS = os;
      }
    });
    return { Island, saveSession: isolatedSaveSession };
  };
  afterAll(() => jest.dontMock('react'));

  it('웹(이미지 섬)이면 이동 채널 없이 주민은 고정 자리에 서고, events 만 연 채널로 주민 외양을 받는다 (GROMO-2390·2476)', async () => {
    jest.useFakeTimers();
    const opened = mockChannels.length;
    const before = controllers.length;
    const island = nextIsland();
    const state = serverState(island);
    (state.serverIslands as any).home.members[1].appearance = { head: 'hat-old', version: 3 };
    const isolated = webIsland();
    await isolated.saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: ME });
    const Island = isolated.Island;
    const screen = await render(<Island state={state} go={jest.fn()} build={jest.fn()} />);
    // 이동 채널은 없고 events 토픽만 여는 채널 하나
    expect(mockChannels.length).toBe(opened + 1);
    expect(channel().opts).toMatchObject({ islandId: island, events: true, presence: false });
    expect(channel().opts.movement).toBeFalsy();
    expect(controllers.length).toBe(before);
    expect(residents(screen)).toEqual([]);
    expectStandingAt(screen, U1, 0);
    expectStandingAt(screen, U2, 1);
    expect(otherCats(screen)).toBe(2);
    const headOf = (color: string) =>
      screen.queryAllByTestId('mock-cat-sprite').find((n) => n.props.testPropColor === color)?.props
        .testPropOutfit?.head;
    expect(headOf('ginger')).toBe('hat-old');
    await emit({
      eventId: 'e4',
      schemaVersion: 1,
      type: 'member.appearance.updated',
      islandId: island,
      aggregateVersion: 4,
      payload: { userId: U1, appearance: { head: 'hat-new', neck: null }, version: 4 },
    });
    expect(headOf('ginger')).toBe('hat-new');
    await screen.unmount();
    expect(mockChannels[mockChannels.length - 1].close).toHaveBeenCalled();
  });

  it('컨트롤러가 없는 홈(서버 홈이 없는 목업 섬)도 오버레이는 켜진다 — 250ms no-op 플러시 인터벌은 만들지 않는다(보완9 항목 2)', async () => {
    jest.useFakeTimers();
    const before = controllers.length;
    const screen = await render(
      <FinalIsland state={initialState()} go={jest.fn()} build={jest.fn()} />,
    );
    expect(controllers.length).toBe(before);
    // jest.getTimerCount() 의 생 델타는 이 화면의 다른 setTimeout 잡음(버튼 프레스 모션 등)에 가려
    // 기준선 노릇을 못 한다 — setInterval 호출만 집어 센다. WorldMap.tsx
    // 안의 setInterval 은 낮·밤 시계(마운트 때 1회, navDebug 와 무관)와 이 250ms flush 뿐이라, 스파이를
    // 마운트 뒤에 걸면 토글이 만드는 setInterval 호출 수만 그대로 드러난다.
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
    // 컨트롤러가 없으면(동기화 off) server 는 null 이다(항목 2 불변) — 오버레이는 켜졌지만 flush 효과는
    // early-return 경로만 타 250ms 인터벌(setInterval)을 한 번도 만들지 않는다. 토글이 만드는 다른
    // setInterval 은 GROMO-2250 집계의 1초 Metro 로그 하나뿐이다.
    expect(screen.getByTestId('tile-terrain').props.navDebug.server).toBeNull();
    expect(setIntervalSpy.mock.calls.map(([, ms]) => ms)).toEqual([1000]);
    setIntervalSpy.mockRestore();
    await screen.unmount();
  });

  it('타일 섬이어도 서버 홈(facts)이 없는 목업 섬이면 채널을 열지 않는다', async () => {
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

  // 항목 6(릴리스 음성 테스트) — WorldMap.tileIsland.test.tsx 는 movementSync mock 이 없어(다른 mock 구조)
  // 거기 추가하면 전체 테스트에 새 전역 mock 을 얹어야 한다. 이미 controllers 스파이가 있는 이 파일의
  // __DEV__=false 케이스로 대체한다(보고: 이쪽을 선택). 격리 복사본도 기본 Platform.OS(ios)라 타일 섬이다.
  // 세션은 모듈별 캐시(getSession)라 격리 복사본엔 없다 — 그 복사본의 saveSession 으로 따로 채운다.
  it('__DEV__=false 릴리스 빌드는 nav-debug-toggle 이 없어 movementSync.subscribe 를 한 번도 안 부른다(음성, 항목 6)', async () => {
    jest.useFakeTimers();
    const before = controllers.length;
    const savedDev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    let Island!: typeof FinalIsland;
    let isolatedSaveSession!: typeof saveSession;
    jest.isolateModules(() => {
      jest.doMock('react', () => React);
      isolatedSaveSession = (
        require('@/services/api/session') as typeof import('@/services/api/session')
      ).saveSession;
      Island = (require('./WorldMap') as typeof import('./WorldMap')).FinalIsland;
    });
    try {
      await isolatedSaveSession({ accessToken: 'AT', refreshToken: 'RT', userId: ME });
      const state = serverState(nextIsland()) as any;
      state.serverIslands.home.members = [member(ME, 'cream')];
      const screen = await render(<Island state={state} go={jest.fn()} build={jest.fn()} />);
      // 걷기 동기화(컨트롤러 생성)는 릴리스에서도 평소처럼 돈다 — 디버그 오버레이만 없다.
      expect(controllers.length).toBeGreaterThan(before);
      expect(screen.queryByTestId('nav-debug-toggle')).toBeNull();
      for (const ctl of controllers.slice(before)) expect(ctl.subscribe).not.toHaveBeenCalled();
      // 항목 3(보완8) — 디버그 토글 자체가 없으니 깜빡임·readout 시계 타이머도 전혀 안 돈다: 마운트
      // 직후 가라앉는 타이머(세션 복구 재시도 등, 디버그 시계와 무관 — 실측 500ms 안에 가라앉고 다시는
      // 안 생긴다)를 짧게 흘려보내 기준선(컨트롤러 등 다른 타이머)을 잡고, 1초를 더 흘린 뒤가 같은
      // 수인지로 확인한다.
      await act(async () => jest.advanceTimersByTime(600));
      const baseline = jest.getTimerCount();
      await act(async () => jest.advanceTimersByTime(1000));
      expect(jest.getTimerCount()).toBe(baseline);
      await screen.unmount();
    } finally {
      // 항목 5(보완8) — 원래 없던 전역이면(undefined) 값을 되돌리는 대신 지운다. `__DEV__ = undefined`
      // 로 두면 키 자체는 남아('__DEV__' in globalThis 가 true) 원래 상태(부재)와 달라진다.
      if (savedDev === undefined) delete (globalThis as { __DEV__?: boolean }).__DEV__;
      else (globalThis as { __DEV__?: boolean }).__DEV__ = savedDev;
    }
  });
});

// 경로선(GROMO-2479) — 지금 걷는 경로를 타일 섬 지형 캔버스(mock 호스트 뷰)의 walkPath prop 으로 넘긴다.
describe('경로선 (GROMO-2479)', () => {
  const route = (screen: Screen) =>
    (screen.getByTestId('tile-terrain').props.walkPath as WorldPoint[] | null)?.map((p) =>
      imageToWorld(p, SIZE),
    ) ?? null;
  const expectNear = (p: WorldPoint, q: WorldPoint) => {
    expect(p.x).toBeCloseTo(q.x, 6);
    expect(p.y).toBeCloseTo(q.y, 6);
  };
  const GOAL = { x: 42.5, y: 45.5 };

  it('땅을 누르면 지금 자리 → 누른 칸 경로가 들어가고, 걸어서 도착하면 null 이다', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await emit(fullState([actor(ME, SPAWN)]));
    expect(route(screen)).toBeNull();
    await tapGround(screen, GOAL);
    const r = route(screen)!;
    expect(r.length).toBeGreaterThan(1);
    expectNear(r[0], SPAWN);
    expectNear(r[r.length - 1], GOAL);
    // 걷는 동안(지나온 구간 포함) 그대로 둔다.
    await act(async () => jest.advanceTimersByTime(150));
    expect(route(screen)).toEqual(r);
    await walkToEnd(screen);
    expect(myMotion(screen)).not.toBe('walking');
    expect(route(screen)).toBeNull();
    await screen.unmount();
  });

  it('걷는 중 새 목적지를 누르면 그 목적지 경로로 바뀐다', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await emit(fullState([actor(ME, SPAWN)]));
    await tapGround(screen, GOAL);
    const first = route(screen)!;
    await act(async () => jest.advanceTimersByTime(150));
    const next = { x: 40.5, y: 46.5 };
    await tapGround(screen, next);
    const second = route(screen)!;
    expect(second).not.toEqual(first);
    // 출발점은 스폰이 아니라 그새 걸어 나간 자리다.
    expect(second[0].x).toBeGreaterThan(SPAWN.x + 0.5);
    expectNear(second[second.length - 1], next);
    await screen.unmount();
  });

  it('서버 PathAccepted 로 갈아타면 서버 경로로 바뀌고, 걷는 중 받은 Arrived 는 다 걸은 뒤 지운다', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await emit(fullState([actor(ME, SPAWN)]));
    await tapGround(screen, GOAL);
    await act(async () => jest.advanceTimersByTime(150));
    // 서버는 한 줄 아래로 가는 경로를 확정했다.
    await emit(
      pathAccepted(ME, 1, 1, SPAWN, [
        { x: 39.5, y: 46.5 },
        { x: 40.5, y: 46.5 },
        { x: 41.5, y: 46.5 },
        { x: 42.5, y: 46.5 },
      ]),
    );
    const r = route(screen)!;
    expectNear(r[r.length - 1], { x: 42.5, y: 46.5 });
    expect(r.some((p) => Math.abs(p.y - 46.5) < 1e-6)).toBe(true);
    await emit(arrived(ME, 1, { x: 42.6, y: 46.4 }));
    expect(route(screen)).toEqual(r);
    await walkToEnd(screen);
    expect(route(screen)).toBeNull();
    await screen.unmount();
  });

  it('모션 줄이기: 고양이는 걷는 효과 없이 바로 도착해도 경로선은 남고(정적 선), 서버 Arrived 에 지운다', async () => {
    jest.useFakeTimers();
    const state = serverState(nextIsland());
    state.settings.reduceMotion = true;
    const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
    await emit(fullState([actor(ME, SPAWN)]));
    await tapGround(screen, GOAL);
    expect(myMotion(screen)).not.toBe('walking');
    expectNear(myCat(screen), GOAL);
    expect(screen.getByTestId('tile-terrain').props.reduceMotion).toBe(true);
    const r = route(screen)!;
    expectNear(r[0], SPAWN);
    expectNear(r[r.length - 1], GOAL);
    await emit(
      pathAccepted(ME, 1, 1, SPAWN, [
        { x: 39.5, y: 45.5 },
        { x: 40.5, y: 45.5 },
        { x: 41.5, y: 45.5 },
        GOAL,
      ]),
    );
    expect(route(screen)).not.toBeNull();
    await emit(arrived(ME, 1, GOAL));
    expect(route(screen)).toBeNull();
    await screen.unmount();
  });

  it('모션 줄이기: Arrived 전에 목적지를 다시 골라 로컬과 다른 서버 경로로 갈아타도 선은 서버 경로 전체로 남는다', async () => {
    jest.useFakeTimers();
    const state = serverState(nextIsland());
    state.settings.reduceMotion = true;
    const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
    await emit(fullState([actor(ME, SPAWN)]));
    await tapGround(screen, GOAL);
    const next = { x: 40.5, y: 46.5 };
    await tapGround(screen, next);
    // 로컬 고양이는 이미 next 에 서 있다 — 서버는 한 줄 위로 돌아가는 다른 경로를 확정했다.
    const server = [{ x: 39.5, y: 45.5 }, { x: 40.5, y: 45.5 }, next];
    await emit(pathAccepted(ME, 2, 2, SPAWN, server));
    const r = route(screen)!;
    expect(r).toHaveLength(4);
    [SPAWN, ...server].forEach((p, i) => expectNear(r[i], p));
    await emit(arrived(ME, 2, next));
    expect(route(screen)).toBeNull();
    await screen.unmount();
  });

  it('모션 줄이기: 건물 문을 눌러 들어가면 도착에서 안 지우는 경로선도 지운다', async () => {
    jest.useFakeTimers();
    const state = serverState(nextIsland());
    state.settings.reduceMotion = true;
    const go = jest.fn();
    const screen = await render(<FinalIsland state={state} go={go} build={jest.fn()} />);
    await emit(fullState([actor(ME, SPAWN)]));
    await tapGround(screen, GOAL);
    expect(route(screen)).not.toBeNull();
    await fireEvent.press(screen.getByTestId('building-name-hall'));
    await act(async () => jest.advanceTimersByTime(2000));
    expect(go).toHaveBeenCalled();
    expect(route(screen)).toBeNull();
    await screen.unmount();
  });

  it('섬이 바뀌면 걷던 경로선을 지운다', async () => {
    jest.useFakeTimers();
    const screen = await renderHome(nextIsland());
    await emit(fullState([actor(ME, SPAWN)]));
    await tapGround(screen, GOAL);
    expect(route(screen)).not.toBeNull();
    await screen.rerender(
      <FinalIsland state={serverState(nextIsland())} go={jest.fn()} build={jest.fn()} />,
    );
    expect(route(screen)).toBeNull();
    await screen.unmount();
  });
});

// initialMapAssets(GROMO-2244, codex 지적) — movementSync 빌드는 서버와 같은 nav 아티팩트(번들)만 쓴다.
// 순수 함수라 인자로 바로 검증한다. 화면은 타일 섬(iOS·Android)이면 movementSync 도 켜서 부른다(GROMO-2476).
describe('initialMapAssets (GROMO-2244)', () => {
  const cache = { kind: 'cache' as const, mapVersion: 1, dir: 'file:///v1', path: 'maps/home/v1' };

  it('movementSync 면 promote 를 부르지 않고 BUNDLE_ASSETS(번들)다', () => {
    const promote = jest.fn(() => cache);
    expect(initialMapAssets(true, true, promote)).toEqual({ kind: 'bundle' });
    expect(promote).not.toHaveBeenCalled();
  });

  it('타일 섬 + movementSync off 면 promote() 결과를 그대로 쓴다', () => {
    const promote = jest.fn(() => cache);
    expect(initialMapAssets(true, false, promote)).toBe(cache);
  });

  it('타일 섬이 아니면 movementSync 와 무관하게 BUNDLE_ASSETS(번들)다', () => {
    const promote = jest.fn(() => cache);
    expect(initialMapAssets(false, false, promote)).toEqual({ kind: 'bundle' });
    expect(promote).not.toHaveBeenCalled();
  });
});
