const mockAirbridge = {
  setOnDeeplinkReceived: jest.fn(),
  startTracking: jest.fn(),
  setUserID: jest.fn(),
  clearUser: jest.fn(),
  trackEvent: jest.fn(),
};

jest.mock('airbridge-react-native-sdk', () => ({ Airbridge: mockAirbridge }));

beforeEach(() => {
  jest.resetModules();
  Object.values(mockAirbridge).forEach((fn) => fn.mockReset());
  process.env.EXPO_PUBLIC_AIRBRIDGE_DEV_ENABLED = '1';
  delete process.env.EXPO_PUBLIC_DEMO;
  const { NativeModules, Platform } = require('react-native');
  Platform.OS = 'android';
  NativeModules.EventInteractor = {};
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_AIRBRIDGE_DEV_ENABLED;
  delete process.env.EXPO_PUBLIC_DEMO;
});

test.each(['android', 'ios'])(
  '%s에서 PostHog 없이 성공 이벤트와 사용자 변경을 전달한다',
  (platform) => {
    require('react-native').Platform.OS = platform;
    const { initAirbridge } = require('./airbridge');
    const { captureProductEvent, identifyPostHogUser, resetPostHogUser } = require('./posthog');
    initAirbridge();
    initAirbridge();
    identifyPostHogUser('user-1');
    captureProductEvent('social_login_completed', { provider: 'google' });
    captureProductEvent('focus_completed', { duration_seconds: 1200, earned_fish: 3 });
    resetPostHogUser();

    expect(mockAirbridge.startTracking).toHaveBeenCalledTimes(1);
    expect(mockAirbridge.setUserID).toHaveBeenCalledWith('user-1');
    expect(mockAirbridge.trackEvent.mock.calls).toEqual([
      ['airbridge.user.signin', { action: 'google' }],
      [
        'airbridge.unlockAchievement',
        { achievementID: 'focus_completed', score: 3 },
        { duration_seconds: 1200 },
      ],
    ]);
    expect(mockAirbridge.clearUser).toHaveBeenCalledTimes(1);
  },
);

test.each(['web', 'demo', 'development', 'old-binary'])(
  '%s 환경은 자동 설치 이벤트를 포함한 추적을 시작하지 않는다',
  (environment) => {
    const { NativeModules, Platform } = require('react-native');
    if (environment === 'web') Platform.OS = environment;
    if (environment === 'demo') process.env.EXPO_PUBLIC_DEMO = '1';
    if (environment === 'development') delete process.env.EXPO_PUBLIC_AIRBRIDGE_DEV_ENABLED;
    if (environment === 'old-binary') delete NativeModules.EventInteractor;
    const { initAirbridge, captureAirbridgeEvent } = require('./airbridge');
    initAirbridge();
    captureAirbridgeEvent('guest_login_completed');
    expect(mockAirbridge.startTracking).not.toHaveBeenCalled();
    expect(mockAirbridge.trackEvent).not.toHaveBeenCalled();
  },
);

test('계정 전환을 신규 가입으로 집계하지 않고 Core에서 미지원하는 이벤트를 보내지 않는다', () => {
  const { initAirbridge, captureAirbridgeEvent } = require('./airbridge');
  initAirbridge();
  captureAirbridgeEvent('member_conversion_completed', { provider: 'kakao' });
  captureAirbridgeEvent('focus_started');
  captureAirbridgeEvent('island_membership_activated', { method: 'joined' });
  expect(mockAirbridge.trackEvent.mock.calls).toEqual([
    ['airbridge.user.signin', { action: 'kakao', label: 'member_conversion' }],
  ]);
});

test('SDK 오류가 사용자 동작 및 세션 정리를 중단하지 않는다', () => {
  const {
    initAirbridge,
    captureAirbridgeEvent,
    identifyAirbridgeUser,
    resetAirbridgeUser,
  } = require('./airbridge');
  initAirbridge();
  const fail = () => {
    throw new Error('native SDK unavailable');
  };
  mockAirbridge.trackEvent.mockImplementation(fail);
  mockAirbridge.setUserID.mockImplementation(fail);
  mockAirbridge.clearUser.mockImplementation(fail);
  expect(() => captureAirbridgeEvent('guest_login_completed')).not.toThrow();
  expect(() => identifyAirbridgeUser('user-2')).not.toThrow();
  expect(resetAirbridgeUser).not.toThrow();
});
