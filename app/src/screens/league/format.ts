// 리그 화면 공용 포맷터
import { fmtMinutes } from '@/utils/timeFormat';

// 분 → "21:35:00" 디지털 표기 — 통계와 공유하게 @/utils/timeFormat으로 승격, 기존 소비처용 재수출.
export { fmtMinutes };

// 분 → "35h 02m" — 프로필 상세 요약·비교 카드 표기(시안 표기 그대로). 1시간 미만은 "40m"
export function fmtHourMin(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

// 나 대비 차이 표기 — "+02:12:00"(나보다 앞섬) / "-00:40:00"(뒤짐)
export function fmtDelta(deltaMinutes: number): string {
  if (deltaMinutes === 0) return '00:00:00';
  return (deltaMinutes > 0 ? '+' : '-') + fmtMinutes(Math.abs(deltaMinutes));
}
