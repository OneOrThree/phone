import { LogBox } from 'react-native';
import { registerRootComponent } from 'expo';
import * as Sentry from '@sentry/react-native';
import { initializeKakaoSDK } from '@react-native-kakao/core';
import messaging from '@react-native-firebase/messaging';

// Sentry 에러 리포팅 초기화 — 가능한 한 앱 시작 최상단에서 호출해야 한다.
// DSN은 "에러를 어느 프로젝트로 보낼지" 주소일 뿐 비밀값이 아니므로 코드에 직접 둔다.
Sentry.init({
  dsn: 'https://884a7f73611b838911f1f91a15a93414@o4511753920315392.ingest.us.sentry.io/4511753927458816',
  // 개발 중(Metro) 에러는 보내지 않고 배포 빌드에서만 전송
  enabled: !__DEV__,
  // 환경 태그 — analytics의 ENV와 같은 규칙(EXPO_PUBLIC_ENV 우선, 없으면 릴리즈=prod).
  // dev 서버 대상 빌드와 prod 출시 빌드를 Sentry에서 구분하기 위함(GROMO-849).
  environment: process.env.EXPO_PUBLIC_ENV ?? (__DEV__ ? 'dev' : 'prod'),
});

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

// App 모듈은 Sentry.init 이후에 로드한다 — 정적 import는 파일 본문보다 먼저 실행되므로,
// App 최상위 초기화(Facebook SDK 등)에서 나는 에러까지 잡으려면 require로 로드를 늦춰야 한다(코덱스 리뷰).
const { default: App } = require('./src/App') as typeof import('./src/App');

// Sentry.wrap: 루트 컴포넌트 렌더링 중 에러까지 잡도록 감싼다.
registerRootComponent(Sentry.wrap(App));
