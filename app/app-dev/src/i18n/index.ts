/**
 * 2.0 앱 다국어 코어 — 라이브러리 없이 ko·en JSON 표와 t() 하나로 처리한다.
 *
 * - 모듈 최상위에서 t() 를 부르지 않는다. import 시점 언어로 값이 굳어 언어를 바꿔도 그대로다(1.x 교훈).
 *   렌더 중에 부르면 언어 변경은 App 의 localePref state 재렌더가 퍼뜨린다.
 * - React.memo 자식이나 useMemo/useCallback 안에서 t() 를 부르면 props/deps 가 같은 한 언어가 바뀌어도
 *   다시 계산되지 않는다 — e.localePref 를 prop 이나 deps 에 넣는다.
 * - 키는 점 표기 네임스페이스('errors.GENERIC'), 치환은 {{var}}.
 * - en 복수는 { one, other } 객체 + vars.count 로 고른다(Hermes 엔 Intl.PluralRules 가 없다). ko 는 문자열.
 * - 이미지는 `<이름>.ko.png`·`<이름>.en.png` 정적 require 쌍을 localized({ ko, en }) 로 고른다.
 *   새 PNG 는 OTA 로 못 나간다 — app.config.js assetPatternsToBeBundled 가 src/assets/ota/** 만 싣는다.
 * - App.tsx 의 titles 는 Datadog RUM 뷰 이름이라 번역하지 않는다.
 */
import { getLocales } from 'expo-localization';
import { ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';
import en from './locales/en.json';
import ko from './locales/ko.json';

export const SUPPORTED_LOCALES = ['ko', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
// 사용자가 고르는 값. 'system' = 기기 언어를 따른다.
export type LocalePref = 'system' | SupportedLocale;
// 언어 이름은 자기표기로 고정한다 — 어느 언어로 보든 English 는 English 다.
export const LOCALE_NAMES: Record<SupportedLocale, string> = { ko: '한국어', en: 'English' };
// 기기 전역 값이다 — 상태 블롭(STORAGE)과 따로 두고 로그아웃·탈퇴·계정 전환에도 지우지 않는다.
export const LOCALE_KEY = 'gromo.locale';
// 1.x 가 쓰던 키(Android 는 같은 패키지라 업데이트 뒤에도 남는다). 2.0 키가 없을 때만 읽는다.
export const LEGACY_LOCALE_KEY = 'gromo:settings:locale';

const tables: Record<SupportedLocale, unknown> = { ko, en };

// 기기 로케일 → 지원 언어. 한국어가 아니면(로케일 부재 포함) en.
// 네이티브 모듈 호출이 던지면(expo-localization 이 없는 구 빌드가 OTA 로 이 JS 를 받은 경우, 모킹 없는 테스트) ko —
// 그런 빌드는 한국어 전용이었다. import 시점에 한 번 불리므로 여기서 터지면 앱 전체가 못 뜬다.
export function resolveLocale(): SupportedLocale {
  try {
    return getLocales()[0]?.languageCode === 'ko' ? 'ko' : 'en';
  } catch {
    return 'ko';
  }
}

// 고른 설정값과 실제 적용 언어를 따로 든다 — 명시 'ko' 와 기기 ko 는 결과가 같아 결과로 설정을 복원할 수 없다.
let currentPref: LocalePref = 'system';
let current: SupportedLocale = resolveLocale();

export function getLocale(): SupportedLocale {
  return current;
}

export function getLocalePref(): LocalePref {
  return currentPref;
}

// 저장값을 적용하고 정규화한 설정값을 돌려준다. null·미지원 값('ja'·'zh-Hant' 등)은 'system'.
// 이미 그려진 화면은 스스로 다시 그려지지 않는다 — 반환값을 App 의 setLocalePref 에 넘겨 재렌더한다.
// 'system' 의 기기 언어는 호출 시점에 한 번만 읽는다 — 앱 실행 중 기기 언어를 바꾸고 돌아와도 콜드 스타트
// 전까지는 반영하지 않는다(iOS 는 언어를 바꾸면 앱이 종료되고, Android 는 프로세스가 살아 있으면 구 언어 유지).
// 언어 화면 계약: 'ko'|'en'|'system' 을 AsyncStorage LOCALE_KEY 에 저장하고(키를 지우지 않는다)
// setLocalePref(applyLocalePref(값)) 으로 재렌더한다. 현재 선택 표시는 getLocale() 이 아니라 getLocalePref().
export function applyLocalePref(raw: string | null | undefined): LocalePref {
  const pref: LocalePref =
    raw && (SUPPORTED_LOCALES as readonly string[]).includes(raw)
      ? (raw as SupportedLocale)
      : 'system';
  currentPref = pref;
  current = pref === 'system' ? resolveLocale() : pref;
  return pref;
}

const lookup = (locale: SupportedLocale, key: string): any =>
  key.split('.').reduce((node: any, part) => node?.[part], tables[locale]);
// 현재 언어나 en 표에 문자열 값이 있는지 — t() 의 «미존재 키는 키 반환» 과 값 비교하지 않고 직접 본다.
const has = (key: string): boolean =>
  typeof (lookup(current, key) ?? lookup('en', key)) === 'string';

// 현재 언어 표 → en 표 순으로 찾고, 어디에도 없으면 키를 그대로 돌려준다(빈 화면보다 찾기 쉽다).
export function t(key: string, vars: Record<string, string | number> = {}): string {
  let node = lookup(current, key) ?? lookup('en', key);
  // 복수 객체 판별은 other 가 문자열일 때만 — other 라는 하위 네임스페이스와 헷갈리지 않게.
  if (node && typeof node === 'object' && typeof node.other === 'string')
    node = vars.count === 1 ? node.one : node.other;
  if (typeof node !== 'string') return key;
  return node.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars[name] ?? ''));
}

// 서버 오류 → 화면 문구. 분기 순서는 Screens.tsx serverErrorText 와 같다. 서버 message 는 늘 한국어라
// ko 에서만 그대로 쓰고, 다른 언어는 errors.<code> 번역(없으면 다음 분기·GENERIC)으로 바꾼다.
// errors 의 ko 값은 business-api ApiErrorCode 문구 그대로다 — GENERIC 과 앱이 덮어쓰는
// SLUG_NOT_FOUND·INVITATION_EXPIRED·STATE_CONFLICT(VERSION_CONFLICT 겸용)·REQUEST_IN_PROGRESS 만 앱 문구.
export function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return t('errors.GENERIC');
  const { code } = err;
  const key = `errors.${code}`;
  const serverText = current === 'ko' ? err.message : has(key) ? t(key) : '';
  if (code === CLIENT_STALE_SESSION) return '';
  if (code === 'SLUG_NOT_FOUND' || code === 'INVITATION_EXPIRED')
    return has(key) ? t(key) : t('errors.GENERIC');
  if (code === 'FORBIDDEN' && serverText) return serverText;
  if (code === 'STATE_CONFLICT' || code === 'VERSION_CONFLICT') return t('errors.STATE_CONFLICT');
  if (code === 'REQUEST_IN_PROGRESS' || err.retryable) return t('errors.REQUEST_IN_PROGRESS');
  return serverText || t('errors.GENERIC');
}

// 언어별 값(이미지 require 쌍 등)을 고른다. 현재 언어 값이 없으면 en.
export function localized<T>(byLocale: Record<SupportedLocale, T>): T {
  return byLocale[current] ?? byLocale.en;
}
