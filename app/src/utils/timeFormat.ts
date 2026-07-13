// 시간 표기 공용 포맷터 — 리그·프로필·통계가 공유(00:00:00 표기 통일, 티켓 690·691 계열).
// (league/format.ts에서 승격 — 2개 feature 이상 사용 시 전역 이동 규칙)

// 분 → 디지털 표기 "21:35:00" (시:분:초 — 분 단위 데이터라 초는 00 고정)
export function fmtMinutes(totalMinutes: number): string {
  const t = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(t / 60);
  const m = Math.round(t % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

// 초 → 디지털 표기 "01:47:23" (시:분:초) — 집중 타이머·통계 최장 세션 공용
// (focus/format.ts에서 승격 — 2개 feature 이상 사용 시 전역 이동 규칙)
export function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// 세로축 눈금 상한 — 최대치를 보기 좋은 값으로 올림해 그리드 라벨·막대 정규화 기준으로 쓴다.
// 리그 비교 차트(DuoDayChart)·통계 막대 차트·집중 결과 차트 공용(GROMO-691/761/683).
// 데이터가 적을 때도 축이 데이터에 맞게 조여지도록 하한은 6분(GROMO-683). 모든 눈금은
// 6의 배수 — 절반(리그)·⅓(통계·결과) 분할 라벨이 전부 정수 분이 되게 유지할 것.
const AXIS_STEPS = [6, 12, 18, 30, 60, 120, 180, 240, 300, 360, 480, 600, 720];
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
