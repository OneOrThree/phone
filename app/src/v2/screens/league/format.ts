// 리그 화면 공용 포맷터

// 분 → 시안 표기 "38h 20m" / "12h 05m" / "45m" (시간이 있으면 분은 2자리 패딩)
export function fmtMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}
