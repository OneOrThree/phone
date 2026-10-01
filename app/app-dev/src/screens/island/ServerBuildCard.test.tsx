import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { FinalIsland } from '@/screens/island/WorldMap';
import { initialState } from '@/services/model';
import { ApiError } from '@/services/api/client';
import * as home from '@/services/api/home';
import * as islands from '@/services/api/islands';

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
jest.mock('@/services/api/home', () => ({
  ...jest.requireActual('@/services/api/home'),
  getConstructionOptions: jest.fn(),
  getMembers: jest.fn(),
  startConstruction: jest.fn(),
}));
jest.mock('@/services/api/islands', () => ({
  ...jest.requireActual('@/services/api/islands'),
  myIslands: jest.fn(),
}));

const api = home as jest.Mocked<typeof home>;
const mine = islands as jest.Mocked<typeof islands>;

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  jest.restoreAllMocks(); // spyOn(Date, 'now') 등 — jest.fn() 목은 clearAllMocks 로 이미 정리됐다
});

const serverState = (
  role: 'host' | 'member',
  completedBuildings: string[] = [],
  islandId = 'srv1',
) => {
  const state = initialState(true);
  state.serverIslands = {
    currentIslandId: islandId,
    home: {
      islandId,
      home: {
        island: { id: islandId, name: '새섬', intro: '', maxMembers: 15, role },
        wallets: { villagePoints: 70 },
        focusSummary: { totalSeconds: 0 },
      },
      completedBuildings,
      members: [],
    },
  } as any;
  return state;
};

const hallOptions = {
  islandVersion: 3,
  costPolicyVersion: 1,
  selectedBuildingId: null,
  villagePoints: 70,
  walletVersion: 2,
  items: [
    {
      id: 'hall',
      name: '마을회관',
      cost: 60,
      currency: 'village_points',
      selectable: true,
      buildable: true,
      blockedReason: null,
    },
  ],
} as any;

test('회관 없는 섬의 방장은 홈에서 서버 건설로 회관을 짓고 홈 스냅샷을 다시 읽는다', async () => {
  mine.myIslands.mockResolvedValue({
    items: [{ id: 'srv1' }],
    currentIslandId: 'srv1',
  } as any);
  api.getMembers.mockResolvedValue({ items: [], nextCursor: null, version: 1 } as any);
  api.getConstructionOptions.mockResolvedValue(hallOptions);
  api.startConstruction.mockResolvedValue({
    buildingId: 'hall',
    status: 'BUILDING',
    spent: { currency: 'village_points', amount: 60 },
    version: 4,
    villagePoints: 10,
    walletVersion: 3,
    startedAt: '2026-09-29T00:00:00Z',
    completesAt: '2026-09-29T00:10:00Z',
  } as any);
  const build = jest.fn(),
    dispatch = jest.fn(),
    onServerBuilt = jest.fn();
  const screen = await render(
    <FinalIsland
      state={serverState('host')}
      go={jest.fn()}
      build={build}
      dispatch={dispatch}
      onServerBuilt={onServerBuilt}
    />,
  );
  // 접힌 카드는 스냅샷만 그린다 — 홈 진입에 건설 조회를 더하지 않는다
  expect(screen.getByText('마을회관 짓기')).toBeTruthy();
  assert.equal(api.getConstructionOptions.mock.calls.length, 0);

  await act(async () => fireEvent.press(screen.getByTestId('server-build-open')));
  await act(async () => fireEvent.press(await screen.findByTestId('server-build-start')));

  assert.equal(api.getConstructionOptions.mock.calls[0][0], 'srv1');
  const [islandId, buildingId, version, costVersion] = api.startConstruction.mock.calls[0];
  assert.equal(islandId, 'srv1');
  assert.equal(buildingId, 'hall');
  assert.equal(version, 3);
  assert.equal(costVersion, 1);
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'SERVER_CONSTRUCTION_STARTED',
      islandId: 'srv1',
      building: 'hall',
      startedAt: Date.parse('2026-09-29T00:00:00Z'),
      endsAt: Date.parse('2026-09-29T00:10:00Z'),
    }),
  );
  assert.equal(onServerBuilt.mock.calls.length, 1);
  // 로컬 BUILD 는 부르지 않는다
  assert.equal(build.mock.calls.length, 0);
});

test('회관을 지은 뒤에는 게시판을 짓는 카드가 뜬다', async () => {
  const screen = await render(
    <FinalIsland
      state={serverState('host', ['hall'])}
      go={jest.fn()}
      build={jest.fn()}
      onServerBuilt={jest.fn()}
    />,
  );
  expect(screen.getByText('게시판 짓기')).toBeTruthy();
});

test('주민(member)에게는 서버 건설 카드가 렌더링되지 않는다', async () => {
  const screen = await render(
    <FinalIsland
      state={serverState('member')}
      go={jest.fn()}
      build={jest.fn()}
      onServerBuilt={jest.fn()}
    />,
  );
  expect(screen.queryByTestId('server-build-card')).toBeNull();
  expect(screen.queryByText('건설하기')).toBeNull();
});

// SERVER_CONSTRUCTION_STARTED 를 실제 리듀서처럼 state.serverIslands.clientConstruction 에
// 반영해 재렌더한다 — receipt 확보 뒤 재조회가 실패해도 카드가 「공사 중」을 유지하는지 본다.
function ServerBuildHost({ onServerBuilt }: { onServerBuilt: () => void }) {
  const [state, setState] = useState(serverState('host'));
  const dispatch = (action: any) => {
    if (action.type === 'SERVER_CONSTRUCTION_STARTED') {
      setState(
        (prev) =>
          ({
            ...prev,
            serverIslands: {
              ...prev.serverIslands,
              clientConstruction: {
                islandId: action.islandId,
                building: action.building,
                startedAt: action.startedAt,
                endsAt: action.endsAt,
              },
            },
          }) as any,
      );
    }
  };
  return (
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      dispatch={dispatch}
      onServerBuilt={onServerBuilt}
    />
  );
}

test('receipt 확보 뒤 옵션 재조회가 실패해도 공사 중 표시를 유지하고 실패 메시지는 감춘다', async () => {
  // 착공 시각(00:00) 뒤 1분 지난 시점 — 진행률 < 1 이라 「완공 확인」이 아니라 남은 시간을 본다.
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T00:01:00Z'));
  mine.myIslands.mockResolvedValue({
    items: [{ id: 'srv1' }],
    currentIslandId: 'srv1',
  } as any);
  api.getMembers.mockResolvedValue({ items: [], nextCursor: null, version: 1 } as any);
  api.getConstructionOptions
    .mockResolvedValueOnce(hallOptions) // 카드를 펼칠 때의 첫 조회
    .mockRejectedValueOnce(new Error('x')); // 착공 성공 뒤 재조회
  api.startConstruction.mockResolvedValue({
    buildingId: 'hall',
    status: 'BUILDING',
    spent: { currency: 'village_points', amount: 60 },
    version: 4,
    villagePoints: 10,
    walletVersion: 3,
    startedAt: '2026-09-29T00:00:00Z',
    completesAt: '2026-09-29T00:10:00Z',
  } as any);
  const onServerBuilt = jest.fn();
  const screen = await render(<ServerBuildHost onServerBuilt={onServerBuilt} />);

  await act(async () => fireEvent.press(screen.getByTestId('server-build-open')));
  await act(async () => fireEvent.press(await screen.findByTestId('server-build-start')));

  expect(screen.getByText('마을회관 공사 중')).toBeTruthy();
  expect(screen.getByText('9분 남음')).toBeTruthy();
  expect(screen.queryByText(/불러오지 못했어요|건설을 시작하지 못했어요|^x$/)).toBeNull();
  expect(onServerBuilt).toHaveBeenCalled();
  // 카드 오픈 시 1회 + 착공 성공 뒤 재조회 1회(실패로 끝남) = 2회
  assert.equal(api.getConstructionOptions.mock.calls.length, 2);
});

test('착공 성공 뒤 재조회가 실패했는데 dispatch 가 반영되지 않으면(tracked 없음) 실패 메시지를 보여준다', async () => {
  mine.myIslands.mockResolvedValue({
    items: [{ id: 'srv1' }],
    currentIslandId: 'srv1',
  } as any);
  api.getMembers.mockResolvedValue({ items: [], nextCursor: null, version: 1 } as any);
  api.getConstructionOptions
    .mockResolvedValueOnce(hallOptions)
    .mockRejectedValueOnce(new Error('x'));
  api.startConstruction.mockResolvedValue({
    buildingId: 'hall',
    status: 'BUILDING',
    spent: { currency: 'village_points', amount: 60 },
    version: 4,
    villagePoints: 10,
    walletVersion: 3,
    startedAt: '2026-09-29T00:00:00Z',
    completesAt: '2026-09-29T00:10:00Z',
  } as any);
  const onServerBuilt = jest.fn();
  // 반영되지 않는(no-op) dispatch — clientConstruction 이 세워지지 않아 tracked 는 계속 null.
  const screen = await render(
    <FinalIsland
      state={serverState('host')}
      go={jest.fn()}
      build={jest.fn()}
      dispatch={jest.fn()}
      onServerBuilt={onServerBuilt}
    />,
  );

  await act(async () => fireEvent.press(screen.getByTestId('server-build-open')));
  await act(async () => fireEvent.press(await screen.findByTestId('server-build-start')));

  await waitFor(() => assert.equal(api.getConstructionOptions.mock.calls.length, 2));
  expect(screen.getByText('x')).toBeTruthy();
  assert.equal(onServerBuilt.mock.calls.length, 1);
});

test('건설 시작이 403으로 거절되면 메시지를 보여주고 홈을 다시 읽는다', async () => {
  mine.myIslands.mockResolvedValue({
    items: [{ id: 'srv1' }],
    currentIslandId: 'srv1',
  } as any);
  api.getMembers.mockResolvedValue({ items: [], nextCursor: null, version: 1 } as any);
  api.getConstructionOptions.mockResolvedValue(hallOptions);
  api.startConstruction.mockRejectedValue(new ApiError('FORBIDDEN', '권한이 없어요', 403));
  const onServerBuilt = jest.fn();
  const screen = await render(
    <FinalIsland
      state={serverState('host')}
      go={jest.fn()}
      build={jest.fn()}
      dispatch={jest.fn()}
      onServerBuilt={onServerBuilt}
    />,
  );

  await act(async () => fireEvent.press(screen.getByTestId('server-build-open')));
  await act(async () => fireEvent.press(await screen.findByTestId('server-build-start')));

  expect(screen.getByText('권한이 없어요')).toBeTruthy();
  assert.equal(onServerBuilt.mock.calls.length, 1);
  // 실패 뒤 재조회로 옵션이 다시 buildable 하니 버튼은 다시 눌러진다(비활성으로 남지 않는다).
  const startBtn = screen.getByTestId('server-build-start');
  assert.equal(startBtn.props.accessibilityState.disabled, false);

  // 다시 누르면(이번엔 응답이 오지 않는 요청) 이전 실패 메시지부터 지운다.
  api.startConstruction.mockImplementation(() => new Promise(() => {}));
  await act(async () => fireEvent.press(startBtn));
  expect(screen.queryByText('권한이 없어요')).toBeNull();
});

test('다른 기기가 짓고 있어 IN_PROGRESS 로 막히면 새로고침으로 옵션을 다시 읽는다', async () => {
  mine.myIslands.mockResolvedValue({
    items: [{ id: 'srv1' }],
    currentIslandId: 'srv1',
  } as any);
  api.getMembers.mockResolvedValue({ items: [], nextCursor: null, version: 1 } as any);
  api.getConstructionOptions
    .mockResolvedValueOnce({
      ...hallOptions,
      items: [
        {
          id: 'hall',
          name: '마을회관',
          cost: 60,
          currency: 'village_points',
          selectable: false,
          buildable: false,
          blockedReason: 'IN_PROGRESS',
        },
      ],
    } as any)
    // 새로고침 시점엔 다른 기기가 이미 끝내 완공 목록으로 옮겨갔다 — items 에서 빠진다.
    .mockResolvedValueOnce({ ...hallOptions, items: [] } as any);
  const onServerBuilt = jest.fn();
  const screen = await render(
    <FinalIsland
      state={serverState('host')}
      go={jest.fn()}
      build={jest.fn()}
      dispatch={jest.fn()}
      onServerBuilt={onServerBuilt}
    />,
  );

  await act(async () => fireEvent.press(screen.getByTestId('server-build-open')));
  expect(await screen.findByText('다른 공사가 끝난 뒤에 지을 수 있어요')).toBeTruthy();
  assert.equal(api.getConstructionOptions.mock.calls.length, 1);

  await act(async () => fireEvent.press(screen.getByTestId('server-build-recheck')));

  await waitFor(() => expect(screen.getByTestId('server-build-refresh')).toBeTruthy());
  expect(screen.queryByText('다른 공사가 끝난 뒤에 지을 수 있어요')).toBeNull();
  assert.equal(api.getConstructionOptions.mock.calls.length, 2);
  assert.equal(onServerBuilt.mock.calls.length, 1);
});

test('카드를 편 채로 다른 섬으로 전환되면(key 리셋) 다시 건설하기 버튼이 뜬다', async () => {
  mine.myIslands.mockResolvedValue({
    items: [{ id: 'srv1' }],
    currentIslandId: 'srv1',
  } as any);
  api.getConstructionOptions.mockResolvedValue(hallOptions);
  const screen = await render(
    <FinalIsland
      state={serverState('host')}
      go={jest.fn()}
      build={jest.fn()}
      dispatch={jest.fn()}
      onServerBuilt={jest.fn()}
    />,
  );

  await act(async () => fireEvent.press(screen.getByTestId('server-build-open')));
  expect(await screen.findByTestId('server-build-start')).toBeTruthy();

  // WorldMap 은 `${facts.islandId}:${next}` 를 key 로 준다 — 섬이 바뀌면 카드가 통째로 리마운트된다.
  await act(async () =>
    screen.rerender(
      <FinalIsland
        state={serverState('host', [], 'srv2')}
        go={jest.fn()}
        build={jest.fn()}
        dispatch={jest.fn()}
        onServerBuilt={jest.fn()}
      />,
    ),
  );

  expect(screen.getByTestId('server-build-open')).toBeTruthy();
});

test('완공 확인을 눌렀는데도 서버가 아직 진행 중이면 안내를 보여준다', async () => {
  const state = serverState('host');
  // 착공 구간이 이미 지났다 — 「완공 확인」이 뜨는 조건(progress >= 1)이다.
  (state as any).serverIslands.clientConstruction = {
    islandId: 'srv1',
    building: 'hall',
    startedAt: Date.parse('2020-01-01T00:00:00Z'),
    endsAt: Date.parse('2020-01-01T00:10:00Z'),
  };
  const onServerBuilt = jest.fn();
  const screen = await render(
    <FinalIsland
      state={state}
      go={jest.fn()}
      build={jest.fn()}
      dispatch={jest.fn()}
      onServerBuilt={onServerBuilt}
    />,
  );

  await act(async () => fireEvent.press(screen.getByTestId('server-build-refresh')));

  assert.equal(onServerBuilt.mock.calls.length, 1);
  expect(screen.getByText(/아직 마무리 중이에요/)).toBeTruthy();
});

test('다른 곳에서 섬을 옮겨 서버가 배운 섬이 홈 스냅샷과 다르면 섬 정보가 바뀌었다고 안내한다', async () => {
  // 홈 스냅샷은 srv1 인데, 실제 서버가 배운 current 는 srv2 — 다른 화면에서 섬을 옮긴 상황.
  mine.myIslands.mockResolvedValue({
    items: [{ id: 'srv2' }],
    currentIslandId: 'srv2',
  } as any);
  api.getConstructionOptions.mockResolvedValue(hallOptions);
  const onServerBuilt = jest.fn();
  const screen = await render(
    <FinalIsland
      state={serverState('host')}
      go={jest.fn()}
      build={jest.fn()}
      dispatch={jest.fn()}
      onServerBuilt={onServerBuilt}
    />,
  );

  await act(async () => fireEvent.press(screen.getByTestId('server-build-open')));

  expect(await screen.findByText('섬 정보가 바뀌었어요')).toBeTruthy();
  expect(screen.queryByTestId('server-build-start')).toBeNull();
  assert.equal(api.startConstruction.mock.calls.length, 0);

  // 새로고침 — 다른 화면에서 원래 섬(srv1)으로 다시 옮겨온 상황을 반영한다.
  mine.myIslands.mockResolvedValue({
    items: [{ id: 'srv1' }],
    currentIslandId: 'srv1',
  } as any);
  await act(async () => fireEvent.press(screen.getByTestId('server-build-refresh')));

  await waitFor(() => expect(screen.getByTestId('server-build-start')).toBeTruthy());
  expect(onServerBuilt).toHaveBeenCalled();
});

test('이 카드는 withMembers:false 로 주민 조회를 건너뛴다 — getMembers 가 실패해도 건설은 된다', async () => {
  mine.myIslands.mockResolvedValue({
    items: [{ id: 'srv1' }],
    currentIslandId: 'srv1',
  } as any);
  api.getMembers.mockRejectedValue(new Error('호출되면 안 된다'));
  api.getConstructionOptions.mockResolvedValue(hallOptions);
  api.startConstruction.mockResolvedValue({
    buildingId: 'hall',
    status: 'BUILDING',
    spent: { currency: 'village_points', amount: 60 },
    version: 4,
    villagePoints: 10,
    walletVersion: 3,
    startedAt: '2026-09-29T00:00:00Z',
    completesAt: '2026-09-29T00:10:00Z',
  } as any);
  const dispatch = jest.fn();
  const onServerBuilt = jest.fn();
  const screen = await render(
    <FinalIsland
      state={serverState('host')}
      go={jest.fn()}
      build={jest.fn()}
      dispatch={dispatch}
      onServerBuilt={onServerBuilt}
    />,
  );

  await act(async () => fireEvent.press(screen.getByTestId('server-build-open')));
  await act(async () => fireEvent.press(await screen.findByTestId('server-build-start')));

  assert.equal(api.getMembers.mock.calls.length, 0);
  assert.equal(onServerBuilt.mock.calls.length, 1);
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'SERVER_CONSTRUCTION_STARTED',
      islandId: 'srv1',
      building: 'hall',
    }),
  );
});
