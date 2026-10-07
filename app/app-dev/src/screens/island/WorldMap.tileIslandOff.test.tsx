import React from 'react';
import { render } from '@testing-library/react-native';
import { initialState } from '@/services/model';

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
// 서버 스냅샷(layout 포함)을 가짜로 주입하고, applyLayout 호출 여부로 위치 변경을 본다.
const mockFacts = { current: null as unknown };
jest.mock('@/services/model', () => {
  const actual = jest.requireActual('@/services/model');
  return { ...actual, serverHome: () => mockFacts.current };
});
const mockApplyLayout = jest.fn();
jest.mock('@/utils/island-layout', () => ({
  applyLayout: (...args: unknown[]) => mockApplyLayout(...args),
}));
jest.mock('./TileTerrainCanvas', () => ({ TileTerrainCanvas: () => null }));

// 플래그는 모듈 로드 때 읽는다 — TILE_ISLAND 는 지우고, 새 마을(layered)은 VILLAGE_PREVIEW 로 켠다.
// (켠 쪽은 WorldMap.tileIsland.test.tsx 가 덮는다. 플래그는 모듈 상수라 한 파일에서 둘을 갈라 볼 수 없다.)
delete process.env.EXPO_PUBLIC_TILE_ISLAND;
process.env.EXPO_PUBLIC_VILLAGE_PREVIEW = '1';
const { FinalIsland } = require('./WorldMap') as typeof import('./WorldMap');

it('플래그 off 면 서버 home.layout 이 있어도 applyLayout 을 부르지 않아 map.json 위치 그대로다', async () => {
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
  expect(mockApplyLayout).not.toHaveBeenCalled();
});
