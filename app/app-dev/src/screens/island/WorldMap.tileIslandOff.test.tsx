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
  ...jest.requireActual('@/utils/island-layout'),
  applyLayout: (...args: unknown[]) => mockApplyLayout(...args),
}));
jest.mock('./TileTerrainCanvas', () => ({ TileTerrainCanvas: () => null }));

// WorldMap import 전에 process.env.EXPO_PUBLIC_TILE_ISLAND 를 세운다 — 모듈 로드 시 상수로 굳는다.
// 플래그는 모듈 로드 때 읽는다 — TILE_ISLAND 는 지우고, 새 마을(layered)은 VILLAGE_PREVIEW 로 켠다.
// 서버 배치 적용(applyLayout)은 TILE_ISLAND 에 묶여 있어, 플래그 off 면 새 마을 미리보기가 켜져 있어도 적용하지 않는다.
// (켠 쪽은 WorldMap.tileIsland.test.tsx 가 덮는다. 플래그는 모듈 상수라 한 파일에서 둘을 갈라 볼 수 없다.)
delete process.env.EXPO_PUBLIC_TILE_ISLAND;
process.env.EXPO_PUBLIC_VILLAGE_PREVIEW = '1';
const { FinalIsland } = require('./WorldMap') as typeof import('./WorldMap');

it('타일 섬 플래그 off + 새 마을 미리보기 on 이면 서버 home.layout 이 있어도 applyLayout 을 적용하지 않아 map.json 위치 그대로다', async () => {
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

it('플래그 off + 미리보기 없음이면 기존 바닥 Image 를 그리고 타일 캔버스는 없다', async () => {
  // 미리보기 env 는 모듈 로드 때 굳으므로 격리 로드한다.
  delete process.env.EXPO_PUBLIC_VILLAGE_PREVIEW;
  let Island!: typeof FinalIsland;
  let assets!: typeof import('@/constants/assets').assets;
  jest.isolateModules(() => {
    // 격리 레지스트리가 React 를 따로 만들면 훅이 깨진다 — 바깥 React 를 그대로 물려준다.
    jest.doMock('react', () => React);
    Island = (require('./WorldMap') as typeof import('./WorldMap')).FinalIsland;
    assets = (require('@/constants/assets') as typeof import('@/constants/assets')).assets;
  });
  mockFacts.current = null;
  const screen = await render(<Island state={initialState()} go={jest.fn()} build={jest.fn()} />);
  const nodes: { props: Record<string, unknown>; children: unknown[] | null }[] = [];
  const walk = (n: any) => {
    if (!n || typeof n === 'string') return;
    if (Array.isArray(n)) return n.forEach(walk);
    nodes.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(screen.toJSON());
  const hour = new Date().getHours();
  const base = assets[`backgrounds/island/base/${hour >= 6 && hour < 18 ? 'day' : 'night'}.png`];
  expect(nodes.some((n) => n.props.source === base)).toBe(true);
  expect(screen.queryByTestId('tile-terrain')).toBeNull();
});
