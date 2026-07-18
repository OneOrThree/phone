// metro.config.js
// getSentryExpoConfig = Expo 기본 설정(getDefaultConfig) + Sentry 소스맵/디버그 ID 지원.
// .glb / .gltf / .obj / .mtl / .fbx / .hdr 등 3D 에셋을
// Metro 번들러가 require() 로 처리할 수 있게 확장자 등록
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);

config.resolver.assetExts = [
  ...config.resolver.assetExts,
  'glb',
  'gltf',
  'obj',
  'mtl',
  'fbx',
  'hdr',
  'bin',
];

module.exports = config;
