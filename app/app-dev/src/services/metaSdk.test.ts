import { AppState, NativeModules, Platform } from 'react-native';

const mockSyncTracking = jest.fn();
const mockMetaContext = jest.fn();
const mockAndroidContext = jest.fn();
let mockAndroidModule: unknown;
jest.mock('expo', () => ({ requireOptionalNativeModule: () => mockAndroidModule }));
jest.mock('expo-application', () => ({
  applicationId: 'com.oneorthree.focuscat',
  nativeApplicationVersion: '2.3.8',
  nativeBuildVersion: '778',
}));
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
  mockMetaContext
    .mockReset()
    .mockResolvedValue({ anonId: 'anon-1', advertiserTrackingEnabled: false });
  mockAndroidContext
    .mockReset()
    .mockResolvedValue({ anonId: 'anon-2', advertiserTrackingEnabled: true });
  mockAndroidModule = { metaContext: mockAndroidContext };
  NativeModules.MetaAppEventsModule = {
    syncTracking: mockSyncTracking,
    metaContext: mockMetaContext,
  };
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

describe('metaContext', () => {
  const native = { anonId: 'anon-1', advertiserTrackingEnabled: false };
  test('운영 iOS는 네이티브 값과 16칸 extinfo를 돌려준다', async () => {
    process.env.EXPO_PUBLIC_ENV = 'prod';
    const context = await meta.metaContext();
    expect(context).toMatchObject(native);
    expect(context?.extinfo).toHaveLength(16);
    expect(context?.extinfo[0]).toBe('i2');
    // Meta 예시 순서: [2] 빌드 번호, [3] 표시 버전
    expect(context?.extinfo.slice(1, 4)).toEqual(['com.oneorthree.focuscat', '778', '2.3.8']);
    expect(context?.extinfo[4]).not.toBe('');
  });

  test('운영 Android는 Expo 모듈의 익명 ID와 추적 허용 값을 쓴다', async () => {
    Platform.OS = 'android';
    process.env.EXPO_PUBLIC_ENV = 'prod';
    const context = await meta.metaContext();
    expect(context).toMatchObject({ anonId: 'anon-2', advertiserTrackingEnabled: true });
    expect(context?.extinfo[0]).toBe('a2');
    expect(context?.extinfo[4]).not.toBe('');
    expect(mockMetaContext).not.toHaveBeenCalled();
  });

  // GROMO-2743: 광고 추적을 제한한 기기를 허용으로 보내지 않는다.
  test.each([
    ['추적 제한 기기', false],
    ['값 없음', undefined],
  ])('운영 Android의 %s은 추적 허용 false', async (_, value) => {
    Platform.OS = 'android';
    process.env.EXPO_PUBLIC_ENV = 'prod';
    mockAndroidContext.mockResolvedValueOnce({
      anonId: 'anon-2',
      advertiserTrackingEnabled: value,
    });
    await expect(meta.metaContext()).resolves.toMatchObject({
      anonId: 'anon-2',
      advertiserTrackingEnabled: false,
    });
  });

  test.each(['', 'dev'])('Android는 환경이 "%s"이면 undefined', async (env) => {
    Platform.OS = 'android';
    if (env) process.env.EXPO_PUBLIC_ENV = env;
    await expect(meta.metaContext()).resolves.toBeUndefined();
    expect(mockAndroidContext).not.toHaveBeenCalled();
  });

  test.each(['개발', '목업', '수집 중지'])('%s에서는 undefined', async (mode) => {
    process.env.EXPO_PUBLIC_ENV = 'prod';
    if (mode === '개발') Object.assign(globalThis, { __DEV__: true });
    if (mode === '목업') process.env.EXPO_PUBLIC_DEMO = '1';
    if (mode === '수집 중지') process.env.EXPO_PUBLIC_META_ENABLED = '0';
    await expect(meta.metaContext()).resolves.toBeUndefined();
    expect(mockMetaContext).not.toHaveBeenCalled();
  });

  test('브리지가 없거나 던지거나 null이면 undefined', async () => {
    process.env.EXPO_PUBLIC_ENV = 'prod';
    mockMetaContext.mockRejectedValueOnce(new Error('boom'));
    await expect(meta.metaContext()).resolves.toBeUndefined();
    mockMetaContext.mockResolvedValueOnce(null);
    await expect(meta.metaContext()).resolves.toBeUndefined();
    NativeModules.MetaAppEventsModule = { syncTracking: mockSyncTracking };
    await expect(meta.metaContext()).resolves.toBeUndefined();
  });
});
