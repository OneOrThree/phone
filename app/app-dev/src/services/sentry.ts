/**
 * 활성 2.0 앱의 Sentry 크래시·오류 수집 진입점.
 *
 * PostHog(제품 분석)와 별개로, 앱이 터지거나(크래시) JS 오류가 나면 Sentry 로 보낸다.
 * Sentry 대시보드에서 이 오류를 디스코드 채널로 알리도록 연결한다(Alerts → Discord).
 *
 * 수집 대상은 Sentry org `oneorthree` 의 `cattus` 프로젝트다. DSN 은 앱에 실리는 반공개 값이라
 * posthog 토큰처럼 기본값으로 둔다 — 빌드 환경변수 `EXPO_PUBLIC_SENTRY_DSN` 이 있으면 그 값을 쓴다.
 * 네이티브 모듈이 없거나 목업·개발 환경에서는 datadog·posthog 와 같이 조용히 no-op 한다.
 */
import { isMockMode } from '@/services/demoMode';

// Catus 2.0(oneorthree/cattus)의 공개 수집 DSN. 빌드 환경변수가 없어도 이 프로젝트로 보낸다.
const DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() ??
  'https://9341659f2bc1113404652962115baab5@o4511753920315392.ingest.us.sentry.io/4512360567406592';

// posthog.ts 와 같은 판정 — 값이 비면 운영으로 오분류하지 않고 개발로 본다.
function sentryEnvironment(): 'production' | 'development' {
  const environment = process.env.EXPO_PUBLIC_ENV?.trim().toLowerCase();
  return !__DEV__ && (environment === 'prod' || environment === 'production')
    ? 'production'
    : 'development';
}

let started = false;

export function initSentry(): void {
  if (started || !DSN) return;
  // 개발 빌드는 EXPO_PUBLIC_SENTRY_DEV_ENABLED=1 일 때만 보낸다(운영 프로젝트 오염 방지).
  if (__DEV__ && process.env.EXPO_PUBLIC_SENTRY_DEV_ENABLED !== '1') return;
  // review·demo 목업(웹 ?review/?demo, 네이티브 EXPO_PUBLIC_DEMO=1)은 수집하지 않는다.
  if (isMockMode()) return;

  try {
    const Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
    Sentry.init({
      dsn: DSN,
      environment: sentryEnvironment(),
    });
    started = true;
  } catch {
    // 수집 초기화 실패가 앱 시작을 막지 않는다.
  }
}

/**
 * 루트 컴포넌트를 Sentry 로 감싼다(에러 바운더리·성능 추적용).
 * 초기화되지 않았으면 원본 컴포넌트를 그대로 돌려준다.
 */
export function wrapWithSentry<C>(component: C): C {
  if (!started) return component;
  try {
    const Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
    return Sentry.wrap(component as never) as C;
  } catch {
    return component;
  }
}
