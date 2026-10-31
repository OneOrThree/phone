/**
 * GROMO-2669 — 실제 App 경로에서 하루 스크린타임 스냅샷이 확정되면 screen_time_daily 를 발행한다.
 * 스냅샷 dispatch 당 정확히 1회(측정 분이 있을 때만), null 측정은 발행하지 않는다.
 */
import assert from 'node:assert/strict';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import App from '@/App';
import { clearSession, saveSession } from '@/services/api/session';
import { syncIOSScreenTime } from '@/services/iosScreenTimeSync';
import { syncAndroidMeasurement } from '@/services/androidScreenTime';

jest.setTimeout(30_000);

const mockCapture = jest.fn();
jest.mock('@/services/posthog', () => ({
  captureProductEvent: (...a: unknown[]) => mockCapture(...a),
  getPostHogClient: () => null,
  initPostHog: () => {},
  trackPostHogScreen: () => {},
  identifyPostHogUser: () => {},
  resetPostHogUser: () => {},
}));

let captured: any;
jest.mock('@/screens/island/CurrentScreens', () => ({
  CurrentScreens: ({ e }: any) => {
    captured = e;
    return null;
  },
}));
jest.mock('@/services/iosScreenTimeSync', () => ({ syncIOSScreenTime: jest.fn() }));
jest.mock('@/services/androidScreenTime', () => ({
  ...jest.requireActual('@/services/androidScreenTime'),
  syncAndroidMeasurement: jest.fn(),
}));
jest.mock('@/services/screenTimeReporting', () => ({
  ...jest.requireActual('@/services/screenTimeReporting'),
  reportScreenTime: jest.fn(async () => undefined),
  subscribeScreenTimeReporting: jest.fn(() => () => {}),
}));
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

const iosSync = syncIOSScreenTime as jest.Mock;
const androidSync = syncAndroidMeasurement as jest.Mock;
const iosSnapshot = (minutes: number | null) => ({
  authorization: 'approved',
  timeline: null,
  snapshot: { approved: true, date: '2026-10-21', minutes, history: [], unconfirmedDays: [] },
});
const androidSnapshot = (minutes: number | null) => ({
  approved: true,
  date: '2026-10-21',
  minutes,
  history: [],
  unconfirmedDays: [],
  owner: 'u1',
  observations: [],
  reportFailed: false,
});
const dailyCalls = () => mockCapture.mock.calls.filter(([event]) => event === 'screen_time_daily');

const appStateListeners: ((state: string) => void)[] = [];
beforeEach(async () => {
  captured = undefined;
  appStateListeners.length = 0;
  mockCapture.mockClear();
  iosSync.mockReset();
  androidSync.mockReset();
  (AppState as any).currentState = 'active';
  // 화면 전환 리스너는 실제 remove 처럼 목록에서 빠져야 부팅 재실행의 옛 리스너가 남지 않는다
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: any) => {
    appStateListeners.push(handler);
    return {
      remove: () => {
        const i = appStateListeners.indexOf(handler);
        if (i >= 0) appStateListeners.splice(i, 1);
      },
    } as any;
  }) as never);
  await AsyncStorage.clear();
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});
afterEach(async () => {
  jest.restoreAllMocks();
  await clearSession();
  Platform.OS = 'ios';
});

test('iOS 측정값이 확정되면 스냅샷 dispatch 당 screen_time_daily 를 1회 발행한다(2회면 2회)', async () => {
  iosSync.mockResolvedValue(iosSnapshot(42));
  const screen = await render(<App />);
  await waitFor(() => assert.ok(captured));
  await waitFor(() => expect(dailyCalls().length).toBeGreaterThan(0));
  expect(dailyCalls().every(([, props]) => (props as any).minutes === 42)).toBe(true);

  // 부팅 스냅샷이 모두 반영된 뒤 기준점을 잡고, AppState active 로 스냅샷을 한 번씩 더 유도한다
  await act(async () => {});
  const base = dailyCalls().length;
  await act(async () => appStateListeners.forEach((l) => l('active')));
  await waitFor(() => expect(dailyCalls().length).toBe(base + 1));
  await act(async () => appStateListeners.forEach((l) => l('active')));
  await waitFor(() => expect(dailyCalls().length).toBe(base + 2));

  await screen.unmount();
});

test('iOS 측정값이 null 이면 screen_time_daily 를 발행하지 않는다', async () => {
  iosSync.mockResolvedValue(iosSnapshot(null));
  const screen = await render(<App />);
  await waitFor(() => assert.ok(captured));
  await waitFor(() => expect(iosSync).toHaveBeenCalled());
  await act(async () => {});
  expect(dailyCalls()).toEqual([]);
  await screen.unmount();
});

test('Android 측정값이 확정되면 screen_time_daily 를 스냅샷 당 1회 발행한다', async () => {
  Platform.OS = 'android';
  androidSync.mockResolvedValue(androidSnapshot(31));
  const screen = await render(<App />);
  await waitFor(() => assert.ok(captured));
  await waitFor(() => expect(dailyCalls().length).toBeGreaterThan(0));
  expect(dailyCalls().every(([, props]) => (props as any).minutes === 31)).toBe(true);

  await act(async () => {});
  const base = dailyCalls().length;
  await act(async () => appStateListeners.forEach((l) => l('active')));
  await waitFor(() => expect(dailyCalls().length).toBe(base + 1));

  await screen.unmount();
});
