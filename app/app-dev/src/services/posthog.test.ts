import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const mockClient = {
  capture: jest.fn(),
  identify: jest.fn(),
  reset: jest.fn(),
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
  await AsyncStorage.clear();
  Object.assign(globalThis, { __DEV__: false });
  Platform.OS = 'ios';
  delete process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN;
  delete process.env.EXPO_PUBLIC_POSTHOG_HOST;
  delete process.env.EXPO_PUBLIC_POSTHOG_DEV_ENABLED;
  delete process.env.EXPO_PUBLIC_DEMO;
  delete process.env.EXPO_PUBLIC_ENV;
});

afterEach(() => {
  Object.assign(globalThis, { __DEV__: originalDev });
  Platform.OS = originalOS;
  process.env = { ...originalEnv };
  if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
  else Reflect.deleteProperty(window, 'location');
});

test('새 계정으로 기존 행동 이벤트와 사용자 식별을 같은 클라이언트에 보낸다', () => {
  loadAnalytics();
  analytics.initPostHog();
  analytics.identifyPostHogUser('user-123');
  analytics.captureProductEvent('focus_completed', { duration: 60 });
  analytics.trackPostHogScreen('island');
  analytics.resetPostHogUser();

  expect(mockConstructor).toHaveBeenCalledTimes(1);
  expect(mockConstructor).toHaveBeenCalledWith(
    'phc_wbezwMeaU3VKvPxdbdd6QD7GTBqD7rbmAzUgazz6epRc',
    expect.objectContaining({
      host: 'https://us.i.posthog.com',
      enableSessionReplay: true,
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

test.each(['dev', 'staging', 'test'])('%s 서버 빌드는 운영 대시보드에서 제외한다', (env) => {
  process.env.EXPO_PUBLIC_ENV = env;
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
  Platform.OS = 'android';
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
