// 시간 길이·숫자·날짜·섬 이름 표기 규칙을 언어별로 한곳에 둔다(호출부 교체는 화면 티켓에서 한다).
import { getLocale, t } from './index';

export const localeTag = (): 'ko-KR' | 'en-US' => (getLocale() === 'ko' ? 'ko-KR' : 'en-US');

// 1시간 미만은 분만, 딱 떨어지는 시간은 시간만, 나머지는 시간+분(ko 는 model.ts hoursMinutes 와 같은 글자).
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m < 60) return t('time.minutes', { m });
  return m % 60
    ? t('time.hoursMinutes', { h: Math.floor(m / 60), m: m % 60 })
    : t('time.hours', { h: m / 60 });
}

export const formatNumber = (n: number) => n.toLocaleString(localeTag());

export const formatDate = (d: Date, opts?: Intl.DateTimeFormatOptions) =>
  d.toLocaleDateString(localeTag(), opts);

/** 내 고양이 이름표 — 닉네임이 비면 「나」/「Me」 (GROMO-2475) */
export const ownCatName = (name: string) => name.trim() || t('focusFlow.common.me');

/**
 * 섬 이름 표기 — ko 「바다」 → 「바다섬」, en 「Sea」 → 「Sea Island」. 이미 「섬」·「Island」로 끝나면 그대로 둔다
 * (「바다섬섬」·「Sea Island Island」 방지, 구현계획 M6). 섬 이름을 문장에 넣는 문구는 전부 이 함수를 거치고,
 * 번역 키의 {{name}} 뒤에 섬/Island 를 직접 붙이지 않는다 — 접미를 붙이는 키는 이 함수가 쓰는
 * `magazine.islandTitle` 하나뿐이다(DESIGN.md §8.18).
 */
export function islandTitle(name: string): string {
  const n = name.trim();
  return /(섬|island)$/i.test(n) ? n : t('magazine.islandTitle', { name: n });
}
