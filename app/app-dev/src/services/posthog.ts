import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type PostHog from 'posthog-react-native';
import {
  readAnalyticsDeviceProperties,
  type AnalyticsDeviceProperties,
} from '@/services/analyticsDevice';
import { isMockMode } from '@/services/demoMode';
import {
  captureAirbridgeEvent,
  identifyAirbridgeUser,
  resetAirbridgeUser,
} from '@/services/airbridge';

// Catus / Catus의 공개 수집 토큰. 빌드 환경변수가 없어도 이 프로젝트로 보낸다.
const projectToken =
  process.env.EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN ??
  'phc_wbezwMeaU3VKvPxdbdd6QD7GTBqD7rbmAzUgazz6epRc';
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let client: PostHog | null = null;
let identityRevision = 0;

function analyticsEnvironment(): 'production' | 'development' {
  const environment = process.env.EXPO_PUBLIC_ENV?.trim().toLowerCase();
  // 운영은 EXPO_PUBLIC_ENV 를 prod 로 명시한 release 빌드만. 값이 비면 운영으로 오분류하지 않고 개발로 본다.
  return !__DEV__ && (environment === 'prod' || environment === 'production')
    ? 'production'
    : 'development';
}

/** 개발·목업 제외 규칙을 제품 분석과 리플레이에 함께 적용한다. */
export function initPostHog(): void {
  if (client || !projectToken || !host) return;
  if (__DEV__ && process.env.EXPO_PUBLIC_POSTHOG_DEV_ENABLED !== '1') return;
  // Android dev 배포·로컬 테스트는 운영 프로젝트에 이벤트와 리플레이를 보내지 않는다.
  if (Platform.OS === 'android' && analyticsEnvironment() === 'development') return;
  // review·demo 목업(웹 ?review/?demo, 네이티브 EXPO_PUBLIC_DEMO=1)은 계측하지 않는다
  if (isMockMode()) return;

  try {
    const PostHogClient = require('posthog-react-native').default as typeof PostHog;
    const environment = analyticsEnvironment();
    const native = Platform.OS === 'ios' || Platform.OS === 'android';
    let deviceProperties: AnalyticsDeviceProperties = {};
    const devicePropertiesReady = readAnalyticsDeviceProperties().then((properties) => {
      deviceProperties = properties;
    });
    client = new PostHogClient(projectToken, {
      host,
      // 이전 프로젝트의 대기 이벤트와 식별자를 새 프로젝트로 보내지 않는다.
      customStorage: {
        // SDK의 저장소 복원 완료 전에 IDFV를 읽어 첫 lifecycle 이벤트부터 속성을 붙인다.
        // 클라이언트는 즉시 만들기 때문에 앱 진입·Provider·인증 구독은 기다리지 않는다.
        getItem: async (key) => {
          await devicePropertiesReady;
          return AsyncStorage.getItem(`posthog:${projectToken}:${key}`);
        },
        setItem: (key, value) => AsyncStorage.setItem(`posthog:${projectToken}:${key}`, value),
      },
      captureAppLifecycleEvents: true,
      enableSessionReplay: false,
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
        if (event)
          event.properties = {
            ...event.properties,
            ...deviceProperties,
            analytics_environment: environment,
          };
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
      // 기능 플래그를 쓰지 않으므로 시작 때 플래그 요청을 보내지 않는다
      preloadFeatureFlags: false,
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
  captureAirbridgeEvent(event, properties);
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
  identifyAirbridgeUser(userId);
  identityRevision += 1;
  try {
    client?.identify(userId);
  } catch {}
}

export function resetPostHogUser(): void {
  resetAirbridgeUser();
  const currentClient = client;
  const revision = ++identityRevision;
  if (!currentClient) return;
  try {
    // 초기 무인증 snapshot은 로그아웃이 아니다. 저장된 식별자를 읽은 뒤 이미 익명이면 유지한다.
    // 대기 중 새 로그인이 완료됐다면 그 계정까지 초기화하지 않는다.
    currentClient
      .ready()
      .then(() => {
        if (revision !== identityRevision) return;
        if (currentClient.getDistinctId() !== currentClient.getAnonymousId()) currentClient.reset();
      })
      .catch(() => {});
  } catch {}
}
