/**
 * GROMO-2372 — App 은 매초 다시 그리지 않는다.
 * ① 홈에서 5초가 흘러도 섬 지도(바다 IslandOcean 렌더 횟수로 센다)를 통째로 다시 그리지 않는다.
 * ② 앱 state 저장은 1초 모아 마지막 것만 쓰고, 배경으로 가면 기다리지 않고 바로 쓴다.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { AppState } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '@/App';
import { clearSession } from '@/services/api/session';
import { initialState } from '@/services/model';

jest.setTimeout(30_000);

const STORAGE = 'gromo-r61-user-v2';
let captured: any;
jest.mock('@/screens/island/CurrentScreens', () => ({
  CurrentScreens: (props: any) => {
    const actual = jest.requireActual('@/screens/island/CurrentScreens');
    captured = props.e;
    return <actual.CurrentScreens e={props.e} />;
  },
}));
let mockMapRenders = 0;
jest.mock('@/screens/island/IslandOcean', () => {
  const actual = jest.requireActual('@/screens/island/IslandOcean');
  return {
    ...actual,
    IslandOcean: (props: object) => {
      mockMapRenders++;
      return actual.IslandOcean(props);
    },
  };
});
jest.mock('@/services/api/auth', () => ({
  checkSession: async () => ({ status: 'offline' }),
  logout: async () => {},
}));
jest.mock('@/services/islandBoot', () => ({ decideBootRoute: async () => 'home' }));
jest.mock('@/services/api/session', () => {
  const actual = jest.requireActual('@/services/api/session');
  return { ...actual, restoreSession: async () => null };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: any) => children,
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const appStateListeners: ((state: string) => void)[] = [];
beforeEach(async () => {
  captured = undefined;
  mockMapRenders = 0;
  appStateListeners.length = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler: any) => {
    appStateListeners.push(handler);
    return {
      remove: () => {
        const index = appStateListeners.indexOf(handler);
        if (index >= 0) appStateListeners.splice(index, 1);
      },
    } as any;
  });
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  await clearSession();
  await AsyncStorage.setItem(STORAGE, JSON.stringify({ ...initialState(true), version: 1 }));
  // 분이 바뀌는 순간(App 이 한 번 다시 그린다)을 피해 분 초입에서 시작한다
  jest.useFakeTimers({ now: new Date('2026-10-21T10:00:01+09:00') });
});
afterEach(async () => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  await AsyncStorage.removeItem(STORAGE);
});

const mountHome = async () => {
  const screen = await render(<App />);
  await waitFor(() => assert.equal(captured?.route, 'home'));
  await waitFor(() => assert.ok(mockMapRenders > 0));
  // 부팅 직후의 저장·소리·카탈로그 같은 일회성 갱신을 흘려보낸다
  await act(async () => jest.advanceTimersByTime(2000));
  assert.ok(Date.now() % 60_000 < 50_000);
  return screen;
};

test('홈에서 5초가 흘러도 섬 지도를 다시 그리지 않는다', async () => {
  const screen = await mountHome();
  mockMapRenders = 0;
  for (let second = 0; second < 5; second++) await act(async () => jest.advanceTimersByTime(1000));
  // 고치기 전에는 App 의 1초 now 로 매초 지도 전체를 다시 그렸다(5초에 5번)
  expect(mockMapRenders).toBeLessThanOrEqual(1);
  await screen.unmount();
});

test('앱 state 는 1초 모아 쓰고, 배경으로 가면 바로 쓴다', async () => {
  const screen = await mountHome();
  const setItem = AsyncStorage.setItem as jest.Mock;
  const saved = () =>
    setItem.mock.calls.filter(([key]) => key === STORAGE).map(([, raw]) => JSON.parse(raw).name);

  setItem.mockClear();
  await act(async () => captured.dispatch({ type: 'PROFILE', name: '하나' }));
  await act(async () => captured.dispatch({ type: 'PROFILE', name: '둘' }));
  await act(async () => jest.advanceTimersByTime(999));
  expect(saved()).toEqual([]);
  await act(async () => jest.advanceTimersByTime(1));
  // 1초 안의 두 변경은 마지막 것 한 번만 쓴다
  expect(saved()).toEqual(['둘']);

  setItem.mockClear();
  await act(async () => captured.dispatch({ type: 'PROFILE', name: '셋' }));
  expect(saved()).toEqual([]);
  await act(async () => appStateListeners.forEach((listener) => listener('background')));
  expect(saved()).toEqual(['셋']);
  // 이미 쓴 것은 타이머가 끝나도 다시 쓰지 않는다
  await act(async () => jest.advanceTimersByTime(1000));
  expect(saved()).toEqual(['셋']);

  // 화면이 사라질 때도 남은 것을 바로 쓴다
  setItem.mockClear();
  await act(async () => captured.dispatch({ type: 'PROFILE', name: '넷' }));
  await screen.unmount();
  await act(async () => {});
  expect(saved()).toEqual(['넷']);
});
