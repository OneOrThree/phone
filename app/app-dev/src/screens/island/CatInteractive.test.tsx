import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initialState } from '@/services/model';
import { FinalIsland } from './WorldMap';
import { IslandHome } from './IslandHome';

jest.mock('@/components/CatSprite', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CatSprite: ({ testID, motion, left }: { testID?: string; motion: string; left?: boolean }) =>
      React.createElement(View, {
        testID: testID ?? 'mock-cat-sprite',
        testPropMotion: motion,
        testPropLeft: left,
      }),
    catFrameBox: () => ({ extent: 140, x: 70, y: 70 }),
  };
});

describe('고양이 터치 인터랙션, 좌우 방향 및 다중 모션 검증', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const renderWithContext = (ui: React.ReactElement) =>
    render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        {ui}
      </SafeAreaProvider>,
    );

  it('FinalIsland에서 왼쪽 터치 시 왼쪽을 보며 갸웃(tilt), 오른쪽 터치 시 오른쪽을 보며 기지개(stretch)를 켠다', async () => {
    const state = initialState(true);
    const screen = await renderWithContext(
      React.createElement(FinalIsland, {
        state,
        go: jest.fn(),
        build: jest.fn(),
      }),
    );

    const catActor = screen.getByTestId('home-cat-actor');
    const getCat = () => screen.getByTestId('home-cat-sprite').props;

    expect(getCat().testPropMotion).toBe('idle');

    // 1. 왼쪽 터치 (locationX: 10 < 35)
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 10 } });
    });
    expect(getCat().testPropLeft).toBe(true);
    expect(getCat().testPropMotion).toBe('tilt');

    // 타이머 만료 후 idle 복귀 및 탭 카운트 리셋
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(getCat().testPropMotion).toBe('idle');

    // 2. 오른쪽 터치 (locationX: 50 >= 35)
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 50 } });
    });
    expect(getCat().testPropLeft).toBe(false);
    expect(getCat().testPropMotion).toBe('stretch');

    await screen.unmount();
  });

  it('연속 터치 시 다양한 모션(그루밍, 기지개, 하품 등)이 순환 발동된다', async () => {
    const state = initialState(true);
    const screen = await renderWithContext(
      React.createElement(FinalIsland, {
        state,
        go: jest.fn(),
        build: jest.fn(),
      }),
    );

    const catActor = screen.getByTestId('home-cat-actor');
    const getMotion = () => screen.getByTestId('home-cat-sprite').props.testPropMotion;

    // 1회 탭: tilt
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 10 } });
    });
    expect(getMotion()).toBe('tilt');

    // 2회 연속 탭: groom
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 10 } });
    });
    expect(getMotion()).toBe('groom');

    // 3회 연속 탭: stretch
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 10 } });
    });
    expect(getMotion()).toBe('stretch');

    // 4회 연속 탭: yawn
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 10 } });
    });
    expect(getMotion()).toBe('yawn');

    await screen.unmount();
  });

  it('IslandHome에서도 좌우 터치 및 모션이 올바르게 전환된다', async () => {
    const state = initialState(true);
    const screen = await renderWithContext(
      React.createElement(IslandHome, {
        state,
        go: jest.fn(),
        build: jest.fn(),
      }),
    );

    const catActor = screen.getByTestId('island-cat-actor');
    const getCat = () => screen.getByTestId('island-cat-sprite').props;

    expect(getCat().testPropMotion).toBe('idle');

    // 왼쪽 터치
    await act(async () => {
      fireEvent(catActor, 'press', { nativeEvent: { locationX: 20 } });
    });
    expect(getCat().testPropLeft).toBe(true);
    expect(getCat().testPropMotion).toBe('tilt');

    // 2400ms 경과 후 idle로 복귀
    await act(async () => {
      jest.advanceTimersByTime(2400);
    });
    expect(getCat().testPropMotion).toBe('idle');

    await screen.unmount();
  });
});
