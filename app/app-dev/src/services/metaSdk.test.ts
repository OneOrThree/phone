import { AppState, NativeModules, Platform } from 'react-native';

const mockSyncTracking = jest.fn();
const mockMetaContext = jest.fn();
const mockLogEvent = jest.fn();
const mockAndroidContext = jest.fn();
const mockAndroidLogEvent = jest.fn();
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
  mockAndroidLogEvent.mockReset().mockResolvedValue(true);
  mockAndroidModule = { metaContext: mockAndroidContext, logEvent: mockAndroidLogEvent };
  mockLogEvent.mockReset().mockResolvedValue(true);
  NativeModules.MetaAppEventsModule = {
    syncTracking: mockSyncTracking,
    metaContext: mockMetaContext,
    logEvent: mockLogEvent,
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
  jest.useRealTimers();
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
    mockMetaContext.mockResolvedValue(null);
    await expect(meta.metaContext()).resolves.toBeUndefined();
    NativeModules.MetaAppEventsModule = { syncTracking: mockSyncTracking };
    await expect(meta.metaContext()).resolves.toBeUndefined();
  });
});

// iOS·Android 모두 서버와 같은 이름·event_id 로 기록한다.
describe('logMetaEvent', () => {
  test('운영 iOS는 이름과 event_id 로 네이티브 기록을 부른다', async () => {
    process.env.EXPO_PUBLIC_ENV = 'prod';
    await expect(meta.logMetaEvent('first_island_arrival', 'evt-1')).resolves.toBe(true);
    expect(mockLogEvent).toHaveBeenCalledWith('first_island_arrival', 'evt-1');
  });

  test.each(['웹', '개발', 'dev 서버', '목업', '수집 중지'])(
    '%s에서는 부르지 않는다',
    async (mode) => {
      process.env.EXPO_PUBLIC_ENV = 'prod';
      if (mode === '목업') process.env.EXPO_PUBLIC_DEMO = '1';
      if (mode === '웹') Platform.OS = 'web';
      if (mode === '개발') Object.assign(globalThis, { __DEV__: true });
      if (mode === 'dev 서버') process.env.EXPO_PUBLIC_ENV = 'dev';
      if (mode === '수집 중지') process.env.EXPO_PUBLIC_META_ENABLED = '0';
      await expect(meta.logMetaEvent('first_island_arrival', 'evt-1')).resolves.toBe(false);
      expect(mockLogEvent).not.toHaveBeenCalled();
    },
  );

  test('SDK 시작 전(false)·브리지 없음·예외는 false', async () => {
    process.env.EXPO_PUBLIC_ENV = 'prod';
    mockLogEvent.mockResolvedValue(false);
    await expect(meta.logMetaEvent('first_island_arrival', 'evt-1')).resolves.toBe(false);
    mockLogEvent.mockRejectedValueOnce(new Error('boom'));
    await expect(meta.logMetaEvent('first_island_arrival', 'evt-1')).resolves.toBe(false);
    NativeModules.MetaAppEventsModule = { syncTracking: mockSyncTracking };
    await expect(meta.logMetaEvent('first_island_arrival', 'evt-1')).resolves.toBe(false);
  });
});

test('초기화 false는 1.5초마다 최대 3회 재시도하며 진행 중 요청을 공유한다', async () => {
  jest.useFakeTimers();
  mockSyncTracking.mockResolvedValue(false);
  const pending = meta.syncMetaTracking();
  await jest.advanceTimersByTimeAsync(1499);
  expect(mockSyncTracking).toHaveBeenCalledTimes(1);
  expect(meta.syncMetaTracking()).toBe(pending);
  await jest.advanceTimersByTimeAsync(1);
  expect(mockSyncTracking).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(3000);
  await pending;
  expect(mockSyncTracking).toHaveBeenCalledTimes(4);
  expect(jest.getTimerCount()).toBe(0);
});

test('초기화 재시도에서 성공하면 기다림을 끝낸다', async () => {
  jest.useFakeTimers();
  mockSyncTracking.mockResolvedValueOnce(false);
  const pending = meta.syncMetaTracking();
  await jest.advanceTimersByTimeAsync(1500);
  await pending;
  expect(mockSyncTracking).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

test('재시도 대기 중 백그라운드로 가면 멈추고 다음 전경 실행에서 다시 시작한다', async () => {
  jest.useFakeTimers();
  mockSyncTracking.mockResolvedValueOnce(false);
  const pending = meta.syncMetaTracking();
  await jest.advanceTimersByTimeAsync(500);
  AppState.currentState = 'background';
  await jest.advanceTimersByTimeAsync(1000);
  await pending;
  expect(mockSyncTracking).toHaveBeenCalledTimes(1);
  AppState.currentState = 'active';
  await meta.syncMetaTracking();
  expect(mockSyncTracking).toHaveBeenCalledTimes(2);
});

test('재시도 예외는 삼키고 추가 타이머를 만들지 않는다', async () => {
  jest.useFakeTimers();
  mockSyncTracking.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('boom'));
  const pending = meta.syncMetaTracking();
  await jest.advanceTimersByTimeAsync(1500);
  await expect(pending).resolves.toBeUndefined();
  expect(mockSyncTracking).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});

test.each([null, undefined, false])(
  '매칭 값이 %s이면 초기화를 기다린 뒤 한 번 다시 읽는다',
  async (value) => {
    jest.useFakeTimers();
    mockMetaContext.mockResolvedValueOnce(value);
    mockSyncTracking.mockResolvedValueOnce(false);
    const pending = meta.metaContext();
    await jest.advanceTimersByTimeAsync(1499);
    expect(mockMetaContext).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({
      anonId: 'anon-1',
      advertiserTrackingEnabled: false,
    });
    expect(mockMetaContext).toHaveBeenCalledTimes(2);
  },
);

test.each([null, undefined, false])(
  '이벤트 기록이 %s이면 초기화를 기다린 뒤 한 번 다시 기록한다',
  async (value) => {
    jest.useFakeTimers();
    mockLogEvent.mockResolvedValueOnce(value);
    mockSyncTracking.mockResolvedValueOnce(false);
    const pending = meta.logMetaEvent('first_island_arrival', 'evt-1');
    await jest.advanceTimersByTimeAsync(1499);
    expect(mockLogEvent).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe(true);
    expect(mockLogEvent.mock.calls).toEqual([
      ['first_island_arrival', 'evt-1'],
      ['first_island_arrival', 'evt-1'],
    ]);
  },
);

test('다시 미시작이어도 매칭 값과 이벤트를 계속 호출하지 않는다', async () => {
  mockMetaContext.mockResolvedValue(null);
  mockLogEvent.mockResolvedValue(false);
  await expect(meta.metaContext()).resolves.toBeUndefined();
  await expect(meta.logMetaEvent('first_island_arrival', 'evt-1')).resolves.toBe(false);
  expect(mockMetaContext).toHaveBeenCalledTimes(2);
  expect(mockLogEvent).toHaveBeenCalledTimes(2);
});

test('운영 Android는 Expo logEvent로 두 이름을 보내고 iOS 브리지는 부르지 않는다', async () => {
  Platform.OS = 'android';
  process.env.EXPO_PUBLIC_ENV = 'prod';
  for (const name of ['first_island_arrival', 'fb_mobile_complete_registration']) {
    await expect(meta.logMetaEvent(name, 'evt-1')).resolves.toBe(true);
    expect(mockAndroidLogEvent).toHaveBeenCalledWith(name, 'evt-1');
  }
  expect(mockLogEvent).not.toHaveBeenCalled();
  expect(mockSyncTracking).not.toHaveBeenCalled();
});

test('Android 미시작은 한 번 재호출하고 구 바이너리·예외는 false를 반환한다', async () => {
  Platform.OS = 'android';
  process.env.EXPO_PUBLIC_ENV = 'prod';
  mockAndroidLogEvent.mockResolvedValueOnce(false);
  await expect(meta.logMetaEvent('first_island_arrival', 'evt-1')).resolves.toBe(true);
  expect(mockAndroidLogEvent).toHaveBeenCalledTimes(2);
  mockAndroidLogEvent.mockRejectedValueOnce(new Error('boom'));
  await expect(meta.logMetaEvent('first_island_arrival', 'evt-1')).resolves.toBe(false);
  mockAndroidModule = { metaContext: mockAndroidContext };
  await expect(meta.logMetaEvent('first_island_arrival', 'evt-1')).resolves.toBe(false);
  mockAndroidModule = null;
  await expect(meta.logMetaEvent('first_island_arrival', 'evt-1')).resolves.toBe(false);
});

test.each(['', 'dev', 'staging'])(
  'Android 환경이 "%s"이면 이벤트를 기록하지 않는다',
  async (environment) => {
    Platform.OS = 'android';
    process.env.EXPO_PUBLIC_ENV = environment;
    await expect(meta.logMetaEvent('first_island_arrival', 'evt-1')).resolves.toBe(false);
    expect(mockAndroidLogEvent).not.toHaveBeenCalled();
  },
);
