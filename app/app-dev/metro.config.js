const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { getPostHogExpoConfig } = require('posthog-react-native/metro');

// Sentry·PostHog 둘 다 번들과 소스맵에 디버그 ID 를 심어야 업로드한 소스맵이 크래시 스택에 붙는다(GROMO-2739).
// 두 래퍼 모두 Expo 기본 설정을 만들며 자기 플러그인을 끼우므로, Sentry 래퍼가 PostHog 래퍼로 기본 설정을 만들게 겹친다.
// Sentry 가 넘기는 옵션에 getDefaultConfig(이 함수 자신)가 들어 있어 비우고 넘긴다 — 안 비우면 PostHog 가 이걸 다시 불러 무한 반복한다.
const config = getSentryExpoConfig(__dirname, {
  getDefaultConfig: (projectRoot, options) =>
    getPostHogExpoConfig(projectRoot, { ...options, getDefaultConfig: undefined }),
});

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
