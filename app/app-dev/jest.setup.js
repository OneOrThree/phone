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
