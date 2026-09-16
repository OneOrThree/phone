// 리그 화면 공용 포맷터
import { fmtMinutes, hms } from '@/utils/timeFormat';

// 분/초 → "21:35:00" 디지털 표기 — 통계·집중과 공유하게 @/utils/timeFormat으로 승격, 재수출.
// fmtMinutes(분, 초는 :00 고정) · hms(초, 실초까지) — 리그 시간은 초 원본이라 hms 사용(GROMO-665).
export { fmtMinutes, hms };

// 나 대비 차이 표기(초) — "+02:12:34"(나보다 앞섬) / "-00:40:23"(뒤짐)
export function fmtDelta(deltaSeconds: number): string {
  if (deltaSeconds === 0) return '00:00:00';
  return (deltaSeconds > 0 ? '+' : '-') + hms(Math.abs(deltaSeconds));
}
