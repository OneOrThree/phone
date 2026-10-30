import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type PostHog from 'posthog-react-native';
import { readAnalyticsDeviceProperties } from './analyticsDevice';

jest.mock('./analyticsDevice', () => ({ readAnalyticsDeviceProperties: jest.fn() }));

const mockClient = {
  capture: jest.fn(),
  identify: jest.fn(),
  reset: jest.fn(),
  ready: jest.fn(),
  getDistinctId: jest.fn(),
  getAnonymousId: jest.fn(),
  screen: jest.fn().mockResolvedValue(undefined),
};
const mockConstructor = jest.fn(() => mockClient);
jest.mock('posthog-react-native', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockConstructor(...(args as [])),
}));

const originalDev = __DEV__;
const originalOS = Platform.OS;
const originalEnv = { ...process.env };
const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
let analytics: typeof import('./posthog');

function loadAnalytics() {
  jest.isolateModules(() => {
    analytics = require('./posthog');
  });
  analytics.initPostHog();
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(readAnalyticsDeviceProperties).mockResolvedValue({});
  mockClient.ready.mockResolvedValue(undefined);
  mockClient.getDistinctId.mockReturnValue('anonymous-1');
  mockClient.getAnonymousId.mockReturnValue('anonymous-1');
  mockClient.identify.mockImplementation((userId: string) => {
    mockClient.getDistinctId.mockReturnValue(userId);
  });
  await AsyncStorage.clear();
  Object.assign(globalThis, { __DEV__: false });
  Platform.OS = 'ios';
  delete process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN;
  delete process.env.EXPO_PUBLIC_POSTHOG_HOST;
  delete process.env.EXPO_PUBLIC_POSTHOG_DEV_ENABLED;
  delete process.env.EXPO_PUBLIC_DEMO;
  // 기본 fixture = 운영 release 빌드(EXPO_PUBLIC_ENV 명시). gradle/fastlane 게이트가 release 에 env 를 강제한다.
  process.env.EXPO_PUBLIC_ENV = 'prod';
});

afterEach(() => {
  Object.assign(globalThis, { __DEV__: originalDev });
  Platform.OS = originalOS;
  process.env = { ...originalEnv };
  if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
  else Reflect.deleteProperty(window, 'location');
});

test('새 계정으로 기존 행동 이벤트와 사용자 식별을 같은 클라이언트에 보낸다', async () => {
  loadAnalytics();
  analytics.initPostHog();
  analytics.identifyPostHogUser('user-123');
  analytics.captureProductEvent('focus_completed', { duration: 60 });
  analytics.trackPostHogScreen('island');
  analytics.resetPostHogUser();
  await Promise.resolve();

  expect(mockConstructor).toHaveBeenCalledTimes(1);
  expect(mockConstructor).toHaveBeenCalledWith(
    'phc_wbezwMeaU3VKvPxdbdd6QD7GTBqD7rbmAzUgazz6epRc',
    expect.objectContaining({
      host: 'https://us.i.posthog.com',
      enableSessionReplay: false,
      sessionReplayConfig: expect.objectContaining({
        maskAllTextInputs: true,
        maskAllImages: true,
        captureLog: false,
        captureNetworkTelemetry: false,
      }),
    }),
  );
  expect(analytics.getPostHogClient()).toBe(mockClient);
  expect(mockClient.identify).toHaveBeenCalledWith('user-123');
  expect(mockClient.capture).toHaveBeenCalledWith('focus_completed', {
    duration: 60,
    analytics_environment: 'production',
  });
  expect(mockClient.screen).toHaveBeenCalledWith('island');
  expect(mockClient.reset).toHaveBeenCalled();
});

test('초기 무인증 snapshot은 설치 이벤트의 익명 ID와 세션을 유지한다', async () => {
  loadAnalytics();
  analytics.resetPostHogUser();
  await Promise.resolve();
  analytics.trackPostHogScreen('login');
  expect(mockClient.reset).not.toHaveBeenCalled();
  expect(mockClient.screen).toHaveBeenCalledWith('login');
});

test('이전 실행의 로그인 ID가 남아 있으면 SDK 저장소 복원 후 초기화한다', async () => {
  let ready: (() => void) | undefined;
  mockClient.ready.mockReturnValue(new Promise<void>((resolve) => (ready = resolve)));
  loadAnalytics();
  analytics.resetPostHogUser();
  mockClient.getDistinctId.mockReturnValue('previous-user');
  ready?.();
  await Promise.resolve();
  expect(mockClient.reset).toHaveBeenCalledTimes(1);
});

test('초기화 대기 중 로그인한 새 계정을 지우지 않는다', async () => {
  let ready: (() => void) | undefined;
  mockClient.ready.mockReturnValue(new Promise<void>((resolve) => (ready = resolve)));
  loadAnalytics();
  analytics.resetPostHogUser();
  analytics.identifyPostHogUser('new-user');
  ready?.();
  await Promise.resolve();
  expect(mockClient.reset).not.toHaveBeenCalled();
  expect(mockClient.getDistinctId()).toBe('new-user');
});

test.each(['dev', 'staging', 'test'])('%s 서버 빌드는 운영 대시보드에서 제외한다', (env) => {
  process.env.EXPO_PUBLIC_ENV = env;
  loadAnalytics();
  analytics.captureProductEvent('app_active');
  expect(mockClient.capture).toHaveBeenCalledWith('app_active', {
    analytics_environment: 'development',
  });
});

test('EXPO_PUBLIC_ENV 가 비어 있으면 운영으로 오분류하지 않고 개발로 본다', () => {
  // release 빌드가 환경을 안 박아도 안전쪽(development)으로 — 운영 지표 오염을 막는다.
  process.env.EXPO_PUBLIC_ENV = '';
  loadAnalytics();
  analytics.captureProductEvent('app_active');
  expect(mockClient.capture).toHaveBeenCalledWith('app_active', {
    analytics_environment: 'development',
  });
});

test.each(['빈 토큰', '개발 빌드', '목업'])(
  '%s에서는 클라이언트와 녹화를 시작하지 않는다',
  (mode) => {
    if (mode === '빈 토큰') process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN = '';
    if (mode === '개발 빌드') Object.assign(globalThis, { __DEV__: true });
    if (mode === '목업') process.env.EXPO_PUBLIC_DEMO = '1';
    loadAnalytics();
    analytics.captureProductEvent('focus_started');
    expect(analytics.getPostHogClient()).toBeNull();
    expect(mockConstructor).not.toHaveBeenCalled();
    expect(mockClient.capture).not.toHaveBeenCalled();
    expect(readAnalyticsDeviceProperties).not.toHaveBeenCalled();
  },
);

test('명시적으로 켠 개발 빌드는 수집하지만 웹 네이티브 녹화는 켜지 않는다', () => {
  Object.assign(globalThis, { __DEV__: true });
  process.env.EXPO_PUBLIC_POSTHOG_DEV_ENABLED = '1';
  Platform.OS = 'web';
  Object.defineProperty(window, 'location', { value: { search: '' }, configurable: true });
  loadAnalytics();
  expect(mockConstructor).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ enableSessionReplay: false }),
  );
});

test('이전 큐와 다른 프로젝트의 로컬 이벤트를 읽지 않는다', async () => {
  await AsyncStorage.setItem('posthog.json', 'old-project-events');
  process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN = 'project-a';
  loadAnalytics();
  const storageA = (mockConstructor.mock.calls[0] as unknown as [string, any])[1].customStorage;
  expect(await storageA.getItem('posthog.json')).toBeNull();
  await storageA.setItem('posthog.json', 'project-a-events');

  process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN = 'project-b';
  loadAnalytics();
  const storageB = (mockConstructor.mock.calls[1] as unknown as [string, any])[1].customStorage;
  expect(await storageB.getItem('posthog.json')).toBeNull();
  expect(await storageA.getItem('posthog.json')).toBe('project-a-events');
});

test.each(['ios', 'android', 'web'] as const)(
  '%s 오류 자동 수집과 네이티브 범위를 구분한다',
  (os) => {
    Platform.OS = os;
    if (os === 'web')
      Object.defineProperty(window, 'location', { value: { search: '' }, configurable: true });
    loadAnalytics();
    const options = (mockConstructor.mock.calls[0] as unknown as [string, any])[1];
    expect(options.errorTracking.autocapture).toEqual({
      uncaughtExceptions: true,
      unhandledRejections: true,
      console: false,
      nativeCrashes: os !== 'web',
      androidNdkCrashes: os === 'android',
    });
    const exception = { event: '$exception', properties: { $exception_level: 'fatal' } };
    expect(options.before_send(exception)).toEqual({
      event: '$exception',
      properties: { $exception_level: 'fatal', analytics_environment: 'production' },
    });
    expect(options.before_send(null)).toBeNull();
  },
);

test.each(['dev', 'staging'])('%s의 JS 오류는 개발 태그를 붙이고 네이티브 수집은 끈다', (env) => {
  process.env.EXPO_PUBLIC_ENV = env;
  Platform.OS = 'ios';
  loadAnalytics();
  const options = (mockConstructor.mock.calls[0] as unknown as [string, any])[1];
  expect(options.errorTracking.autocapture.nativeCrashes).toBe(false);
  expect(options.errorTracking.autocapture.androidNdkCrashes).toBe(false);
  // 호출자가 잘못 지정해도 자동 수집의 환경 분류는 빌드 설정을 따른다.
  expect(
    options.before_send({
      event: '$exception',
      properties: { analytics_environment: 'production' },
    }).properties.analytics_environment,
  ).toBe('development');
});

test.each(['dev', 'development', 'staging'])(
  'Android %s 빌드는 SDK와 리플레이를 시작하지 않는다',
  (env) => {
    process.env.EXPO_PUBLIC_ENV = env;
    Platform.OS = 'android';
    loadAnalytics();
    analytics.captureProductEvent('app_active');
    expect(mockConstructor).not.toHaveBeenCalled();
    expect(mockClient.capture).not.toHaveBeenCalled();
    expect(analytics.getPostHogClient()).toBeNull();
    expect(readAnalyticsDeviceProperties).not.toHaveBeenCalled();
  },
);

test('Android Debug는 개발 수집 플래그를 켜도 SDK를 시작하지 않는다', () => {
  Object.assign(globalThis, { __DEV__: true });
  process.env.EXPO_PUBLIC_POSTHOG_DEV_ENABLED = '1';
  Platform.OS = 'android';
  loadAnalytics();
  expect(mockConstructor).not.toHaveBeenCalled();
});

test('OS ID는 계정 전환·로그아웃 후에도 이벤트 속성에 유지하며 사용자 ID로 쓰지 않는다', async () => {
  const properties = { device_id: 'dd96dec43fb81c97', device_id_source: 'android_id' as const };
  jest.mocked(readAnalyticsDeviceProperties).mockResolvedValue(properties);
  Platform.OS = 'android';
  loadAnalytics();
  const options = (mockConstructor.mock.calls[0] as unknown as [string, any])[1];
  await options.customStorage.getItem('posthog.json');
  analytics.identifyPostHogUser('guest-user');
  analytics.identifyPostHogUser('member-user');
  analytics.resetPostHogUser();
  await Promise.resolve();
  expect(mockClient.identify.mock.calls).toEqual([['guest-user'], ['member-user']]);
  expect(options.before_send({ event: 'focus_started', properties: {} }).properties).toEqual({
    ...properties,
    analytics_environment: 'production',
  });
  expect(readAnalyticsDeviceProperties).toHaveBeenCalledTimes(1);
});

test('실제 SDK의 첫 설치·초기 캡처 이벤트부터 비동기 IDFV가 포함된다', async () => {
  let resolveId: ((value: { device_id: string; device_id_source: 'idfv' }) => void) | undefined;
  jest
    .mocked(readAnalyticsDeviceProperties)
    .mockReturnValue(new Promise((resolve) => (resolveId = resolve)));
  loadAnalytics();
  // 앱은 IDFV를 기다리지 않고 기존 클라이언트를 Provider에 넘길 수 있다.
  expect(analytics.getPostHogClient()).toBe(mockClient);
  const options = (mockConstructor.mock.calls[0] as unknown as [string, any])[1];
  const events: { event: string; properties: Record<string, unknown> }[] = [];
  const RealPostHog = jest.requireActual('posthog-react-native').PostHog as typeof PostHog;
  const realClient = new RealPostHog('test-device-id-project', {
    ...options,
    enableSessionReplay: false,
    errorTracking: { autocapture: false },
    disableRemoteConfig: true,
    flushInterval: 0,
    before_send: (event) => {
      events.push(options.before_send(event));
      // 테스트 이벤트는 외부로 보내지 않는다.
      return null;
    },
  });
  try {
    realClient.capture('early_start');
    resolveId?.({ device_id: '68753a44-4d6f-1226-9c60-0050e4c00067', device_id_source: 'idfv' });
    await realClient.ready();
    // lifecycle의 비동기 처리가 끝날 때까지 진행한다.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events.map((event) => event.event)).toContain('Application Installed');
    expect(events.map((event) => event.event)).toContain('early_start');
    for (const event of events)
      expect(event.properties).toMatchObject({
        device_id: '68753a44-4d6f-1226-9c60-0050e4c00067',
        device_id_source: 'idfv',
      });
  } finally {
    await realClient.shutdown();
  }
});
