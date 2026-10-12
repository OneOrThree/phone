import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RaftDestinations } from '@/screens/island/RaftDestinations';
import { initialState, reducer } from '@/services/model';
import { ApiError } from '@/services/api/client';

// 세션 세대를 테스트가 바꿀 수 있게 한다(나머지 export 는 실제 구현 유지).
let mockGeneration = 0;
jest.mock('@/services/api/session', () => ({
  ...jest.requireActual('@/services/api/session'),
  sessionGeneration: () => mockGeneration,
}));
beforeEach(() => {
  mockGeneration = 0;
});

jest.mock('@/screens/island/IslandSheet', () => ({
  IslandSheet: ({ children }: any) => {
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
  SheetRow: ({ title, onPress, disabled }: any) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    );
  },
}));
jest.mock('@/screens/world/WorldViews', () => ({
  Sailing: ({ destination, from, onArrive }: any) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID="sailing" onPress={onArrive}>
        <Text>{destination}</Text>
        <Text testID="sailing-from">{from}</Text>
      </Pressable>
    );
  },
}));

const isl = (id: string, name: string, extra: object = {}) => ({
  id,
  name,
  intro: '',
  memberCount: 1,
  maxMembers: 15,
  approvalRequired: false,
  ...extra,
});

function env(visitingId: string | null = null) {
  let state = reducer(initialState(true), {
    type: 'ISLAND_SYNC',
    memberships: {
      items: [
        isl('a', '하나', { arrivedBefore: true }),
        isl('b', '둘', { arrivedBefore: true }),
        isl('c', '셋', { arrivedBefore: false }),
        isl('d', '넷'),
      ],
      currentIslandId: 'a',
      nextCursor: null,
      lossReason: null,
    },
  });
  if (visitingId) state = { ...state, visitingIslandId: visitingId };
  return {
    state,
    dispatch: jest.fn(),
    reset: jest.fn(),
    go: jest.fn(),
    back: jest.fn(),
    home: jest.fn(),
    notify: jest.fn(),
    replace: jest.fn(),
    backOverride: { current: null as null | (() => boolean) },
    islands: { switchCurrent: jest.fn().mockResolvedValue(undefined) },
  };
}

test('도착한 적 없는 섬과 현재 섬은 빼고, arrivedBefore 가 없으면 포함한다', async () => {
  const e = env();
  const screen = await render(<RaftDestinations e={e} />);
  expect(screen.getByText('둘섬으로')).toBeTruthy();
  expect(screen.getByText('넷섬으로')).toBeTruthy();
  expect(screen.queryByText('하나섬으로')).toBeNull();
  expect(screen.queryByText('셋섬으로')).toBeNull();
  expect(screen.getByText('앞바다 낚시섬')).toBeTruthy();
  expect(screen.getByText('망원경')).toBeTruthy();
  expect(screen.getByText('내 뗏목')).toBeTruthy();
});

test('「○○섬으로」는 switchCurrent 뒤 항해 연출을 거쳐 home 으로 reset 한다', async () => {
  const e = env();
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('둘섬으로'));
  expect(e.islands.switchCurrent).toHaveBeenCalledWith('b');
  await fireEvent.press(await screen.findByTestId('sailing'));
  expect(e.reset).toHaveBeenCalledWith('home');
  expect(e.dispatch).not.toHaveBeenCalled();
});

test('거절되면 서버 문구를 알리고 연출하지 않는다', async () => {
  const e = env();
  e.islands.switchCurrent.mockRejectedValue(
    new ApiError('ISLAND_NOT_ARRIVED', '아직 가 본 적 없는 섬이에요.', 403),
  );
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('둘섬으로'));
  await act(async () => {});
  expect(e.notify).toHaveBeenCalledWith('아직 가 본 적 없는 섬이에요. 망원경에서 항해해 주세요.');
  expect(screen.queryByTestId('sailing')).toBeNull();
});

test('방문 중에는 소속 섬 전부(방문 섬 포함, 미도착 제외)만 보이고 떠나면 END_VISIT 한다', async () => {
  const e = env('b');
  const screen = await render(<RaftDestinations e={e} />);
  expect(screen.getByText('하나섬으로')).toBeTruthy();
  expect(screen.getByText('둘섬으로')).toBeTruthy();
  expect(screen.getByText('넷섬으로')).toBeTruthy();
  expect(screen.queryByText('셋섬으로')).toBeNull();
  expect(screen.queryByText('앞바다 낚시섬')).toBeNull();
  expect(screen.queryByText('망원경')).toBeNull();
  expect(screen.queryByText('내 뗏목')).toBeNull();
  await fireEvent.press(screen.getByText('하나섬으로'));
  await fireEvent.press(await screen.findByTestId('sailing'));
  expect(e.dispatch).toHaveBeenCalledWith({ type: 'END_VISIT' });
  expect(e.reset).toHaveBeenCalledWith('home');
});

test('방문 중 시트를 닫으면 방문 섬 지도로, 항해 중 뒤로가기는 삼킨다', async () => {
  const e = env('b');
  const screen = await render(<RaftDestinations e={e} />);
  expect(e.backOverride.current).toBeNull();
  await fireEvent.press(screen.getByText('하나섬으로'));
  await screen.findByTestId('sailing');
  expect(e.backOverride.current?.()).toBe(true);
  expect(e.home).not.toHaveBeenCalled();
});

test('이동 요청 중에는 닫기·뒤로가기·다른 행이 막히고 완료 뒤 항해로 간다', async () => {
  const e = env('b');
  let finish!: () => void;
  e.islands.switchCurrent.mockReturnValue(new Promise<void>((r) => (finish = r)));
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.backOverride.current?.()).toBe(true);
  await fireEvent.press(screen.getByText('넷섬으로'));
  expect(e.islands.switchCurrent).toHaveBeenCalledTimes(1);
  expect(e.replace).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(await screen.findByTestId('sailing')).toBeTruthy();
});

test('방문 중 항해 출발지는 방문 섬 이름이다', async () => {
  const e = env('b');
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect((await screen.findByTestId('sailing-from')).props.children).toBe('둘');
});

test('요청 중 언마운트되면 응답이 와도 아무것도 하지 않는다(reset 0·경고 0)', async () => {
  const e = env('b');
  let finish!: () => void;
  e.islands.switchCurrent.mockReturnValue(new Promise<void>((r) => (finish = r)));
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('하나섬으로'));
  await screen.unmount();
  await act(async () => finish());
  expect(e.reset).not.toHaveBeenCalled();
  expect(e.notify).not.toHaveBeenCalled();
  expect(err).not.toHaveBeenCalled();
  err.mockRestore();
});

test('마운트된 채 세션 세대가 바뀌면 항해·토스트 없이 요청 중 표시만 풀린다', async () => {
  const e = env('b');
  let finish!: () => void;
  e.islands.switchCurrent.mockReturnValueOnce(new Promise<void>((r) => (finish = r)));
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('하나섬으로'));
  mockGeneration += 1;
  await act(async () => finish());
  expect(screen.queryByTestId('sailing')).toBeNull();
  expect(e.notify).not.toHaveBeenCalled();
  expect(e.reset).not.toHaveBeenCalled();
  expect(e.backOverride.current).toBeNull();
  // 행이 다시 눌린다(pending 해제)
  await fireEvent.press(screen.getByText('하나섬으로'));
  expect(e.islands.switchCurrent).toHaveBeenCalledTimes(2);
});

test('세대 변경과 언마운트가 겹쳐도 reset 하지 않는다', async () => {
  const e = env('b');
  let finish!: () => void;
  e.islands.switchCurrent.mockReturnValue(new Promise<void>((r) => (finish = r)));
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  const screen = await render(<RaftDestinations e={e} />);
  await fireEvent.press(screen.getByText('하나섬으로'));
  mockGeneration += 1;
  await screen.unmount();
  await act(async () => finish());
  expect(e.reset).not.toHaveBeenCalled();
  expect(e.notify).not.toHaveBeenCalled();
  expect(err).not.toHaveBeenCalled();
  err.mockRestore();
});
