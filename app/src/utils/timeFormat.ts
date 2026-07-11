// 시간 표기 공용 포맷터 — 리그·프로필·통계가 공유(00:00:00 표기 통일, 티켓 690·691 계열).
// (league/format.ts에서 승격 — 2개 feature 이상 사용 시 전역 이동 규칙)

// 분 → 디지털 표기 "21:35:00" (시:분:초 — 분 단위 데이터라 초는 00 고정)
export function fmtMinutes(totalMinutes: number): string {
  const t = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(t / 60);
  const m = Math.round(t % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}
