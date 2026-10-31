const { getPostHogExpoConfig } = require('posthog-react-native/metro');

const config = getPostHogExpoConfig(__dirname);

// 집중 인증 손바닥 탐지 모델(.tflite)을 require 로 번들한다.
config.resolver.assetExts.push('tflite');

// import 한 모듈을 처음 쓰는 자리에서 평가해, 앱 시작 때 화면 모듈 전부를 한꺼번에 실행하지 않는다(GROMO-2376).
// Expo 기본값(experimentalImportSupport: true)은 그대로 두고 inlineRequires 만 켠다
const { getTransformOptions } = config.transformer;
config.transformer.getTransformOptions = async (...args) => {
  const options = await getTransformOptions(...args);
  return { ...options, transform: { ...options.transform, inlineRequires: true } };
};

module.exports = config;
