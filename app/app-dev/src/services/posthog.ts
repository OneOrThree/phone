import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type PostHog from 'posthog-react-native';
import { isMockMode } from '@/services/demoMode';

// Catus / Catus의 공개 수집 토큰. 빌드 환경변수가 없어도 이 프로젝트로 보낸다.
const projectToken =
  process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN ??
  'phc_wbezwMeaU3VKvPxdbdd6QD7GTBqD7rbmAzUgazz6epRc';
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let client: PostHog | null = null;

function analyticsEnvironment(): 'production' | 'development' {
  const environment = process.env.EXPO_PUBLIC_ENV?.trim().toLowerCase();
  return !__DEV__ && (!environment || environment === 'prod' || environment === 'production')
    ? 'production'
    : 'development';
}

/** 개발·목업 제외 규칙을 제품 분석과 리플레이에 함께 적용한다. */
export function initPostHog(): void {
  if (client || !projectToken || !host) return;
  if (__DEV__ && process.env.EXPO_PUBLIC_POSTHOG_DEV_ENABLED !== '1') return;
  // review·demo 목업(웹 ?review/?demo, 네이티브 EXPO_PUBLIC_DEMO=1)은 계측하지 않는다
  if (isMockMode()) return;

  try {
    const PostHogClient = require('posthog-react-native').default as typeof PostHog;
    const environment = analyticsEnvironment();
    const native = Platform.OS === 'ios' || Platform.OS === 'android';
    client = new PostHogClient(projectToken, {
      host,
      // 이전 프로젝트의 대기 이벤트와 식별자를 새 프로젝트로 보내지 않는다.
      customStorage: {
        getItem: (key) => AsyncStorage.getItem(`posthog:${projectToken}:${key}`),
        setItem: (key, value) => AsyncStorage.setItem(`posthog:${projectToken}:${key}`, value),
      },
      captureAppLifecycleEvents: true,
      enableSessionReplay: native,
      errorTracking: {
        autocapture: {
          uncaughtExceptions: true,
          unhandledRejections: true,
          console: false,
          // 네이티브 전송은 JS before_send를 거치지 않는다. 운영에서만 켜서
          // 환경 속성이 없는 네이티브 fatal도 운영 오류 카드에서 구분한다.
          nativeCrashes: native && environment === 'production',
          androidNdkCrashes: Platform.OS === 'android' && environment === 'production',
        },
      },
      before_send: (event) => {
        if (event) event.properties = { ...event.properties, analytics_environment: environment };
        return event;
      },
      sessionReplayConfig: {
        maskAllTextInputs: true,
        maskAllImages: true,
        maskAllSandboxedViews: true,
        captureLog: false,
        captureNetworkTelemetry: false,
      },
      disableGeoip: true,
    });
  } catch {
    // Analytics must never prevent the app from starting.
  }
}

export function getPostHogClient(): PostHog | null {
  return client;
}

export function trackPostHogScreen(route: string): void {
  if (!client) return;
  void client.screen(route).catch(() => {});
}

export function captureProductEvent(
  event: string,
  properties?: Record<string, string | number>,
): void {
  try {
    client?.capture(event, {
      ...properties,
      analytics_environment: analyticsEnvironment(),
    });
  } catch {
    // Product actions must not fail when telemetry does.
  }
}

export function identifyPostHogUser(userId: string): void {
  try {
    client?.identify(userId);
  } catch {}
}

export function resetPostHogUser(): void {
  try {
    client?.reset();
  } catch {}
}
