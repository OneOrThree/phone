const { getPostHogExpoConfig } = require('posthog-react-native/metro');

const config = getPostHogExpoConfig(__dirname);

// 집중 인증 손바닥 탐지 모델(.tflite)을 require 로 번들한다.
config.resolver.assetExts.push('tflite');

// EXPO_PUBLIC_* 는 변환 단계에서 코드에 인라인되는데 Metro 변환 캐시 키에는 값이 들어가지 않는다. 그대로 두면 같은 기기에서
// 앞선 빌드의 값(dev 서버 주소, dev CDN)이 다음 운영 번들에 실린다(GROMO-2671). 값을 키에 넣어 빌드 경로와 무관하게 막는다.
config.cacheVersion = [
  config.cacheVersion,
  ...Object.keys(process.env)
    .filter((key) => key.startsWith('EXPO_PUBLIC_'))
    .sort()
    .map((key) => `${key}=${process.env[key]}`),
].join('\n');

// import 한 모듈을 처음 쓰는 자리에서 평가해, 앱 시작 때 화면 모듈 전부를 한꺼번에 실행하지 않는다(GROMO-2376).
// Expo 기본값(experimentalImportSupport: true)은 그대로 두고 inlineRequires 만 켠다
const { getTransformOptions } = config.transformer;
config.transformer.getTransformOptions = async (...args) => {
  const options = await getTransformOptions(...args);
  return { ...options, transform: { ...options.transform, inlineRequires: true } };
};

module.exports = config;
