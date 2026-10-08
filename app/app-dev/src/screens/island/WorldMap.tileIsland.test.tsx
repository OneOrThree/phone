import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { initialState } from '@/services/model';
import { villageAssets } from '@/constants/village-assets';
import { assets } from '@/constants/assets';
import { buildingNames } from '@/services/model';

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
    layout: { schemaVersion: 1, mapId: 'm', buildings: [{ id: 'hall', cell: { x: 10, y: 10 } }] },
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
      f.home.layout = { schemaVersion: 1, mapId: 'home', buildings: [{ id: 'gram', cell }] };
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
