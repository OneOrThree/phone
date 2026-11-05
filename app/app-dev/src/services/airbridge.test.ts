const mockAirbridge = {
  setOnDeeplinkReceived: jest.fn(),
  setOnAttributionReceived: jest.fn(),
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

// GROMO-2753: Core 플랜은 맞춤 이벤트가 없어 첫 항해 체험 도착을 표준 Complete Tutorial 로 보낸다.
test('첫 섬 도착을 Complete Tutorial 표준 이벤트로 보낸다', () => {
  const { initAirbridge, captureAirbridgeEvent } = require('./airbridge');
  initAirbridge();
  captureAirbridgeEvent('first_island_arrival');
  expect(mockAirbridge.trackEvent.mock.calls).toEqual([
    ['airbridge.completeTutorial', { action: 'first_island_arrival' }],
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

test('설치 귀속은 광고 분류만 전달하고 빈 콜백·중복·추가 식별자를 제외한다', () => {
  const { initAirbridge, onAirbridgeAttribution } = require('./airbridge');
  const listener = jest.fn();
  onAirbridgeAttribution(listener);
  initAirbridge();
  const receive = mockAirbridge.setOnAttributionReceived.mock.calls[0][0];
  receive({});
  expect(listener).not.toHaveBeenCalled();
  const attribution = {
    attributedChannel: 'meta',
    attributedCampaign: 'study',
    attributedAdCreative: 'cat',
    email: 'not-forwarded',
    adid: 'not-forwarded',
  };
  receive(attribution);
  receive(attribution);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith({
    attributed_channel: 'meta',
    attributed_campaign: 'study',
    attributed_ad_group: '',
    attributed_creative: 'cat',
  });
  expect(mockAirbridge.setOnAttributionReceived.mock.invocationCallOrder[0]).toBeLessThan(
    mockAirbridge.startTracking.mock.invocationCallOrder[0],
  );
});

test('PostHog가 늦게 구독해도 수신한 귀속을 전달하고 미귀속도 보존한다', () => {
  const { initAirbridge, onAirbridgeAttribution } = require('./airbridge');
  initAirbridge();
  mockAirbridge.setOnAttributionReceived.mock.calls[0][0]({ attributedChannel: 'unattributed' });
  const listener = jest.fn();
  onAirbridgeAttribution(listener);
  expect(listener.mock.calls[0][0].attributed_channel).toBe('unattributed');
  expect(() =>
    onAirbridgeAttribution(() => {
      throw new Error('telemetry');
    }),
  ).not.toThrow();
});
