// Datadog RUM(실사용자 모니터링) 단일 래퍼 (GROMO-928).
// 역할 분담: 에러/크래시 수집은 Sentry 담당 → 여기서는 성능 관측만 (trackErrors 비활성).
// 백엔드 APM(gromo-back)과 같은 조직(us5)으로 보내며, firstPartyHosts로 앱 요청에
// 트레이스 헤더를 붙여 앱→백엔드 트레이스를 연결한다(백엔드 dd-java-agent가 자동 인식).
//
// applicationId/clientToken은 "데이터를 어느 RUM 앱으로 보낼지" 주소로 비밀값은 아니지만
// (Sentry DSN과 동일 성격), 빌드 구성별 온오프를 위해 env로 주입한다.
// 미설정이면 전체 no-op — 로컬에서 .env에 키가 없으면 RUM이 조용히 꺼진다.
//
// SDK는 정적 import 대신 지연 require로 로드한다 — Datadog 네이티브 모듈이 없는 구버전
// 바이너리가 OTA(hot-updater, appVersion 전략)로 이 번들을 받아도 앱이 죽지 않고
// 관측만 조용히 꺼지게 하기 위함(코덱스 리뷰 P1).
import { navigationRef } from '@/navigation/navigationRef';

const APPLICATION_ID = process.env.EXPO_PUBLIC_DATADOG_APPLICATION_ID;
const CLIENT_TOKEN = process.env.EXPO_PUBLIC_DATADOG_CLIENT_TOKEN;

// 초기화 완료 신호 — RUM 호출은 initialize 완료 후에만 유효해서(이전 호출은 유실),
// 화면 추적 시작을 이 프로미스 뒤로 미룬다(코덱스 리뷰 P2). 성공하면 true.
let initialized: Promise<boolean> | null = null;

// 앱 시작 시 1회 호출(index.ts, Sentry.init 다음).
export function initDatadog(): void {
  if (!APPLICATION_ID || !CLIENT_TOKEN) return;
  initialized = (async () => {
    try {
      const dd =
        require('@datadog/mobile-react-native') as typeof import('@datadog/mobile-react-native');
      await dd.DdSdkReactNative.initialize(
        new dd.CoreConfiguration(
          CLIENT_TOKEN,
          // 환경 태그 — analytics/Sentry와 같은 규칙(EXPO_PUBLIC_ENV 우선, 없으면 릴리즈=prod).
          process.env.EXPO_PUBLIC_ENV ?? (__DEV__ ? 'dev' : 'prod'),
          dd.TrackingConsent.GRANTED,
          {
            site: 'US5',
            // 트레이스 서비스맵에서 백엔드(gromo-back)와 나란히 보이도록 명시(기본값은 번들 id).
            service: 'gromo-app',
            rumConfiguration: new dd.RumConfiguration(
              APPLICATION_ID,
              true, // trackInteractions — 탭 등 사용자 상호작용
              true, // trackResources — axios/XHR 네트워크 요청
              false, // trackErrors — 에러는 Sentry 담당
              {
                sessionSampleRate: 100,
                // 트레이스 헤더를 붙일 백엔드 호스트(우리 서버만 — 외부 API에는 붙이지 않는다).
                firstPartyHosts: [
                  { match: 'api.oneorthree.world', propagatorTypes: [dd.PropagatorType.DATADOG] },
                  {
                    match: 'oneorthree.dev.mooo.com',
                    propagatorTypes: [dd.PropagatorType.DATADOG],
                  },
                ],
              },
            ),
          },
        ),
      );
      return true;
    } catch {
      // 네이티브 모듈 부재(구버전 바이너리) 또는 초기화 실패 — 관측만 포기, 앱 동작엔 영향 없음.
      return false;
    }
  })();
}

// NavigationContainer onReady에서 1회 호출 — 초기화 완료를 기다렸다가 화면 전환 추적을 시작한다.
// (초기화보다 컨테이너가 먼저 준비돼도 추적 시작이 유실되지 않는다. 초기화 완료 전에 나간
// 콜드스타트 네트워크 요청 일부는 미수집 — 부팅을 막지 않는 대가로 수용.)
export function startDatadogNavigationTracking(): void {
  initialized?.then((ok) => {
    if (!ok) return;
    try {
      const nav =
        require('@datadog/mobile-react-navigation') as typeof import('@datadog/mobile-react-navigation');
      nav.DdRumReactNavigationTracking.startTrackingViews(navigationRef.current);
    } catch {
      // 구버전 바이너리 — no-op
    }
  });
}
