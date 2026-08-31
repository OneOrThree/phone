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

i18n.locale = resolveLocale();

// 화면에서 쓰는 번역 함수. 키는 점 표기(예: 'login.kakao').
// 치환값은 두 번째 인자로 넘긴다 — t('focus.minutes', { count: 25 }).
export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}
