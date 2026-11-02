/* eslint-env jest */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// 보안 저장소는 네이티브 모듈이라 테스트에서 메모리 맵으로 대체한다.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
  };
});

jest.mock('expo-audio', () => ({
  useAudioPlayer: jest.fn(() => ({
    replace: jest.fn(),
    play: jest.fn(),
    pause: jest.fn(),
    volume: 1,
    loop: false,
  })),
}));

// expo-video의 네이티브 SharedObject는 Node 테스트 런타임에 없다.
jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn((_source, setup) => {
    const player = {
      loop: false,
      muted: true,
      play: jest.fn(),
      pause: jest.fn(),
      addListener: jest.fn(() => ({ remove: jest.fn() })),
    };
    setup?.(player);
    return player;
  }),
  VideoView: 'VideoView',
}));

// Skia 는 네이티브 모듈이라 공식 mock 으로 대체한다. 기본 환경엔 CanvasKit 이 없어 컴포넌트·훅만 쓰이고
// (useImage → null 이라 TileTerrainCanvas 는 아무것도 그리지 않는다), Skia API 단언이 필요한 테스트는
// 파일 머리에 `@jest-environment @shopify/react-native-skia/jestEnv.js` 를 달아 CanvasKit 을 올린다.
jest.mock('@shopify/react-native-skia', () =>
  require('@shopify/react-native-skia/lib/commonjs/mock').Mock(global.CanvasKit),
);

// expo-localization 은 네이티브 모듈이라 기기 언어를 ko-KR(테스트가 단언하는 정본 문구)로 고정한다.
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [
    { languageCode: 'ko', languageTag: 'ko-KR', regionCode: 'KR', languageScriptCode: null },
  ]),
}));

// 집중 인증 스파이크의 카메라·TFLite 네이티브 모듈. 테스트는 스파이크 줄을 그리지 않으므로 import 만 통과시킨다.
jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  useCamera: jest.fn(),
  useCameraDevice: jest.fn(() => undefined),
  useCameraPermission: jest.fn(() => ({
    status: 'not-determined',
    hasPermission: false,
    canRequestPermission: true,
    requestPermission: jest.fn(async () => false),
  })),
  useFrameOutput: jest.fn(() => ({})),
}));
jest.mock('react-native-vision-camera-resizer', () => ({
  useResizer: jest.fn(() => ({ state: 'loading', resizer: undefined, error: undefined })),
}));
jest.mock('react-native-vision-camera-worklets', () => ({}));
// react-native-worklets 는 jest 에서 네이티브 언패커를 찾다 죽는다. 스파이크가 쓰는 두 함수만 흉내 낸다.
jest.mock('react-native-worklets', () => ({
  createSynchronizable: jest.fn((value) => {
    let current = value;
    return {
      getBlocking: () => current,
      getDirty: () => current,
      setBlocking: (next) => {
        current = typeof next === 'function' ? next(current) : next;
      },
      lock: jest.fn(),
      unlock: jest.fn(),
    };
  }),
  scheduleOnRN: jest.fn((fn, ...args) => fn(...args)),
}));
jest.mock('react-native-fast-tflite', () => ({
  loadTensorflowModel: jest.fn(),
  useTensorflowModel: jest.fn(() => ({ state: 'loading', model: undefined })),
}));
jest.mock('expo-keep-awake', () => ({
  useKeepAwake: jest.fn(),
  activateKeepAwakeAsync: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

// 각도 확인용 Expo 카메라 프리뷰는 실제 기기 대신 호스트 뷰로 검사한다.
jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: jest.fn(() => [
    { granted: false, canAskAgain: false },
    jest.fn(),
    jest.fn(),
  ]),
}));
