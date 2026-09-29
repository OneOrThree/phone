import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { currentIsland, initialState } from '@/services/model';
import { nodes } from '@/utils/island-path';
import { IslandHome, islandPositions } from './IslandHome';
import type { Route } from '@/services/model';

// walkPath 가 이미 도착했거나(부두 위) 닿을 수 없어 점 하나짜리 경로를 돌려주는 상황을 만든다.
let mockShortPath = false;
jest.mock('@/utils/island-path', () => {
  const actual = jest.requireActual('@/utils/island-path');
  return {
    ...actual,
    walkPath: (from: any, to: any, bs?: readonly string[]) =>
      mockShortPath ? [actual.nearestPoint(from, bs)] : actual.walkPath(from, to, bs),
  };
});

// 고양이가 이미 부두(dock)에 서 있으면(예: 집중을 마치고 돌아온 직후) walkPath 가 걸을 경로를
// 만들지 않는다. 그래도 목적 화면(배·집중 설정·옷장)은 열려야 한다.
describe('고양이가 부두에 있을 때 부두 경유 화면 진입', () => {
  const renderHome = (go: jest.Mock, request?: Route | null) => {
    const state = initialState(true);
    islandPositions[currentIsland(state).id] = { ...nodes.dock };
    return render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <IslandHome state={state} go={go} build={jest.fn()} request={request} />
      </SafeAreaProvider>,
    );
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockShortPath = true;
  });
  afterEach(() => {
    jest.useRealTimers();
    mockShortPath = false;
  });

  it('「내 배」를 누르면 boat 화면이 열린다', async () => {
    const go = jest.fn();
    const screen = await renderHome(go);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('내 배'));
    });
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(go).toHaveBeenCalledWith('boat');
    await screen.unmount();
  });

  it.each(['focusSetup', 'wardrobe'] as Route[])('%s 진입 요청도 화면을 연다', async (route) => {
    const go = jest.fn();
    const screen = await renderHome(go, route);
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(go).toHaveBeenCalledWith(route);
    await screen.unmount();
  });

  it('경로가 있으면 걸어간 뒤 화면을 여는 기존 동작은 그대로다', async () => {
    mockShortPath = false;
    const go = jest.fn();
    const screen = await renderHome(go);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('내 배'));
    });
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(go).toHaveBeenCalledWith('boat');
    await screen.unmount();
  });
});
