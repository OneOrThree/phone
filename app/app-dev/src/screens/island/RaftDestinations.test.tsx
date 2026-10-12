import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { RaftDestinations } from '@/screens/island/RaftDestinations';
import { initialState, reducer } from '@/services/model';
import { ApiError } from '@/services/api/client';

jest.mock('@/screens/island/IslandSheet', () => ({
  IslandSheet: ({ children }: any) => {
    const { View } = require('react-native');
    return <View>{children}</View>;
  },
  SheetRow: ({ title, onPress }: any) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable accessibilityRole="button" onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    );
  },
}));
jest.mock('@/screens/world/WorldViews', () => ({
  Sailing: ({ destination, onArrive }: any) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable testID="sailing" onPress={onArrive}>
        <Text>{destination}</Text>
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
  expect(e.notify).toHaveBeenCalledWith('아직 가 본 적 없는 섬이에요.');
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
