// 리그 화면 공용 포맷터

// 분 → 시안 표기 "38h 20m" / "12h 05m" / "45m" (시간이 있으면 분은 2자리 패딩)
export function fmtMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

// 나 대비 차이 표기 — "+2h 12m"(나보다 앞섬) / "-40m"(뒤짐) / "±0m"
export function fmtDelta(deltaMinutes: number): string {
  if (deltaMinutes === 0) return '±0m';
  return (deltaMinutes > 0 ? '+' : '-') + fmtMinutes(Math.abs(deltaMinutes));
}
