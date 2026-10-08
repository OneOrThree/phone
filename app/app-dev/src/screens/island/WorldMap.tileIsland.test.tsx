import React from 'react';
import { render } from '@testing-library/react-native';
import { initialState } from '@/services/model';
import { villageAssets } from '@/constants/village-assets';

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
  return { TileTerrainCanvas: (props: object) => <View testID="tile-terrain" {...props} /> };
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
// applyLayout 은 호출 여부만 보도록 통과(passthrough) 스파이로 둔다.
const mockApplyLayout = jest.fn((objects: unknown, _layout?: unknown) => objects);
jest.mock('@/utils/island-layout', () => ({
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

it('EXPO_PUBLIC_TILE_ISLAND=1 이면 새 마을로 시작하고 지형 Image 대신 Skia 타일 캔버스를 둔다', async () => {
  const screen = await render(
    <FinalIsland state={initialState()} go={jest.fn()} build={jest.fn()} />,
  );
  expect(screen.getByTestId('tile-terrain').props).toMatchObject({
    width: 402,
    height: 874,
    camera: { x: 800, y: 510, z: 1 },
  });
  const terrain = collect(screen.toJSON() as Node).filter(
    (n) => n.props.source === villageAssets['terrain.png'],
  );
  expect(terrain).toHaveLength(0);
});

it('플래그 on + 서버 home.layout 이 있으면 applyLayout 을 부른다(off 테스트가 헛통과가 아님을 증명하는 양성 쌍)', async () => {
  const state = initialState();
  mockFacts.current = {
    islandId: state.islands[0].id,
    members: [],
    completedBuildings: [],
    home: {
      layout: { schemaVersion: 1, mapId: 'm', buildings: [{ id: 'hall', cell: { x: 10, y: 10 } }] },
      focusSummary: { totalSeconds: 0 },
      island: { role: 'member' },
      wallets: { villagePoints: 0 },
    },
  };
  await render(<FinalIsland state={state} go={jest.fn()} build={jest.fn()} />);
  expect(mockApplyLayout).toHaveBeenCalled();
});
