// 모닥불 주민(rest-members)과 내 고양이에 머리·목을 입힌다 (GROMO-2390)
import React from 'react';
import { render } from '@testing-library/react-native';
import { RestGroup } from '@/screens/focus/RestGroup';
import { initialState } from '@/services/model';

jest.mock('@/utils/layout', () => ({
  useAppLayout: () => ({
    width: 402,
    height: 874,
    insets: { top: 52, bottom: 32, left: 0, right: 0 },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 52, bottom: 32, left: 0, right: 0 }),
}));
// 입힌 옷과 자세만 드러내는 호스트 뷰로 바꾼다
jest.mock('@/components/CatOutfitLayers', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    ...jest.requireActual('@/components/CatOutfitLayers'),
    CatOutfitLayers: ({ outfit, pose }: { outfit: object; pose: object }) =>
      ReactActual.createElement(View, {
        testID: 'mock-outfit',
        testPropOutfit: outfit,
        testPropPose: pose,
      }),
  };
});

const rest = (userId: string, restSeat: number, appearance: unknown) => ({
  userId,
  name: userId,
  catColor: 'black',
  appearance,
  restStartedAt: new Date().toISOString(),
  restSeat,
});

test('식빵 주민은 still/loaf 자세로 서버 appearance 의 머리·목을 입는다', async () => {
  // restPose('a') 는 식빵
  const live = {
    status: 'ready',
    clockOffset: 0,
    rest: [rest('a', 1, { head: 'hat-1', neck: 'scarf-1', version: 2 })],
  } as any;
  const screen = await render(
    React.createElement(RestGroup, {
      state: initialState(true),
      live,
      home: jest.fn(),
      resume: jest.fn(),
    }),
  );
  const outfit = screen.getByTestId('mock-outfit');
  expect(outfit.props.testPropOutfit).toMatchObject({ head: 'hat-1', neck: 'scarf-1' });
  expect(outfit.props.testPropPose).toMatchObject({ color: 'black', still: 'loaf' });
  await screen.unmount();
});

test('실시간으로 받은 외양이 응답보다 version 이 크면 바로 갈아입는다', async () => {
  const live = {
    status: 'ready',
    clockOffset: 0,
    rest: [rest('a', 1, { head: 'old', version: 2 })],
    looks: { a: { head: 'new', neck: null, shoes: null, version: 3 } },
  } as any;
  const screen = await render(
    React.createElement(RestGroup, {
      state: initialState(true),
      live,
      home: jest.fn(),
      resume: jest.fn(),
    }),
  );
  expect(screen.getByTestId('mock-outfit').props.testPropOutfit.head).toBe('new');
  await screen.unmount();
});

test('책 읽기 주민은 read 첫 장에 맞춰 입고, 옷이 없으면 아무것도 겹치지 않는다', async () => {
  const live = {
    status: 'ready',
    clockOffset: 0,
    // restPose('b') 는 책 읽기
    rest: [rest('b', 1, { head: 'hat-1', version: 1 }), rest('a', 2, null)],
  } as any;
  const screen = await render(
    React.createElement(RestGroup, {
      state: initialState(true),
      live,
      home: jest.fn(),
      resume: jest.fn(),
    }),
  );
  // 응답 appearance 가 null 이면 입은 게 없다 — 호스트 뷰는 «옷이 있는 주민» 하나만
  const pose = screen.getAllByTestId('mock-outfit').map((n) => n.props.testPropPose);
  expect(pose).toHaveLength(1);
  expect(pose[0]).toMatchObject({ motion: 'read', frame: 0 });
  await screen.unmount();
});

test('내 고양이도 장착한 머리·목을 입는다', async () => {
  const state = initialState(true);
  state.equipped = { head: 'hat-me', neck: null } as any;
  state.session = {
    id: 's',
    islandId: state.islandId,
    subject: '',
    startedAt: 0,
    restStartedAt: 1,
    seconds: 1,
    status: 'paused',
    intervals: [],
  } as any;
  const screen = await render(
    React.createElement(RestGroup, { state, home: jest.fn(), resume: jest.fn() }),
  );
  expect(screen.getAllByTestId('mock-outfit')[0].props.testPropOutfit.head).toBe('hat-me');
  await screen.unmount();
});
