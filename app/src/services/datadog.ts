// Datadog RUM(실사용자 모니터링) 단일 래퍼 (GROMO-928).
// 역할 분담: 에러/크래시 수집은 Sentry 담당 → 여기서는 성능 관측만 (trackErrors 비활성).
// 백엔드 APM(gromo-back)과 같은 조직(us5)으로 보내며, firstPartyHosts로 앱 요청에
// 트레이스 헤더를 붙여 앱→백엔드 트레이스를 연결한다(백엔드 dd-java-agent가 자동 인식).
//
// applicationId/clientToken은 "데이터를 어느 RUM 앱으로 보낼지" 주소로 비밀값은 아니지만
// (Sentry DSN과 동일 성격), 빌드 구성별 온오프를 위해 env로 주입한다.
// 미설정이면 전체 no-op — 로컬에서 .env에 키가 없으면 RUM이 조용히 꺼진다.
import {
  CoreConfiguration,
  DdSdkReactNative,
  PropagatorType,
  RumConfiguration,
  TrackingConsent,
} from '@datadog/mobile-react-native';
import { DdRumReactNavigationTracking } from '@datadog/mobile-react-navigation';
import { navigationRef } from '@/navigation/navigationRef';

const APPLICATION_ID = process.env.EXPO_PUBLIC_DATADOG_APPLICATION_ID;
const CLIENT_TOKEN = process.env.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN;

// 트레이스 헤더를 붙일 백엔드 호스트(우리 서버만 — 외부 API에는 붙이지 않는다).
const FIRST_PARTY_HOSTS = [
  { match: 'api.oneorthree.world', propagatorTypes: [PropagatorType.DATADOG] },
  { match: 'oneorthree.dev.mooo.com', propagatorTypes: [PropagatorType.DATADOG] },
];

// 앱 시작 시 1회 호출(index.ts, Sentry.init 다음).
export function initDatadog(): void {
  if (!APPLICATION_ID || !CLIENT_TOKEN) return;
  DdSdkReactNative.initialize(
    new CoreConfiguration(
      CLIENT_TOKEN,
      // 환경 태그 — analytics/Sentry와 같은 규칙(EXPO_PUBLIC_ENV 우선, 없으면 릴리즈=prod).
      process.env.EXPO_PUBLIC_ENV ?? (__DEV__ ? 'dev' : 'prod'),
      TrackingConsent.GRANTED,
      {
        site: 'US5',
        // 트레이스 서비스맵에서 백엔드(gromo-back)와 나란히 보이도록 명시(기본값은 번들 id).
        service: 'gromo-app',
        rumConfiguration: new RumConfiguration(
          APPLICATION_ID,
          true, // trackInteractions — 탭 등 사용자 상호작용
          true, // trackResources — axios/XHR 네트워크 요청
          false, // trackErrors — 에러는 Sentry 담당
          { sessionSampleRate: 100, firstPartyHosts: FIRST_PARTY_HOSTS },
        ),
      },
    ),
    // 초기화 실패는 관측만 죽는 것 — 앱 동작에 영향 없게 삼킨다.
  ).catch(() => {});
}

// NavigationContainer onReady에서 1회 호출 — 화면 전환을 RUM 뷰로 기록.
export function startDatadogNavigationTracking(): void {
  if (!APPLICATION_ID || !CLIENT_TOKEN) return;
  DdRumReactNavigationTracking.startTrackingViews(navigationRef.current);
}
