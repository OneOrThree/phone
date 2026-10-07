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
