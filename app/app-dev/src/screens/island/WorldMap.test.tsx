import React from 'react';
import { cleanup, render } from '@testing-library/react-native';
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

afterEach(cleanup);

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
