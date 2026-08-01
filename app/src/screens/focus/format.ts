// 집중 플로우 시간 포맷터 — 타이머(06~08)·과목 누적(02)·친구 경과(09) 공용.
import { hms } from '@/utils/timeFormat';

// 초 → HH:MM:SS (큰 타이머용, 예: 00:42:15) — 통계(최장 세션)와 공유하게 @/utils/timeFormat으로
// 승격, 기존 소비처용 재수출(fmtMinutes 승격과 동일 패턴).
export { hms };

// 2자리 0패딩
function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// H:MM:SS (시 자리 가변) — 과목 누적표시용. 예: 12:30:00, 0:50:22
export function hmsCompact(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${pad(m)}:${pad(s % 60)}`;
}
