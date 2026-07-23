// 재로그인 복원용 — 오늘 세션을 서버에서 받아 집중초를 합산한다(GROMO-677).
// 업로드(settleFocusBlock)가 집중 블록 구간 [startedAt, endedAt]만 실어 보내므로
// endedAt - startedAt = 그 블록의 집중초. '오늘' 판정은 로컬 정산과 동일하게 종료 시점 기준 —
// 서버 조회(/focus-session)는 startedAt 필터라 자정 걸친 세션이 잘리므로, 어제 자정부터
// 받아와 endedAt이 오늘(로컬 자정 이후)인 것만 남긴다(리뷰 반영).
import { getAllFocusSessions, getFocusTags } from '@/services/focusApi';
import type { FocusSessionResponse, FocusTagResponse } from '@/types/dto/focus';

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

// 복원 스냅샷(오늘 세션+태그) 통합 조회(GROMO-920) — Focus·Subject 컨텍스트가 각자 조회하면
// 같은 요청이 중복되고 '오늘' 판정 시각도 달라져 자정 경계에서 홈 총합·과목별 합이 어긋날 수 있다.
// 실패는 부분별 null — 세션 조회가 실패해도 태그(과목 목록) 복원은 살리는 기존 동작 유지.
export interface TodayFocusRestore {
  sessions: FocusSessionResponse[] | null;
  tags: FocusTagResponse[] | null;
}

let restoreInflight: Promise<TodayFocusRestore> | null = null;

// 진행 중 요청(in-flight)만 공유하고 완료되면 비운다 — 영구 캐시면 재로그인 리마운트가
// 이전 계정 스냅샷을 재사용할 수 있어서다(프로바이더는 로그아웃·계정 전환 시 리마운트됨).
// 태그 실패는 세션 조회를 기다리지 않고 즉시 확정(코덱스 P2) — 태그 없인 두 컨텍스트 모두
// 세션을 쓸 수 없는데 느린 세션 조회가 ready(OrphanFocusSettler 대기)를 붙들지 않게.
export function fetchTodayFocusRestore(): Promise<TodayFocusRestore> {
  if (!restoreInflight) {
    const p: Promise<TodayFocusRestore> = Promise.all([
      fetchTodayFocusSessions().catch(() => null),
      getFocusTags(),
    ])
      .then(([sessions, tags]) => ({ sessions, tags }))
      .catch(() => ({ sessions: null, tags: null }))
      .finally(() => {
        // abort 후 새로 시작된 in-flight를 지우지 않게 자기 자신일 때만 해제
        if (restoreInflight === p) restoreInflight = null;
      });
    restoreInflight = p;
  }
  return restoreInflight;
}

// 로그아웃·계정 전환 시 공유 중인 복원을 폐기한다(코덱스 P1) — 이전 계정 토큰으로 시작된
// in-flight를 새 계정 프로바이더가 재사용해 이전 계정 세션·과목이 노출되는 누출 방지.
// 나가 있는 요청 자체는 중단하지 않는다(응답은 버려짐) — 다음 호출이 새로 조회한다.
export function abortFocusRestore(): void {
  restoreInflight = null;
}
