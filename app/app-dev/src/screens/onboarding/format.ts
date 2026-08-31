// 온보딩 표시용 포맷 유틸.

import { t } from '@/i18n';

// 분 → "N시간 M분". 0시간이면 "M분", 0분이면 "N시간".
// 시간·분을 각각 번역 키로 뽑고 이어붙이는 문구도 키로 둔다 — CJK는 사이 공백을 안 쓰므로
// 언어별로 이음새를 바꿀 수 있어야 한다.
export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const minutes = t('onboarding.format.minutes', { count: m });
  if (h === 0) return minutes;
  const hours = t('onboarding.format.hours', { count: h });
  return m ? t('onboarding.format.hoursMinutes', { hours, minutes }) : hours;
}

// 한글 조사 선택 헬퍼(아래 eunNeun·iGa)는 번역 대상이 아니라 **한국어 문법 도구**다.
// ko 문구에서만 %{particle} 로 받아 쓰고, 다른 언어 문구는 그 치환값을 무시한다.

// 한글 주격/보조사 은/는 선택 — 마지막 글자 받침 있으면 '은', 없으면 '는'(한글 아니면 '는').
export function eunNeun(word: string): string {
  if (!word) return '는';
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return '는';
  return (code - 0xac00) % 28 !== 0 ? '은' : '는';
}

// 한글 주격조사 이/가 선택 — 받침 있으면 '이', 없으면 '가'(한글 아니면 '가').
export function iGa(word: string): string {
  if (!word) return '가';
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return '가';
  return (code - 0xac00) % 28 !== 0 ? '이' : '가';
}
