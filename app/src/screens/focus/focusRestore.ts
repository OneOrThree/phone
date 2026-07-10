// 재로그인 복원용 — 오늘 세션을 서버에서 받아 집중초를 합산한다(GROMO-677).
// 업로드(settleFocusBlock)가 집중 블록 구간 [startedAt, endedAt]만 실어 보내므로
// endedAt - startedAt = 그 블록의 집중초. 오늘 범위는 기기 로컬 자정 기준(localDate와 동일).
import { getFocusSessions } from '@/services/focusApi';
import type { FocusSessionResponse } from '@/types/dto/focus';

export async function fetchTodayFocusSessions(): Promise<FocusSessionResponse[]> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const from = midnight.toISOString();
  const to = new Date().toISOString();
  const all: FocusSessionResponse[] = [];
  let cursor: string | undefined;
  // 커서 페이지네이션 — 하루 세션이 이 상한을 넘을 일은 없고, 무한 루프만 방지
  for (let page = 0; page < 10; page++) {
    const slice = await getFocusSessions(from, to, 100, cursor);
    all.push(...slice.content);
    if (!slice.hasNext || !slice.nextCursor) break;
    cursor = slice.nextCursor;
  }
  return all;
}

// 세션 1건의 집중초 — 시계가 뒤로 간 비정상 레코드는 0 처리.
export function sessionFocusSeconds(s: FocusSessionResponse): number {
  const ms = Date.parse(s.endedAt) - Date.parse(s.startedAt);
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}
