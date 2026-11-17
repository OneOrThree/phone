import { AppState, Dimensions, type AppStateStatus } from 'react-native';
import { readAnalyticsDeviceProperties } from './analyticsDevice';

jest.mock('./analyticsDevice', () => ({ readAnalyticsDeviceProperties: jest.fn() }));
let mockDemo = false;
jest.mock('./demoMode', () => ({ isMockMode: () => mockDemo }));
const mockSdk = {
  init: jest.fn(),
  setTag: jest.fn(),
  setContext: jest.fn(),
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
  wrap: jest.fn((component) => component),
};
jest.mock('@sentry/react-native', () => mockSdk);
const originalDev = __DEV__;
const originalEnv = { ...process.env };
let sentry: typeof import('./sentry');
let appStateListener: (state: AppStateStatus) => void;
let windowListener: () => void;

beforeEach(() => {
  jest.resetAllMocks();
  mockDemo = false;
  Object.assign(globalThis, { __DEV__: false });
  process.env.EXPO_PUBLIC_ENV = 'prod';
  delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  delete process.env.EXPO_PUBLIC_DEMO;
  delete process.env.EXPO_PUBLIC_SENTRY_DEV_ENABLED;
  jest
    .mocked(readAnalyticsDeviceProperties)
    .mockResolvedValue({ device_id: 'shared-idfv', device_id_source: 'idfv' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  });
  jest.spyOn(Dimensions, 'addEventListener').mockImplementation((_event, listener) => {
    windowListener = () =>
      listener({ window: Dimensions.get('window'), screen: Dimensions.get('screen') });
    return { remove: jest.fn() } as unknown as ReturnType<typeof Dimensions.addEventListener>;
  });
  jest.isolateModules(() => {
    sentry = require('./sentry');
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  process.env = { ...originalEnv };
  Object.assign(globalThis, { __DEV__: originalDev });
});

test('네이티브 수집을 켜고 PostHog와 같은 기기 식별자를 scope에 연결한다', async () => {
  sentry.initSentry();
  await Promise.resolve();
  expect(mockSdk.init).toHaveBeenCalledWith(
    expect.objectContaining({
      environment: 'production',
      enableNative: true,
      enableNativeCrashHandling: true,
      enableNdk: true,
    }),
  );
  expect(mockSdk.setContext).toHaveBeenCalledWith('analytics_device', {
    device_id: 'shared-idfv',
    device_id_source: 'idfv',
  });
  expect(mockSdk.setTag).toHaveBeenCalledWith('analytics.device_id', 'shared-idfv');
  sentry.initSentry();
  expect(mockSdk.init).toHaveBeenCalledTimes(1);
  expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
});

test('화면·생명주기·창 크기와 마지막 카메라 상태가 오류에 남는다', () => {
  sentry.initSentry();
  sentry.recordSentryScreen('focus');
  appStateListener('background');
  windowListener();
  sentry.recordSentryCameraState({
    mounted: true,
    measurement_enabled: true,
    camera_position: 'front',
  });
  sentry.recordSentryCameraState({ preview_visible: true });
  const error = new Error('camera initialization failed');
  sentry.captureCameraError(error, 'capture', { phase: 'focusing' });
  expect(mockSdk.setTag).toHaveBeenCalledWith('app.screen', 'focus');
  expect(mockSdk.setTag).toHaveBeenCalledWith('app.state', 'background');
  expect(mockSdk.setContext).toHaveBeenCalledWith(
    'app_window',
    expect.objectContaining({ orientation: expect.any(String) }),
  );
  expect(mockSdk.captureException).toHaveBeenCalledWith(error, {
    tags: { component: 'focus_camera', camera_stage: 'capture' },
    contexts: {
      camera_failure: {
        mounted: true,
        measurement_enabled: true,
        camera_position: 'front',
        preview_visible: true,
        phase: 'focusing',
        stage: 'capture',
      },
    },
  });
  const count = mockSdk.addBreadcrumb.mock.calls.length;
  sentry.recordSentryCameraState({ preview_visible: true });
  expect(mockSdk.addBreadcrumb).toHaveBeenCalledTimes(count);
});

test.each(['dev', 'demo', 'empty-dsn'])(
  '%s에서는 예외·상태·기기 식별자를 수집하지 않는다',
  (mode) => {
    if (mode === 'dev') Object.assign(globalThis, { __DEV__: true });
    if (mode === 'demo') mockDemo = true;
    if (mode === 'empty-dsn') {
      process.env.EXPO_PUBLIC_SENTRY_DSN = '';
      jest.isolateModules(() => {
        sentry = require('./sentry');
      });
    }
    sentry.initSentry();
    sentry.recordSentryScreen('focus');
    sentry.recordSentryCameraState({ mounted: true });
    sentry.captureCameraError(new Error('ignored'), 'capture');
    expect(mockSdk.init).not.toHaveBeenCalled();
    expect(mockSdk.captureException).not.toHaveBeenCalled();
    expect(readAnalyticsDeviceProperties).not.toHaveBeenCalled();
  },
);

test('수집기가 실패해도 시작·카메라 복구는 실패하지 않는다', () => {
  sentry.initSentry();
  mockSdk.captureException.mockImplementation(() => {
    throw new Error('telemetry unavailable');
  });
  mockSdk.setContext.mockImplementation(() => {
    throw new Error('native unavailable');
  });
  expect(() => sentry.recordSentryCameraState({ mounted: true })).not.toThrow();
  expect(() => sentry.captureCameraError('frame failed', 'inference')).not.toThrow();
});
