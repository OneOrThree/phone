// metro.config.js
// .glb / .gltf / .obj / .mtl / .fbx / .hdr 등 3D 에셋을
// Metro 번들러가 require() 로 처리할 수 있게 확장자 등록
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

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
