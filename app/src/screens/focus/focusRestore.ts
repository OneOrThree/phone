// 재로그인 복원용 — 오늘 세션을 서버에서 받아 집중초를 합산한다(GROMO-677).
// 업로드(settleFocusBlock)가 집중 블록 구간 [startedAt, endedAt]만 실어 보내므로
// endedAt - startedAt = 그 블록의 집중초. '오늘' 판정은 로컬 정산과 동일하게 종료 시점 기준 —
// 서버 조회(/focus-session)는 startedAt 필터라 자정 걸친 세션이 잘리므로, 어제 자정부터
// 받아와 endedAt이 오늘(로컬 자정 이후)인 것만 남긴다(리뷰 반영).
import { getAllFocusSessions } from '@/services/focusApi';
import type { FocusSessionResponse } from '@/types/dto/focus';

export async function fetchTodayFocusSessions(): Promise<FocusSessionResponse[]> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const fromDate = new Date(midnight);
  fromDate.setDate(fromDate.getDate() - 1);
  const all = await getAllFocusSessions(fromDate.toISOString(), new Date().toISOString());
  return all.filter((s) => Date.parse(s.endedAt) >= midnight.getTime());
}

// 세션 1건의 집중초 — 시계가 뒤로 간 비정상 레코드는 0 처리.
export function sessionFocusSeconds(s: FocusSessionResponse): number {
  const ms = Date.parse(s.endedAt) - Date.parse(s.startedAt);
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}
