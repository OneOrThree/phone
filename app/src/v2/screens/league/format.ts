// 리그 화면 공용 포맷터

// 분 → 디지털 표기 "21:35:00" (시:분:초 — 분 단위 데이터라 초는 00 고정)
export function fmtMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

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
