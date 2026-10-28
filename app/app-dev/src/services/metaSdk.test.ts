import { AppState, Platform } from 'react-native';

const mockSettings = {
  setAutoLogAppEventsEnabled: jest.fn(),
  setAdvertiserIDCollectionEnabled: jest.fn(),
  setAdvertiserTrackingEnabled: jest.fn().mockResolvedValue(true),
  setAppID: jest.fn(),
  setClientToken: jest.fn(),
  setAppName: jest.fn(),
  initializeSDK: jest.fn(),
};
const mockGetPermission = jest.fn();
const mockRequestPermission = jest.fn();
jest.mock('react-native-fbsdk-next', () => ({ Settings: mockSettings }));
jest.mock('expo-tracking-transparency', () => ({
  getTrackingPermissionsAsync: () => mockGetPermission(),
  requestTrackingPermissionsAsync: () => mockRequestPermission(),
}));

const originalDev = __DEV__;
const originalOS = Platform.OS;
const originalState = AppState.currentState;
const originalEnv = { ...process.env };
let meta: typeof import('./metaSdk');

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(globalThis, { __DEV__: false });
  Platform.OS = 'ios';
  AppState.currentState = 'active';
  delete process.env.EXPO_PUBLIC_ENV;
  delete process.env.EXPO_PUBLIC_META_ENABLED;
  delete process.env.EXPO_PUBLIC_DEMO;
  mockGetPermission.mockResolvedValue({ status: 'undetermined' });
  mockRequestPermission.mockResolvedValue({ status: 'denied' });
  jest.isolateModules(() => {
    meta = require('./metaSdk');
  });
});

afterEach(() => {
  Object.assign(globalThis, { __DEV__: originalDev });
  Platform.OS = originalOS;
  AppState.currentState = originalState;
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

test.each(['개발', 'dev 서버', '목업', '웹', '수집 중지'])(
  '%s에서는 SDK 초기화와 ATT 요청을 하지 않는다',
  async (mode) => {
    if (mode === '개발') Object.assign(globalThis, { __DEV__: true });
    if (mode === 'dev 서버') process.env.EXPO_PUBLIC_ENV = 'dev';
    if (mode === '목업') process.env.EXPO_PUBLIC_DEMO = '1';
    if (mode === '웹') Platform.OS = 'web';
    if (mode === '수집 중지') process.env.EXPO_PUBLIC_META_ENABLED = '0';
    await meta.syncMetaTracking();
    expect(mockSettings.initializeSDK).not.toHaveBeenCalled();
    expect(mockRequestPermission).not.toHaveBeenCalled();
  },
);

test('ATT 거절 후에도 실행 이벤트는 켜되 광고 ID는 수집하지 않는다', async () => {
  await Promise.all([meta.syncMetaTracking(), meta.syncMetaTracking()]);
  expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  expect(mockSettings.initializeSDK).toHaveBeenCalledTimes(1);
  expect(mockSettings.setAdvertiserIDCollectionEnabled).toHaveBeenLastCalledWith(false);
  expect(mockSettings.setAdvertiserTrackingEnabled).toHaveBeenLastCalledWith(false);
  const enableCall = mockSettings.setAutoLogAppEventsEnabled.mock.calls.findIndex(([v]) => v);
  expect(mockSettings.setAutoLogAppEventsEnabled.mock.invocationCallOrder[enableCall]).toBeLessThan(
    mockSettings.initializeSDK.mock.invocationCallOrder[0],
  );
});

test('설정 앱에서 추적 허용을 변경하면 다시 초기화하지 않고 수집 상태를 맞춘다', async () => {
  mockGetPermission.mockResolvedValue({ status: 'denied' });
  await meta.syncMetaTracking();
  mockGetPermission.mockResolvedValue({ status: 'granted' });
  await meta.syncMetaTracking();
  expect(mockSettings.setAdvertiserTrackingEnabled).toHaveBeenLastCalledWith(true);
  expect(mockSettings.setAdvertiserIDCollectionEnabled).toHaveBeenLastCalledWith(true);
  expect(mockSettings.initializeSDK).toHaveBeenCalledTimes(1);
  expect(mockRequestPermission).not.toHaveBeenCalled();
});

test('백그라운드에서는 ATT 창을 띄우지 않고 전경 복귀 때 요청한다', async () => {
  AppState.currentState = 'background';
  await meta.syncMetaTracking();
  expect(mockRequestPermission).not.toHaveBeenCalled();
  AppState.currentState = 'active';
  await meta.syncMetaTracking();
  expect(mockRequestPermission).toHaveBeenCalledTimes(1);
});

test('Android는 ATT 없이 설치·실행 이벤트와 광고 ID 수집을 켠다', async () => {
  Platform.OS = 'android';
  await meta.syncMetaTracking();
  expect(mockSettings.initializeSDK).toHaveBeenCalledTimes(1);
  expect(mockSettings.setAdvertiserIDCollectionEnabled).toHaveBeenLastCalledWith(true);
  expect(mockGetPermission).not.toHaveBeenCalled();
  expect(mockRequestPermission).not.toHaveBeenCalled();
});

test('구독 해제 시 전경 복귀 감시를 제거한다', async () => {
  const remove = jest.fn();
  const subscribe = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove });
  const stop = meta.startMetaTracking();
  await meta.syncMetaTracking();
  expect(subscribe).toHaveBeenCalledWith('change', expect.any(Function));
  stop();
  expect(remove).toHaveBeenCalledTimes(1);
});
