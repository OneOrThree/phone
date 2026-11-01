/**
 * GROMO-2159 — OS 의 모션 줄이기는 저장하지 않고 실행 중에만 화면에 합친다.
 * ① 표식 없는 예전 저장본의 reduceMotion true 는 OS 가 꺼져 있어도 부팅 때 한 번 false 가 되고, 그 뒤 사용자가 켠 값은 지우지 않는다.
 * ② OS 켜짐·꺼짐 이벤트를 화면(e.state)과 MotionContext 가 따라가고, 합친 값은 저장본에 쓰이지 않는다.
 * 실제 App·리듀서·저장 경로를 돌리고, OS(AccessibilityInfo)와 화면(CurrentScreens — 넘겨받은 값만 가로챈다)만 바꾼다.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '@/App';
import { clearSession } from '@/services/api/session';
import { initialState } from '@/services/model';

jest.setTimeout(30_000);

const STORAGE = 'gromo-r61-user-v2';
let captured: any;
let contextMotion: boolean | undefined;
jest.mock('@/screens/island/CurrentScreens', () => ({
  CurrentScreens: ({ e }: any) => {
    const { useContext } = require('react');
    const { MotionContext } = require('@/design-system/primitives');
    captured = e;
    contextMotion = useContext(MotionContext);
    return null;
  },
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

// OS 쪽: 지금 값과, 앱이 걸어 둔 reduceMotionChanged 리스너
let osReduceMotion = false;
const osListeners: ((value: boolean) => void)[] = [];
const emitOs = async (value: boolean) => {
  osReduceMotion = value;
  await act(async () => osListeners.slice().forEach((listener) => listener(value)));
};

// 이 변경 전 앱이 저장하던 settings 모양(표식 없음). OS 가 켜졌던 기기는 reduceMotion 이 true 로 굳어 있다.
const legacySettings = (reduceMotion: boolean) => ({
  notifications: true,
  sound: true,
  volume: 0.55,
  reduceMotion,
  publicRecords: true,
  permission: true,
  haptics: true,
  screenTimeBoardPromptSeen: false,
  screenTimeMeasurementReady: true,
  screenTimeHistoryReady: true,
});
const seed = (settings: object) =>
  AsyncStorage.setItem(STORAGE, JSON.stringify({ ...initialState(true), settings }));
const stored = async () => JSON.parse((await AsyncStorage.getItem(STORAGE))!);
// 지금까지 STORAGE 에 쓴 저장본 전부의 reduceMotion
const writtenReduceMotion = () =>
  (AsyncStorage.setItem as jest.Mock).mock.calls
    .filter(([key]) => key === STORAGE)
    .map(([, raw]) => JSON.parse(raw).settings.reduceMotion);

beforeEach(async () => {
  captured = undefined;
  contextMotion = undefined;
  osReduceMotion = false;
  osListeners.length = 0;
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockImplementation(
    async () => osReduceMotion,
  );
  (AccessibilityInfo.addEventListener as jest.Mock).mockImplementation(
    (type: string, handler: (value: boolean) => void) => {
      if (type === 'reduceMotionChanged') osListeners.push(handler);
      return { remove: () => osListeners.splice(osListeners.indexOf(handler), 1) };
    },
  );
  await clearSession();
  await AsyncStorage.clear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
  jest.useFakeTimers({ now: new Date('2026-11-01T10:00:01+09:00') });
});
afterEach(() => {
  jest.useRealTimers();
});

const mount = async () => {
  const app = await render(<App />);
  await waitFor(() => assert.equal(captured?.route, 'home'));
  return app;
};
// 저장은 1초 모아 쓴다(SAVE_DELAY_MS)
const flushSave = () => act(async () => jest.advanceTimersByTime(1000));

test('표식 없는 저장본의 reduceMotion true 는 OS 가 꺼져 있어도 부팅 때 false 가 된다', async () => {
  await seed(legacySettings(true));
  const app = await mount();
  expect(captured.state.settings.reduceMotion).toBe(false);
  expect(contextMotion).toBe(false);
  await flushSave();
  expect((await stored()).settings.reduceMotion).toBe(false);
  await app.unmount();
});

test('초기화 뒤 사용자가 직접 켠 reduceMotion 은 다시 실행해도 유지된다', async () => {
  await seed(legacySettings(true));
  const first = await mount();
  expect(captured.state.settings.reduceMotion).toBe(false);
  await act(async () => captured.dispatch({ type: 'SETTING', key: 'reduceMotion', value: true }));
  expect(captured.state.settings.reduceMotion).toBe(true);
  await flushSave();
  await first.unmount();

  captured = undefined;
  const second = await mount();
  expect(captured.state.settings.reduceMotion).toBe(true);
  expect(contextMotion).toBe(true);
  await second.unmount();
});

test('OS 모션 줄이기가 켜져 있으면 화면과 MotionContext 에는 켜지지만 저장하지 않는다', async () => {
  osReduceMotion = true;
  await seed(initialState(true).settings);
  const app = await mount();
  await waitFor(() => assert.equal(captured.state.settings.reduceMotion, true));
  expect(contextMotion).toBe(true);

  // 다른 변경이 저장을 일으켜도 합친 값은 저장본에 들어가지 않는다
  await act(async () => captured.dispatch({ type: 'PROFILE', name: '하나' }));
  await flushSave();
  expect(await stored()).toMatchObject({ name: '하나', settings: { reduceMotion: false } });
  expect(writtenReduceMotion().length).toBeGreaterThan(0);
  expect(writtenReduceMotion().every((value: boolean) => value === false)).toBe(true);
  await app.unmount();
});

test('OS 켜짐·꺼짐 이벤트를 화면 값이 따라가고, 껐다 켜도 저장값이 true 로 굳지 않는다', async () => {
  await seed(initialState(true).settings);
  const app = await mount();
  const seen = () => [captured.state.settings.reduceMotion, contextMotion];
  expect(seen()).toEqual([false, false]);

  await emitOs(true);
  expect(seen()).toEqual([true, true]);
  await emitOs(false);
  expect(seen()).toEqual([false, false]);
  await emitOs(true);
  expect(seen()).toEqual([true, true]);
  await emitOs(false);
  expect(seen()).toEqual([false, false]);

  await act(async () => captured.dispatch({ type: 'PROFILE', name: '둘' }));
  await flushSave();
  expect((await stored()).settings.reduceMotion).toBe(false);
  expect(writtenReduceMotion().every((value: boolean) => value === false)).toBe(true);

  // 앱을 닫으면 리스너도 푼다
  expect(osListeners.length).toBeGreaterThan(0);
  await app.unmount();
  expect(osListeners).toHaveLength(0);
});

test('첫 OS 조회가 끝나기 전에 변경 이벤트가 오면 늦은 조회 결과가 이벤트 값을 덮지 않는다', async () => {
  let finishQuery: (value: boolean) => void = () => {};
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockImplementation(
    () => new Promise<boolean>((resolve) => (finishQuery = resolve)),
  );
  await seed(initialState(true).settings);
  const app = await mount();
  await emitOs(true);
  expect(contextMotion).toBe(true);
  await act(async () => finishQuery(false));
  expect(captured.state.settings.reduceMotion).toBe(true);
  expect(contextMotion).toBe(true);
  await app.unmount();
});

test('OS 가 켜져 있어도 설정 화면이 읽는 저장값은 사용자 값 그대로다', async () => {
  osReduceMotion = true;
  await seed(initialState(true).settings);
  const app = await mount();
  await waitFor(() => assert.equal(captured.state.settings.reduceMotion, true));
  expect(captured.savedSettings.reduceMotion).toBe(false);
  await act(async () => captured.dispatch({ type: 'SETTING', key: 'reduceMotion', value: true }));
  expect(captured.savedSettings.reduceMotion).toBe(true);
  await app.unmount();
});

test('사용자가 켠 값은 OS 가 꺼져도 그대로 켜져 있다 (OS || 사용자 설정)', async () => {
  osReduceMotion = true;
  await seed({ ...initialState(true).settings, reduceMotion: true });
  const app = await mount();
  expect(captured.state.settings.reduceMotion).toBe(true);
  await emitOs(false);
  expect(captured.state.settings.reduceMotion).toBe(true);
  expect(contextMotion).toBe(true);
  await emitOs(true);
  await act(async () => captured.dispatch({ type: 'SETTING', key: 'reduceMotion', value: false }));
  // 사용자가 끄면 OS 가 켜진 동안은 화면이 계속 줄이고, OS 가 꺼지면 풀린다
  expect(captured.state.settings.reduceMotion).toBe(true);
  await emitOs(false);
  expect(captured.state.settings.reduceMotion).toBe(false);
  await app.unmount();
});
