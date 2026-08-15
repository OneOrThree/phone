/* eslint-env jest */
// jest 공통 셋업(GROMO-946·948) — 네이티브 모듈이 없는 jest 환경에서 AsyncStorage를
// 패키지가 제공하는 공식 in-memory mock(메모리 Map)으로 대체한다(모든 테스트 파일에 적용).
// mock 저장소는 워커 프로세스 안에서 유지되므로, 저장소 상태를 쓰는 테스트는
// beforeEach/afterEach에서 AsyncStorage.clear()로 직접 비운다.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// @callstack/liquid-glass(리퀴드 글래스) — ESM만 배포하는 데다 import 시점에 TurboModule을
// getEnforcing으로 잡아서, jest에서는 변환을 뚫어줘도 로드가 불가능하다. 이 패키지를 전이로
// 끌어오는 스위트가 통째로 죽지 않도록 폴백 경로(미지원)로 고정한 스텁으로 대체한다.
jest.mock('@callstack/liquid-glass', () => ({
  isLiquidGlassSupported: false,
  LiquidGlassView: require('react-native').View,
}));

// expo-audio(탭 효과음) — 네이티브 오디오 세션이 없는 jest 환경에서 createAudioPlayer가 터진다.
// 재생 호출 여부만 검증하면 되므로 플레이어를 빈 스텁으로 대체한다.
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    volume: 1,
    play: jest.fn(),
    seekTo: jest.fn(() => Promise.resolve()),
  })),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));

// Firebase Analytics — analyticsEvents를 직접 import하는 화면 테스트에서도 네이티브 모듈 초기화를
// 피한다. 실제 이벤트 발행 여부는 analytics/analyticsEvents 단위 테스트에서 별도로 검증한다.
jest.mock('@react-native-firebase/analytics', () => {
  const analytics = jest.fn(() => ({
    logEvent: jest.fn(() => Promise.resolve()),
    setUserId: jest.fn(() => Promise.resolve()),
    setUserProperty: jest.fn(() => Promise.resolve()),
    setDefaultEventParameters: jest.fn(() => Promise.resolve()),
    setAnalyticsCollectionEnabled: jest.fn(() => Promise.resolve()),
    getAppInstanceId: jest.fn(() => Promise.resolve(null)),
  }));
  return { __esModule: true, default: analytics };
});

// AppState 초기값 — RN 테스트 목의 기본값은 실기기와 다르다(active를 주지 않는다).
// 챌린지 결과 호스트는 **명시적 active일 때만** claim·노출을 허용하므로(보이지 않는 앱에서
// seen/ack이 찍히는 것을 막는 게이트), 목의 기본값을 그대로 두면 그 게이트가 전부 닫혀
// 실기기에서 정상인 동작이 테스트에서만 안 뜬다. 실기기가 마운트 시 주는 값으로 맞춘다.
// 비활성 구간을 보는 테스트는 각자 change 이벤트를 굴려 덮는다.
const { AppState } = require('react-native');
AppState.currentState = 'active';
