/* eslint-env jest */
// jest 공통 셋업(GROMO-946·948) — 네이티브 모듈이 없는 jest 환경에서 AsyncStorage를
// 패키지가 제공하는 공식 in-memory mock(메모리 Map)으로 대체한다(모든 테스트 파일에 적용).
// mock 저장소는 워커 프로세스 안에서 유지되므로, 저장소 상태를 쓰는 테스트는
// beforeEach/afterEach에서 AsyncStorage.clear()로 직접 비운다.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

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
