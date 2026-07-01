// 온보딩 표시용 포맷 유틸.

// 분 → "N시간 M분". 0시간이면 "M분", 0분이면 "N시간".
export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}분`;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}
