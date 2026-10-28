import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
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

// 웹 빌드는 이미지 섬이다(GROMO-2476 — iOS·Android 는 늘 타일 섬). TILE_ISLAND 는 모듈 로드 때 Platform.OS 로
// 굳으므로 그때만 'web' 으로 두고 바로 되돌린다 — jest 엔 DOM 이 없어 웹 전용 런타임 분기(window.location·
// getBoundingClientRect)는 돌릴 수 없다. 새 마을(layered)은 VILLAGE_PREVIEW 로 켠다.
// 서버 배치 적용(applyLayout)은 TILE_ISLAND 에 묶여 있어, 웹이면 새 마을 미리보기가 켜져 있어도 적용하지 않는다.
// (타일 섬 쪽은 WorldMap.tileIsland.test.tsx 가 덮는다. 상수라 한 모듈 인스턴스에서 둘을 갈라 볼 수 없다.)
const requireAsWeb = <T,>(platform: typeof Platform, load: () => T): T => {
  const os = platform.OS;
  (platform as { OS: string }).OS = 'web';
  try {
    return load();
  } finally {
    (platform as { OS: string }).OS = os;
  }
};
process.env.EXPO_PUBLIC_VILLAGE_PREVIEW = '1';
const { FinalIsland } = requireAsWeb(
  Platform,
  () => require('./WorldMap') as typeof import('./WorldMap'),
);

it('웹(이미지 섬) + 새 마을 미리보기 on 이면 서버 home.layout 이 있어도 applyLayout 을 적용하지 않아 map.json 위치 그대로다', async () => {
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

it('웹 + 미리보기 없음이면 기존 바닥 Image 를 그리고 타일 캔버스는 없다', async () => {
  // 미리보기 env 는 모듈 로드 때 굳으므로 격리 로드한다.
  delete process.env.EXPO_PUBLIC_VILLAGE_PREVIEW;
  let Island!: typeof FinalIsland;
  let terrain!: typeof import('./IslandOcean').islandTerrain;
  jest.isolateModules(() => {
    // 격리 레지스트리가 React 를 따로 만들면 훅이 깨진다 — 바깥 React 를 그대로 물려준다.
    jest.doMock('react', () => React);
    // 격리 레지스트리의 react-native 는 바깥과 다른 인스턴스다 — 그 Platform 으로 웹을 흉내 낸다.
    const isolatedPlatform = (require('react-native') as typeof import('react-native')).Platform;
    Island = requireAsWeb(
      isolatedPlatform,
      () => require('./WorldMap') as typeof import('./WorldMap'),
    ).FinalIsland;
    terrain = (require('./IslandOcean') as typeof import('./IslandOcean')).islandTerrain;
  });
  mockFacts.current = null;
  const go = jest.fn();
  const state = initialState(true);
  // 낮/밤 바닥은 로컬 시각으로 갈린다 — 테스트가 시계에 기대지 않도록 한낮으로 고정한다(GROMO-2253).
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-06-15T12:00:00'));
  try {
    const screen = await render(<Island state={state} go={go} build={jest.fn()} />);
    const nodes: { props: Record<string, unknown>; children: unknown[] | null }[] = [];
    const walk = (n: any) => {
      if (!n || typeof n === 'string') return;
      if (Array.isArray(n)) return n.forEach(walk);
      nodes.push(n);
      (n.children ?? []).forEach(walk);
    };
    walk(screen.toJSON());
    const base = terrain.day;
    expect(nodes.some((n) => n.props.source === base)).toBe(true);
    expect(screen.queryByTestId('tile-terrain')).toBeNull();
    expect(screen.getByTestId('image-terrain-facilities')).toBeTruthy();
    for (const id of [
      'hall',
      'board',
      'gram',
      'library',
      'mail',
      'tower',
      'shop',
      'fire',
      'raft',
    ]) {
      expect(screen.getByTestId(`building-name-${id}`)).toBeTruthy();
    }
    expect(screen.getByTestId('world-static-building-gram')).toBeTruthy();
    expect(screen.getByTestId('building-name-gram')).toBeTruthy();
    const raft = screen.getByTestId('building-name-raft');
    const initialMatrix = screen.getByTestId('image-terrain-facility-raft').props.matrix;
    await fireEvent(raft, 'pressIn');
    expect(screen.getByTestId('image-terrain-facility-raft').props.matrix).not.toEqual(
      initialMatrix,
    );
    expect(screen.getByTestId('image-terrain-facility-raft').props.matrix[0]).toBeCloseTo(0.97);
    await fireEvent(raft, 'pressOut');
    expect(screen.getByTestId('image-terrain-facility-raft').props.matrix).toEqual(initialMatrix);
    await fireEvent.press(raft);
    expect(go).toHaveBeenCalledWith('raft');
  } finally {
    jest.useRealTimers();
  }
});
