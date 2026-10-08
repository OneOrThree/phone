import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { initialState } from '@/services/model';
import { villageAssets } from '@/constants/village-assets';
import { assets } from '@/constants/assets';
import { buildingNames } from '@/services/model';
import placement from '@/assets/backgrounds/island/placement.json';
import type { IslandLayout } from '@/services/api/home';
import legacyDoorCoords from '@/constants/legacy-doors.json';

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
// 캔버스는 Skia mock 에서 이미지가 null 이라 그려지지 않는다 — 받은 투영 props 만 호스트 뷰로 드러낸다.
jest.mock('./TileTerrainCanvas', () => {
  const { View } = require('react-native');
  return {
    ...jest.requireActual('./TileTerrainCanvas'),
    TileTerrainCanvas: (props: object) => <View testID="tile-terrain" {...props} />,
  };
});

// 서버 스냅샷(layout 포함)을 주입할 수 있게 하되, 기본(null)은 실제 serverHome 으로 흘려 첫 테스트를 바꾸지 않는다.
const mockFacts = { current: null as unknown };
jest.mock('@/services/model', () => {
  const actual = jest.requireActual('@/services/model');
  return {
    ...actual,
    serverHome: (state: unknown) => mockFacts.current ?? actual.serverHome(state),
  };
});
// applyLayout 은 호출 여부만 보도록 통과(passthrough) 스파이로 둔다. 타일 섬 평행이동은 실제 구현을 쓴다.
const mockApplyLayout = jest.fn((objects: unknown, _layout?: unknown) => objects);
jest.mock('@/utils/island-layout', () => ({
  ...jest.requireActual('@/utils/island-layout'),
  applyLayout: (...args: [unknown, unknown]) => mockApplyLayout(...args),
}));

// WorldMap import 전에 process.env.EXPO_PUBLIC_TILE_ISLAND 를 세운다 — 모듈 로드 시 상수로 굳는다.
// 플래그는 모듈 로드 때 읽는다 — env 를 먼저 세우고 require 한다(import 는 호이스팅돼 env 보다 먼저 돈다).
// 플래그 off 경로는 기존 WorldMap.test.tsx 가 그대로 덮는다.
process.env.EXPO_PUBLIC_TILE_ISLAND = '1';
const { FinalIsland } = require('./WorldMap') as typeof import('./WorldMap');

type Node = { props: Record<string, unknown>; children: (Node | string)[] | null };
const collect = (node: Node | Node[] | string | null, out: Node[] = []): Node[] => {
  if (!node || typeof node === 'string') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => collect(child, out));
    return out;
  }
  out.push(node);
  (node.children ?? []).forEach((child) => collect(child, out));
  return out;
};

const facts = (state: ReturnType<typeof initialState>) => ({
  islandId: state.islands[0].id,
  members: [],
  completedBuildings: [],
  home: {
    layout: {
      schemaVersion: 1,
      mapId: 'm',
      buildings: [{ id: 'hall', cell: { x: 10, y: 10 } }],
    } as IslandLayout,
    focusSummary: { totalSeconds: 0 },
    island: { role: 'member' },
    wallets: { villagePoints: 0 },
  },
});
afterEach(() => {
  mockFacts.current = null;
  mockApplyLayout.mockClear();
  delete process.env.EXPO_PUBLIC_VILLAGE_PREVIEW;
});

it('EXPO_PUBLIC_TILE_ISLAND=1 이면 기존 마을로 시작하고 바닥 Image 대신 Skia 타일 캔버스(낮·밤)를 둔다', async () => {
  const screen = await render(
    <FinalIsland state={initialState()} go={jest.fn()} build={jest.fn()} />,
  );
  const hour = new Date().getHours();
  expect(screen.getByTestId('tile-terrain').props).toMatchObject({
    width: 402,
    height: 874,
    camera: { x: 585, y: 430, z: 1 },
    night: !(hour >= 6 && hour < 18),
  });
  const nodes = collect(screen.toJSON() as Node);
  for (const src of [
    assets['backgrounds/island/base/day.png'],
    assets['backgrounds/island/base/night.png'],
    villageAssets['terrain.png'],
  ])
    expect(nodes.filter((n) => n.props.source === src)).toHaveLength(0);
});

it('타일 섬은 서버 home.layout 을 건물 평행이동으로 적용한다 — 기본 배치면 그대로, 옮기면 레이어·문이 같이 간다', async () => {
  const state = initialState();
  state.islands.find((x) => x.id === state.islandId)!.buildings = ['hall', 'gram'];
  const flat = (style: unknown) => Object.assign({}, ...[style].flat(3)) as Record<string, number>;
  const place = async (cell?: { x: number; y: number }) => {
    if (cell) {
      const f = facts(state);
      f.home.layout = {
        schemaVersion: 1,
        templateVersion: 2,
        mapId: 'home',
        buildings: [{ id: 'gram', cell }],
      };
      mockFacts.current = f;
    } else mockFacts.current = null;
    const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
    const out = {
      layer: flat(screen.getByTestId('world-static-building-gram').props.style),
      door: flat(screen.getByLabelText(buildingNames.gram).props.style),
      label: flat(screen.getByTestId('building-name-gram').props.style),
    };
    await screen.unmount();
    return out;
  };
  const none = await place();
  // gram 기본 셀(23,46) = 서버 기본 템플릿 — layout 없을 때와 픽셀이 같다.
  const base = await place({ x: 23, y: 46 });
  expect(base).toEqual(none);
  const moved = await place({ x: 33, y: 50 });
  // 기존 마을은 새 마을 applyLayout 을 타지 않는다.
  expect(mockApplyLayout).not.toHaveBeenCalled();
  // 10셀(153.6px)·4셀(40.96px) × 카메라 배율 — 레이어와 문 탭 영역이 같은 만큼 움직인다.
  const s = (moved.layer.left - base.layer.left) / 153.6;
  expect(s).toBeGreaterThan(0);
  expect(moved.layer.top - base.layer.top).toBeCloseTo(40.96 * s, 6);
  expect(moved.door.left - base.door.left).toBeCloseTo(153.6 * s, 6);
  expect(moved.door.top - base.door.top).toBeCloseTo(40.96 * s, 6);
  // 이름표는 문 탭 영역 기준 상대 위치라 그대로다.
  expect(moved.label.left).toBeCloseTo(base.label.left, 6);
  expect(moved.label.top).toBeCloseTo(base.label.top, 6);
});

it('templateVersion 없는 구 템플릿 layout 이면 건물은 기본 위치 그대로다', async () => {
  const state = fullState();
  const read = async (old: boolean) => {
    if (old) {
      const f = facts(state);
      f.home.layout = {
        schemaVersion: 1,
        mapId: 'home',
        buildings: [{ id: 'hall', cell: { x: 71, y: 31 } }] as never,
      };
      mockFacts.current = f;
    } else mockFacts.current = null;
    const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
    const out = styleOf(screen, 'world-hall-motion');
    await screen.unmount();
    return out;
  };
  expect(await read(true)).toEqual(await read(false));
});

it('플래그 on + 새 마을 미리보기면 타일 캔버스 없이 자기 지형을 그리고 layout 을 적용한다(양성 쌍)', async () => {
  process.env.EXPO_PUBLIC_VILLAGE_PREVIEW = '1';
  const state = initialState();
  mockFacts.current = facts(state);
  const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
  expect(screen.queryByTestId('tile-terrain')).toBeNull();
  expect(
    collect(screen.toJSON() as Node).some((n) => n.props.source === villageAssets['terrain.png']),
  ).toBe(true);
  expect(mockApplyLayout).toHaveBeenCalled();
});

it('이동 보기 버튼은 플래그 on 에서만 보이고 누르면 캔버스에 navDebug 를 넘긴다', async () => {
  const screen = await render(
    <FinalIsland state={initialState()} go={jest.fn()} build={jest.fn()} />,
  );
  expect(screen.getByTestId('tile-terrain').props.navDebug).toBeNull();
  await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
  expect(screen.getByTestId('tile-terrain').props.navDebug).toMatchObject({ walk: null });
});

// ---- 건물별 평행이동 정합 -----------------------------------------------------------------
// 카메라 배율은 렌더에서 재지 않고 테스트 설정(402×874, 홈 카메라 z=1)에서 계산한다.
// 운영 식: WorldMap.tsx 의 `(((L.height / 874) * 402) / 1536) * 2.8` — useAppLayout mock 높이와 같은 값에서 파생.
const SCALE = (((mockLayoutHeight / 874) * 402) / 1536) * 2.8;
const CELL_PX = { x: 15.36, y: 10.24 };
const PLACEMENT_ID = {
  hall: 'town-hall',
  board: 'noticeboard',
  gram: 'gramophone',
  library: 'library',
  mail: 'mailbox',
  tower: 'observatory',
  shop: 'shop',
} as const;
type B = keyof typeof PLACEMENT_ID;
// 서버 기본 템플릿 셀 = placement rect 발밑 bottom-center 가 속한 100×100 셀.
const defaultCell = (b: B) => {
  const [x, y, w, h] = placement.assets.find((a) => a.id === PLACEMENT_ID[b])!.rect;
  const [cw, ch] = placement.canvas;
  return { x: Math.floor(((x + w / 2) * 100) / cw), y: Math.floor(((y + h) * 100) / ch) };
};
const DELTA = { x: 3, y: -2 };
const movedCell = (b: B) => ({ x: defaultCell(b).x + DELTA.x, y: defaultCell(b).y + DELTA.y });
const expected = { dx: DELTA.x * CELL_PX.x * SCALE, dy: DELTA.y * CELL_PX.y * SCALE };
const flatStyle = (style: unknown) =>
  Object.assign({}, ...[style].flat(3)) as Record<string, number>;
const allBuildings = Object.keys(PLACEMENT_ID) as B[];
const withLayout = (state: ReturnType<typeof initialState>, b?: B) => {
  if (!b) return void (mockFacts.current = null);
  const f = facts(state);
  f.home.layout = {
    schemaVersion: 1,
    templateVersion: 2,
    mapId: 'home',
    buildings: [{ id: b, cell: movedCell(b) }] as never,
  };
  mockFacts.current = f;
};
const fullState = () => {
  const state = initialState();
  state.islands.find((x) => x.id === state.islandId)!.buildings = [...allBuildings];
  return state;
};
const styleOf = (screen: { getByTestId: (id: string, o?: object) => { props: any } }, id: string) =>
  flatStyle(screen.getByTestId(id, { includeHiddenElements: true }).props.style);

// 건물별로 그 건물에 딸린 렌더 지점(레이어·모션·알림). 낮에는 정적 레이어가 모션에 흡수되는 건물이 있다.
const cases: [string, B, string[], Record<string, unknown>][] = [
  ['hall', 'hall', ['world-hall-motion'], {}],
  [
    'board',
    'board',
    ['world-static-building-board', 'world-board-indicator'],
    { dayNight: 'night' },
  ],
  ['tower', 'tower', ['world-observatory-motion'], {}],
  ['shop', 'shop', ['world-shop-motion'], {}],
  ['library', 'library', ['world-library-motion'], {}],
  ['gram', 'gram', ['world-static-building-gram'], {}],
  ['mail(정적 레이어)', 'mail', ['world-static-building-mail'], { showMailboxLetters: false }],
  [
    'mail(펠리컨·배지)',
    'mail',
    ['mailbox-pelican', 'mailbox-new-indicator'],
    { showMailboxLetters: true },
  ],
];
it.each(cases)(
  '%s: 기본 셀 대비 옮긴 셀이면 레이어·모션이 Δcell × (15.36,10.24) × 배율만큼 정확히 움직인다',
  async (_name, b, ids, props) => {
    const state = fullState();
    const read = async (moved: boolean) => {
      withLayout(state, moved ? b : undefined);
      const screen = await render(
        <FinalIsland state={state} go={jest.fn()} build={jest.fn()} {...props} />,
      );
      const out = ids.map((id) => styleOf(screen, id));
      await screen.unmount();
      return out;
    };
    const base = await read(false);
    const moved = await read(true);
    ids.forEach((_id, k) => {
      expect(moved[k].left - base[k].left).toBeCloseTo(expected.dx, 6);
      expect(moved[k].top - base[k].top).toBeCloseTo(expected.dy, 6);
    });
  },
);

it('공사 중인 건물의 공사 스프라이트도 같은 평행이동을 따른다', async () => {
  const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-21T00:10:00Z'));
  try {
    const read = async (moved: boolean) => {
      const state = initialState(true);
      state.serverIslands = {
        currentIslandId: 'srv1',
        home: {
          islandId: 'srv1',
          home: {
            island: {
              id: 'srv1',
              name: '공사섬',
              intro: '',
              approvalRequired: false,
              maxMembers: 15,
              role: 'host',
            },
            wallets: { villagePoints: 100 },
            focusSummary: { totalSeconds: 0 },
            layout: moved
              ? {
                  schemaVersion: 1,
                  templateVersion: 2,
                  mapId: 'home',
                  buildings: [{ id: 'library', cell: movedCell('library') }],
                }
              : undefined,
          },
          completedBuildings: ['hall'],
          members: [],
        },
        clientConstruction: {
          islandId: 'srv1',
          building: 'library',
          startedAt: Date.parse('2026-09-21T00:00:00Z'),
          endsAt: Date.parse('2026-09-21T01:00:00Z'),
        },
      } as never;
      const screen = await render(
        <FinalIsland
          state={state}
          go={jest.fn()}
          build={jest.fn()}
          showHud={false}
          showActions={false}
        />,
      );
      const out = styleOf(screen, 'village-construction-library');
      await screen.unmount();
      return out;
    };
    const base = await read(false);
    const moved = await read(true);
    expect(moved.left - base.left).toBeCloseTo(expected.dx, 6);
    expect(moved.top - base.top).toBeCloseTo(expected.dy, 6);
  } finally {
    nowSpy.mockRestore();
  }
});

it('건물을 옮겨도 모닥불·뗏목 렌더 지점은 움직이지 않는다(음성)', async () => {
  const state = fullState();
  const read = async (b?: B) => {
    withLayout(state, b);
    const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
    const out = {
      fire: styleOf(screen, 'world-fire-motion'),
      raft: styleOf(screen, 'world-raft-water-motion'),
      hall: styleOf(screen, 'world-hall-motion'),
    };
    await screen.unmount();
    return out;
  };
  const base = await read();
  const moved = await read('hall');
  expect(moved.hall.left).not.toBeCloseTo(base.hall.left, 3); // 대조: 옮긴 건물은 실제로 움직였다
  expect(moved.fire).toEqual(base.fire);
  expect(moved.raft).toEqual(base.raft);
});

it.each(allBuildings)('옮긴 %s 문을 탭하면 걷기 목표가 옮겨진 문 좌표다', async (b) => {
  const state = fullState();
  withLayout(state, b);
  const screen = await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('nav-debug-toggle'));
  await fireEvent.press(screen.getByLabelText(buildingNames[b]));
  const door = legacyDoorCoords.doors[b];
  const tap = screen.getByTestId('tile-terrain').props.navDebug.walk.tap;
  expect(tap.x).toBeCloseTo(door.x + DELTA.x * CELL_PX.x, 6);
  expect(tap.y).toBeCloseTo(door.y + DELTA.y * CELL_PX.y, 6);
  await screen.unmount();
});

// 릴리스 빌드(__DEV__=false)에서는 QA 전환 버튼이 없어야 한다. 플래그는 모듈 로드 시 굳으므로 격리 로드한다.
describe('릴리스 빌드의 디버그 버튼', () => {
  afterAll(() => jest.dontMock('react'));
  const renderIsolated = async (env: Record<string, string | undefined>) => {
    const keys = ['EXPO_PUBLIC_VILLAGE_PREVIEW', 'EXPO_PUBLIC_TILE_ISLAND'];
    const saved = keys.map((k) => process.env[k]);
    const dev = (globalThis as { __DEV__?: boolean }).__DEV__;
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    keys.forEach((k) => (env[k] === undefined ? delete process.env[k] : (process.env[k] = env[k])));
    try {
      // 격리 레지스트리가 React 를 따로 만들면 훅이 깨진다 — 바깥 React 를 그대로 물려준다.
      let Island!: typeof FinalIsland;
      jest.isolateModules(() => {
        jest.doMock('react', () => React);
        Island = (require('./WorldMap') as typeof import('./WorldMap')).FinalIsland;
      });
      return await render(<Island state={initialState()} go={jest.fn()} build={jest.fn()} />);
    } finally {
      (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
      keys.forEach((k, n) =>
        saved[n] === undefined ? delete process.env[k] : (process.env[k] = saved[n]),
      );
    }
  };
  it('미리보기 env 없이 __DEV__=false 면 village-preview-toggle·nav-debug-toggle 이 없다', async () => {
    const screen = await renderIsolated({ EXPO_PUBLIC_TILE_ISLAND: '1' });
    expect(screen.queryByTestId('village-preview-toggle')).toBeNull();
    expect(screen.queryByTestId('nav-debug-toggle')).toBeNull();
    await screen.unmount();
  });
  it('미리보기 env 가 켜져도 타일 섬 플래그가 없으면 nav-debug-toggle 은 없다', async () => {
    const screen = await renderIsolated({ EXPO_PUBLIC_VILLAGE_PREVIEW: '1' });
    expect(screen.getByTestId('village-preview-toggle')).toBeTruthy();
    expect(screen.queryByTestId('nav-debug-toggle')).toBeNull();
    await screen.unmount();
  });
});
