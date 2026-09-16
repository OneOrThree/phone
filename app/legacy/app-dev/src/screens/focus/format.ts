// 집중 플로우 시간 포맷터 — 타이머(06~08)·과목 누적(02)·친구 경과(09) 공용.
import { hms } from '@/utils/timeFormat';
import { localDateStr } from '@/utils/localDate';
import { kstTodayDate } from '@/screens/stats/format';

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

// 이번 주 월~일 날짜('YYYY-MM-DD') 배열 — 결과 화면의 주간 막대·스트릭 칸 키.
// 축은 KST(GROMO-1236 P2 3라운드) — 주간 합계(getFocusPeriodStats WEEK)·heatmap 셀이 KST
// 주/버킷이라, 키가 로컬 주면 비KST 기기에서 헤더 합계와 막대가 서로 다른 주를 가리킨다.
// (종전 FocusResultScreen 내장 헬퍼를 테스트 가능하게 이곳으로 이동.)
export function thisWeekDates(): string[] {
  const now = kstTodayDate();
  const dow = now.getDay(); // 0=일..6=토
  const toMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + toMonday);
  return Array.from({ length: 7 }, (_, i) =>
    localDateStr(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)),
  );
}
