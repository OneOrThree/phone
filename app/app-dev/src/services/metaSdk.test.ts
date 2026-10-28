import { AppState, NativeModules, Platform } from 'react-native';

const mockSyncTracking = jest.fn();
const originalDev = __DEV__;
const originalOS = Platform.OS;
const originalState = AppState.currentState;
const originalEnv = { ...process.env };
const originalModule = NativeModules.MetaAppEventsModule;
let meta: typeof import('./metaSdk');

beforeEach(() => {
  Object.assign(globalThis, { __DEV__: false });
  Platform.OS = 'ios';
  AppState.currentState = 'active';
  delete process.env.EXPO_PUBLIC_ENV;
  delete process.env.EXPO_PUBLIC_META_ENABLED;
  delete process.env.EXPO_PUBLIC_DEMO;
  mockSyncTracking.mockReset().mockResolvedValue(true);
  NativeModules.MetaAppEventsModule = { syncTracking: mockSyncTracking };
  jest.isolateModules(() => {
    meta = require('./metaSdk');
  });
});

afterEach(() => {
  Object.assign(globalThis, { __DEV__: originalDev });
  Platform.OS = originalOS;
  AppState.currentState = originalState;
  NativeModules.MetaAppEventsModule = originalModule;
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

test.each(['개발', 'dev 서버', 'staging', '목업', '웹', 'Android', '수집 중지'])(
  '%s에서는 iOS Meta 브리지를 호출하지 않는다',
  async (mode) => {
    if (mode === '개발') Object.assign(globalThis, { __DEV__: true });
    if (mode === 'dev 서버') process.env.EXPO_PUBLIC_ENV = 'dev';
    if (mode === 'staging') process.env.EXPO_PUBLIC_ENV = 'staging';
    if (mode === '목업') process.env.EXPO_PUBLIC_DEMO = '1';
    if (mode === '웹') Platform.OS = 'web';
    if (mode === 'Android') Platform.OS = 'android';
    if (mode === '수집 중지') process.env.EXPO_PUBLIC_META_ENABLED = '0';
    await meta.syncMetaTracking();
    expect(mockSyncTracking).not.toHaveBeenCalled();
  },
);

test('운영 iOS 전경 실행에서 ATT 처리와 계측 시작을 요청한다', async () => {
  process.env.EXPO_PUBLIC_ENV = 'prod';
  await meta.syncMetaTracking();
  expect(mockSyncTracking).toHaveBeenCalledWith(true);
});

test('권한 창을 기다리는 중 중복 호출은 같은 요청을 공유한다', async () => {
  let finish!: (value: boolean) => void;
  mockSyncTracking.mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)));
  const first = meta.syncMetaTracking();
  const second = meta.syncMetaTracking();
  expect(second).toBe(first);
  expect(mockSyncTracking).toHaveBeenCalledTimes(1);
  finish(true);
  await first;
  await meta.syncMetaTracking();
  expect(mockSyncTracking).toHaveBeenCalledTimes(2);
});

test('백그라운드에서는 권한 창을 요청하지 않고 전경 복귀 때 요청한다', async () => {
  AppState.currentState = 'background';
  await meta.syncMetaTracking();
  expect(mockSyncTracking).not.toHaveBeenCalled();
  AppState.currentState = 'active';
  await meta.syncMetaTracking();
  expect(mockSyncTracking).toHaveBeenCalledTimes(1);
});

test('브리지 실패는 부팅을 막지 않고 다음 전경 실행에서 재시도한다', async () => {
  mockSyncTracking.mockRejectedValueOnce(new Error('unavailable'));
  await expect(meta.syncMetaTracking()).resolves.toBeUndefined();
  await meta.syncMetaTracking();
  expect(mockSyncTracking).toHaveBeenCalledTimes(2);
});

test('브리지가 없는 기존 바이너리에서도 앱 부팅을 막지 않는다', async () => {
  delete NativeModules.MetaAppEventsModule;
  await expect(meta.syncMetaTracking()).resolves.toBeUndefined();
});

test('전경 복귀를 감시하고 구독 해제 때 감시를 제거한다', async () => {
  const remove = jest.fn();
  const subscribe = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove });
  const stop = meta.startMetaTracking();
  await meta.syncMetaTracking();
  const onChange = subscribe.mock.calls[0][1];
  onChange('background');
  expect(mockSyncTracking).toHaveBeenCalledTimes(1);
  onChange('active');
  await meta.syncMetaTracking();
  expect(mockSyncTracking).toHaveBeenCalledTimes(2);
  stop();
  expect(remove).toHaveBeenCalledTimes(1);
});
