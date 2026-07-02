// 리그 화면 공용 포맷터

// 분 → 시안 표기 "14h 20m" / "22h" / "45m"
export function fmtMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
