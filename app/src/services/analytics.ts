// Track 1 (GA4 사용자 분석) 단일 래퍼.
// 모든 분석 호출은 이 모듈을 통한다 — 화면/스토어에서 firebase SDK를 직접 부르지 않는다.
//
// 설계: event-logging-design.md §2 (네이밍/공통 파라미터/User-ID 규약)
// - track(name, params): 공통 파라미터 자동 부착 + GA4 한도 sanitize 후 logEvent
// - 항상 fire-and-forget: 실패를 삼키고 UX를 막지 않는다 (호출부는 `void track(...)`)
//
// ── 동작 ──
// 네이티브 모듈(@react-native-firebase/analytics)이 링크돼 있으면 GA4로 전송하고,
// 링크 전(또는 호출 실패) 상태에서는 안전하게 no-op + dev 콘솔 로그로 폴백한다.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import analytics from '@react-native-firebase/analytics';

// ── 공통 파라미터 (모든 이벤트에 자동 부착, 프론트/백 조인 시 출처 구분용) ──
const ENV: 'prod' | 'dev' =
  (process.env.EXPO_PUBLIC_ENV as 'prod' | 'dev' | undefined) ?? (__DEV__ ? 'dev' : 'prod');
const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

const COMMON_PARAMS: Record<string, string> = {
  platform: Platform.OS, // 'ios' | 'android'
  source: 'client',
  app_version: APP_VERSION,
  env: ENV,
};

// dev 빌드이거나 명시 토글이 켜져 있으면 콘솔에 이벤트를 출력한다.
const DEBUG: boolean = __DEV__ || process.env.EXPO_PUBLIC_ANALYTICS_DEBUG === 'true';

// 우리가 사용하는 @react-native-firebase/analytics 표면만 추린 인터페이스.
interface FirebaseAnalytics {
  logEvent(name: string, params?: Record<string, string | number>): Promise<void>;
  logScreenView(params: { screen_name: string; screen_class?: string }): Promise<void>;
  setUserId(id: string | null): Promise<void>;
  setUserProperty(name: string, value: string | null): Promise<void>;
  setDefaultEventParameters(params: Record<string, string | number> | null): Promise<void>;
  setAnalyticsCollectionEnabled(enabled: boolean): Promise<void>;
}

// 네이티브 Firebase Analytics 인스턴스. 모듈이 링크 안 됐으면 null로 폴백(no-op).
function getAnalytics(): FirebaseAnalytics | null {
  try {
    return analytics() as unknown as FirebaseAnalytics;
  } catch {
    return null;
  }
}

// ── GA4 한도에 맞춘 sanitize ──
// 이벤트명 ≤40자 / 파라미터명 ≤40자 / 문자열 값 ≤100자
// boolean → 'true' | 'false' (문자열 통일) / Date·시각 → epoch millis(number)
function sanitizeName(name: string): string {
  return name.slice(0, 40);
}

function sanitizeParams(params?: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!params) return out;
  for (const [rawKey, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    const key = rawKey.slice(0, 40);
    if (typeof value === 'boolean') {
      out[key] = value ? 'true' : 'false';
    } else if (value instanceof Date) {
      out[key] = value.getTime();
    } else if (typeof value === 'number') {
      out[key] = value;
    } else {
      out[key] = String(value).slice(0, 100);
    }
  }
  return out;
}

// 앱 시작 시 1회 호출 권장: 수집 활성화 + GA4 표준 이벤트(screen_view 등 전용 메서드)에도 공통 파라미터를 부착.
// 모듈 미링크 시 no-op.
export function initAnalytics(): void {
  const a = getAnalytics();
  if (DEBUG) console.log('[analytics] init', COMMON_PARAMS);
  if (!a) return;
  // GoogleService-Info.plist의 IS_ANALYTICS_ENABLED=false 대비, 런타임에서 수집을 명시적으로 켠다.
  a.setAnalyticsCollectionEnabled(true).catch(() => {});
  a.setDefaultEventParameters(COMMON_PARAMS).catch(() => {});
}

// 커스텀 이벤트 발행. 공통 파라미터를 자동 부착한다.
export function track(name: string, params?: Record<string, unknown>): void {
  const eventName = sanitizeName(name);
  const payload = { ...COMMON_PARAMS, ...sanitizeParams(params) };
  if (DEBUG) console.log('[analytics]', eventName, payload);
  const a = getAnalytics();
  if (!a) return;
  a.logEvent(eventName, payload).catch(() => {});
}

// GA4 표준 screen_view. (라우트 변경 시 RootNavigator에서 호출)
export function logScreenView(screenName: string): void {
  if (DEBUG) console.log('[analytics] screen_view', screenName);
  const a = getAnalytics();
  if (!a) return;
  a.logScreenView({ screen_name: screenName, screen_class: screenName }).catch(() => {});
}

// User-ID 설정/해제. opaque UUID만 허용(PII 금지). null이면 게스트.
export function setUserId(id: string | null): void {
  if (DEBUG) console.log('[analytics] setUserId', id);
  const a = getAnalytics();
  if (!a) return;
  a.setUserId(id).catch(() => {});
}

// User Property 설정. boolean은 문자열로, null이면 해제. PII 금지(닉네임/생년월일 등 금지).
export function setUserProperty(name: string, value: string | boolean | null): void {
  const v = typeof value === 'boolean' ? (value ? 'true' : 'false') : value;
  if (DEBUG) console.log('[analytics] setUserProperty', name, v);
  const a = getAnalytics();
  if (!a) return;
  a.setUserProperty(name.slice(0, 40), v).catch(() => {});
}
