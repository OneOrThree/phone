// 시간 길이·숫자·날짜 표기 규칙을 언어별로 한곳에 둔다(호출부 교체는 화면 티켓에서 한다).
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
