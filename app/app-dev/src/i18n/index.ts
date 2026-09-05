import { getLocales } from 'expo-localization';
import { I18n } from 'i18n-js';

import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zhHant from './locales/zh-Hant.json';

// 지원 언어 — 한국어(정본) · 영어 · 일본어 · 번체 중국어(대만/홍콩).
// 간체 중국어(본토)는 미지원이라 영어로 떨어진다.
export const SUPPORTED_LOCALES = ['ko', 'en', 'ja', 'zh-Hant'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

// 사용자가 설정 화면에서 고르는 값. 'system' = 기기 언어를 따른다(명시 선택 안 함).
export type LocalePref = 'system' | SupportedLocale;

// 언어 이름은 **자기표기**로 고정한다 — 어떤 언어로 앱을 보고 있든 일본어는 '日本語'가 맞다.
// (다국어 UI 정석이자, 번역 키를 4×4로 늘리지 않아도 되는 실리도 있다.)
export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  'zh-Hant': '繁體中文',
};

export const i18n = new I18n({ ko, en, ja, 'zh-Hant': zhHant });

// 번역 누락 시 ko가 아니라 en으로 떨어뜨린다 — 한국어를 모르는 사용자에게 한글이 튀는 것보다 낫다.
i18n.defaultLocale = 'en';
i18n.enableFallback = true;

// 기기 로케일 → 지원 언어. 확정 불가면 en.
export function resolveLocale(): SupportedLocale {
  const locale = getLocales()[0];
  if (!locale) return 'en';

  const language = locale.languageCode?.toLowerCase();
  if (language === 'ko') return 'ko';
  if (language === 'ja') return 'ja';
  if (language === 'zh') {
    // 번체 판정 — 스크립트 코드가 있으면 그걸 믿고, 없으면 지역으로 추정한다.
    const script = locale.languageScriptCode?.toLowerCase();
    if (script === 'hant') return 'zh-Hant';
    if (script === 'hans') return 'en';
    const region = locale.regionCode?.toUpperCase();
    return region === 'TW' || region === 'HK' || region === 'MO' ? 'zh-Hant' : 'en';
  }
  return 'en';
}

// 지금 실제로 적용 중인 언어. i18n.locale 은 타입이 그냥 string 이라 여기서 따로 들고 있다
// (LOCALE_NAMES[i18n.locale] 이 strict 모드에서 타입 에러가 나는 것을 피한다).
let current: SupportedLocale = resolveLocale();
i18n.locale = current;

// 사용자가 고른 설정값(정규화 후). 적용 언어(current)와 별개로 들고 있어야 한다 —
// 명시 'ko' 와 기기 언어 ko 는 적용 결과가 같아서, 결과로부터는 설정을 복원할 수 없다.
// (결과로 역추론하면 명시 'ko' 사용자가 '기기 언어 따름'으로 되돌아갈 길이 없어진다 — 코드리뷰)
let currentPref: LocalePref = 'system';

export function getLocale(): SupportedLocale {
  return current;
}

// 지금 적용돼 있는 설정값. 부팅 시 App.tsx 의 applyLocalePref 가 채운다.
export function getLocalePref(): LocalePref {
  return currentPref;
}

// 저장된 설정값을 적용한다. null·미지원 문자열은 전부 'system'(기기 언어 따름)으로 본다.
// 반환값은 정규화된 설정값 — 화면이 라디오 선택 상태로 쓴다.
//
// ⚠️ t()는 훅이 아니라서 이 함수만으로는 이미 그려진 화면이 다시 그려지지 않는다.
// 실제 화면 갱신은 LanguageScreen이 navigationRef.reset()으로 화면을 새로 마운트하는
// 쪽이 담당한다.
export function applyLocalePref(raw: string | null | undefined): LocalePref {
  const pref: LocalePref =
    raw && (SUPPORTED_LOCALES as readonly string[]).includes(raw)
      ? (raw as SupportedLocale)
      : 'system';
  currentPref = pref;
  current = pref === 'system' ? resolveLocale() : pref;
  i18n.locale = current;
  return pref;
}

// 화면에서 쓰는 번역 함수. 키는 점 표기(예: 'login.kakao').
// 치환값은 두 번째 인자로 넘긴다 — t('focus.minutes', { count: 25 }).
export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}
