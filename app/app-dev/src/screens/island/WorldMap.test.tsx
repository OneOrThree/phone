import React from 'react';
import { act, cleanup, render } from '@testing-library/react-native';
import { FinalIsland } from '@/screens/island/WorldMap';
import { buildingNames, initialState } from '@/services/model';

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

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const serverConstructionState = (
  state: ReturnType<typeof initialState>,
  activeConstruction: Record<string, unknown> | null,
  completedBuildings: string[] = ['hall'],
) => {
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
      },
      completedBuildings,
      activeConstruction,
      constructionObservedAt: Date.parse('2026-09-21T00:10:00Z'),
      members: [],
    },
  } as any;
};

test('방문 섬에서는 축음기를 터치 대상으로 노출하지 않는다', async () => {
  const state = initialState(true);
  const visited = state.islands.find((island) => island.id === 'cloud')!;
  if (!visited.buildings.includes('gram')) visited.buildings.push('gram');
  state.visitingIslandId = visited.id;

  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      notify={jest.fn()}
      showHud={false}
      showActions={false}
    />,
  );

  expect(screen.queryByLabelText(buildingNames.gram)).toBeNull();
});

test('내 섬에서는 축음기를 열 수 있다', async () => {
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  if (!island.buildings.includes('gram')) island.buildings.push('gram');

  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showHud={false}
      showActions={false}
    />,
  );

  screen.getByLabelText(buildingNames.gram);
});

test('내 섬에서도 미완공 축음기는 터치 대상으로 노출하지 않는다', async () => {
  const state = initialState(true);
  const island = state.islands.find((item) => item.id === state.islandId)!;
  island.buildings = island.buildings.filter((building) => building !== 'gram');

  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showHud={false}
      showActions={false}
    />,
  );

  expect(screen.queryByLabelText(buildingNames.gram)).toBeNull();
});

test('서버 공사 진행률에 해당하는 건물 sprite 단계를 섬 위에 표시한다', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-21T00:10:00Z'));
  const state = initialState(true);
  serverConstructionState(state, {
    buildingId: 'library',
    status: 'BUILDING',
    startedAt: '2026-09-21T00:00:00Z',
    completesAt: '2026-09-21T01:00:00Z',
    serverNow: '2026-09-21T00:10:00Z',
    version: 3,
  });

  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showHud={false}
      showActions={false}
    />,
  );

  screen.getByTestId('village-construction-library');
  screen.getByTestId('construction-sprite-library-structure');
  expect(screen.queryByLabelText(buildingNames.library)).toBeNull();
});

test('서버가 완공으로 전환한 직후 completion sprite를 한 번 표시한다', async () => {
  jest.useFakeTimers();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-21T01:00:00Z'));
  const state = initialState(true);
  state.settings.reduceMotion = true;
  const active = {
    buildingId: 'library',
    status: 'BUILDING',
    startedAt: '2026-09-21T00:00:00Z',
    completesAt: '2026-09-21T01:00:00Z',
    serverNow: '2026-09-21T00:59:59Z',
    version: 3,
  };
  serverConstructionState(state, active);
  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showHud={false}
      showActions={false}
    />,
  );

  serverConstructionState(state, null, ['hall', 'library']);
  await screen.rerender(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showHud={false}
      showActions={false}
    />,
  );

  screen.getByTestId('construction-sprite-library-completion');

  // 연출 중 설정 변경으로 effect가 다시 실행돼도 기존 종료 타이머는 살아 있어야 한다.
  state.settings.reduceMotion = false;
  await screen.rerender(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      showHud={false}
      showActions={false}
    />,
  );
  await act(async () => jest.advanceTimersByTime(601));
  expect(screen.queryByTestId('construction-sprite-library-completion')).toBeNull();
});
