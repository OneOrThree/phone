/* eslint-env jest */
// jest 공통 셋업(GROMO-946) — 컴포넌트·컨텍스트 테스트용 전역 목.
// AsyncStorage는 공식 mock(메모리 Map)으로 대체 — 네이티브 저장소 없이 동작한다.
// 테스트 간 상태 격리는 각 테스트 파일의 afterEach(() => AsyncStorage.clear())로 한다.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
