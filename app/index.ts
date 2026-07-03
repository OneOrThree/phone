import { LogBox } from 'react-native';
import { registerRootComponent } from 'expo';
import { initializeKakaoSDK } from '@react-native-kakao/core';
import App from './src/v2/App';

// RN Firebase v22 namespaced API deprecation 경고 억제 — 공식 silence 플래그(모듈러 마이그레이션 전까지).
const g = globalThis as { RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS?: boolean };
g.RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;

// 개발 콘솔 노이즈 억제: shadow 성능 어드바이스 + Firebase deprecation.
LogBox.ignoreLogs([
  'has a shadow set but cannot calculate shadow efficiently',
  'This method is deprecated (as well as all React Native Firebase namespaced API)',
]);

initializeKakaoSDK('af3ff0c5b4fb9cd38b78428b88add65d');

registerRootComponent(App);
