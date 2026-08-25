import { LogBox, Platform } from 'react-native';
import { registerRootComponent } from 'expo';
import * as Sentry from '@sentry/react-native';
import { initDatadog } from './src/services/datadog';

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

// Datadog RUM 초기화(GROMO-928) — 성능 관측 전용(에러는 위 Sentry 담당). 키 미설정 시 no-op.
if (Platform.OS !== 'web') {
  initDatadog();
}

// RN Firebase v22 namespaced API deprecation 경고 억제 — 공식 silence 플래그(모듈러 마이그레이션 전까지).
const g = globalThis as { RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS?: boolean };
g.RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;

// 개발 콘솔 노이즈 억제: shadow 성능 어드바이스 + Firebase deprecation.
LogBox.ignoreLogs([
  'has a shadow set but cannot calculate shadow efficiently',
  'This method is deprecated (as well as all React Native Firebase namespaced API)',
]);

// 카카오·FCM은 네이티브 앱 부트스트랩에서만 로드한다. 정적 import로 두면 웹 번들에서
// Firebase App 초기화 전 messaging()과 Kakao native key 검증이 실행돼 루트 렌더링 전에 중단된다.
if (Platform.OS !== 'web') {
  const { initializeKakaoSDK } =
    require('@react-native-kakao/core') as typeof import('@react-native-kakao/core');

  initializeKakaoSDK('af3ff0c5b4fb9cd38b78428b88add65d');

  // 백그라운드/종료 상태 원격 메시지 핸들러 — 앱 생명주기 밖(최상위)에서 1회 등록해야 한다.
  // 알림(alert) 메시지는 OS가 자동 표시하므로 여기선 data-only(사일런트 flush — GROMO-1286)만
  // 처리한다. 종전 no-op은 종료 상태 headless 기동 시 PushGate 이펙트 교체 전에 메시지를 삼켰다
  // (codex 리뷰 P1) — 실제 flush 핸들러를 여기서 바로 배선한다. Sentry.init 이후에 로드해야
  // 하므로(App 모듈과 같은 이유) 정적 import 대신 require로 늦춘다.
  const { registerBackgroundFlushHandler } =
    require('./src/services/pushBackground') as typeof import('./src/services/pushBackground');
  registerBackgroundFlushHandler();
}

// 집중 세션 엔진 부팅 복구(GROMO-1600) — UI 없이 도는 코드라 여기서 부른다. 콜드 스타트
// (종료 상태 headless 기동 포함)마다 미완 시작을 회수하고 저널에 남은 정산을 재업로드한다.
// **네이티브 가드 밖**이다: 웹 세션도 같은 엔진으로 settle intent를 남기는데 OrphanFocusSettler는
// 저널을 읽지 않으므로, 여기서 안 돌리면 웹에서는 그 정산이 영영 재생되지 않는다.
// fire-and-forget — 실패해도 다음 부팅·사일런트 flush가 다시 시도한다.
const { recoverFocusEngine } =
  require('./src/screens/focus/engine/boot') as typeof import('./src/screens/focus/engine/boot');
recoverFocusEngine();

// App 모듈은 Sentry.init 이후에 로드한다 — 정적 import는 파일 본문보다 먼저 실행되므로,
// App 최상위 초기화(Facebook SDK 등)에서 나는 에러까지 잡으려면 require로 로드를 늦춰야 한다(코덱스 리뷰).
const { default: App } = require('./src/App') as typeof import('./src/App');

// Sentry.wrap: 루트 컴포넌트 렌더링 중 에러까지 잡도록 감싼다.
registerRootComponent(Sentry.wrap(App));
