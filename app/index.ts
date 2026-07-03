import { LogBox } from 'react-native';
import { registerRootComponent } from 'expo';
import { initializeKakaoSDK } from '@react-native-kakao/core';
import messaging from '@react-native-firebase/messaging';
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

// 백그라운드/종료 상태 원격 메시지 핸들러 — 앱 생명주기 밖(최상위)에서 1회 등록해야 한다.
// 알림(alert) 메시지는 OS가 자동 표시하므로 여기선 data-only 처리만 담당(현재 no-op).
messaging().setBackgroundMessageHandler(async () => {});

registerRootComponent(App);
