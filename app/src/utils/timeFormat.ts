// 시간 표기 공용 포맷터 — 리그·프로필·통계가 공유(00:00:00 표기 통일, 티켓 690·691 계열).
// (league/format.ts에서 승격 — 2개 feature 이상 사용 시 전역 이동 규칙)

// 분 → 디지털 표기 "21:35:00" (시:분:초 — 분 단위 데이터라 초는 00 고정)
export function fmtMinutes(totalMinutes: number): string {
  const t = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(t / 60);
  const m = Math.round(t % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

// 세로축 눈금 상한 — 최대치를 보기 좋은 값(30m 단위→h 단위)으로 올림해 그리드 라벨·막대 정규화
// 기준으로 쓴다(절반 눈금도 정수 분). 리그 비교 차트(DuoDayChart)·통계 막대 차트 공용(GROMO-691/761).
const AXIS_STEPS = [30, 60, 120, 180, 240, 300, 360, 480, 600, 720];
export function axisCeil(maxMinutes: number): number {
  return AXIS_STEPS.find((step) => step >= maxMinutes) ?? Math.ceil(maxMinutes / 120) * 120;
}

// 분 → 축 라벨 ("30m" / "1h" / "1h30m")
export function fmtAxis(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}
