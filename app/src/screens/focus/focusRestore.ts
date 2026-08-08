// 재로그인 복원용 — 오늘 세션을 서버에서 받아 집중초를 합산한다(GROMO-677).
// 업로드(settleFocusBlock)가 집중 블록 구간 [startedAt, endedAt]만 실어 보내므로
// (endedAt − startedAt) − totalDistractionSeconds = 그 블록의 집중초(GROMO-1214 코드리뷰 ⑥ —
// 구간에는 일시정지가 섞여 있어 방해 초를 빼야 서버 집계와 같다). 여기서는 '오늘에 걸친' 세션을 모으기만 한다 —
// 서버 조회(/focus-session)는 startedAt 필터라 자정 걸친 세션이 잘리므로, 어제 자정부터
// 받아와 endedAt이 오늘(로컬 자정 이후)인 것만 남긴다(리뷰 반영). 자정을 걸친 세션은 어제 몫이
// 섞여 있으니, '오늘 집중'으로 적립하는 쪽(FocusContext·SubjectContext)은 세션 전체 길이가
// 아니라 sessionTodayFocusSeconds로 오늘 몫만 더한다(GROMO-1252).
import { getAllFocusSessions, getFocusTags } from '@/services/focusApi';
import { todayOverlapSeconds } from '@/utils/localDate';
import type { FocusSessionResponse, FocusTagResponse } from '@/types/dto/focus';

export async function fetchTodayFocusSessions(): Promise<FocusSessionResponse[]> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const fromDate = new Date(midnight);
  fromDate.setDate(fromDate.getDate() - 1);
  const all = await getAllFocusSessions(fromDate.toISOString(), new Date().toISOString());
  return all.filter((s) => Date.parse(s.endedAt) >= midnight.getTime());
}

// 세션 기여분에서 방해(일시정지) 비율만큼을 뺀다(GROMO-1214 코드리뷰 ⑥).
//   기여분 = 겹침초 × (1 − totalDistractionSeconds / (endedAt − startedAt)), 하한 0
// 서버가 daily_focus_stats·by-category·챌린지 창 집계에서 쓰는 것과 **같은 공식**이다. 앱이
// 세션 구간을 그대로 합하면(종전) 일시정지 시간만큼 부풀어, 서버가 확정한 값(리그 주간 랭킹·
// 홈 오늘 집중)과 어긋난다. 세션 전체가 대상이면 기여분은 정확히 '구간 − 방해초'가 된다.
function minusDistraction(overlapSeconds: number, s: FocusSessionResponse): number {
  const duration = (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000;
  if (!(duration > 0) || !(s.totalDistractionSeconds > 0)) return overlapSeconds;
  return Math.max(
    0,
    overlapSeconds - Math.round((overlapSeconds * s.totalDistractionSeconds) / duration),
  );
}

// 세션 1건의 집중초(구간 전체 − 방해초) — 시계가 뒤로 간 비정상 레코드는 0 처리.
// 날짜로 자르지 않는 값이다: 최장 세션(LongestSessionStat)·리그 주간 합산처럼 세션 자체의
// 길이가 필요한 곳 전용. '오늘 몫'이 필요하면 sessionTodayFocusSeconds를 쓴다(GROMO-1252).
export function sessionFocusSeconds(s: FocusSessionResponse): number {
  const ms = Date.parse(s.endedAt) - Date.parse(s.startedAt);
  return ms > 0 ? minusDistraction(Math.floor(ms / 1000), s) : 0;
}

// 세션 1건의 '오늘 몫' 집중초 — 자정을 걸친 세션은 오늘 겹침만 세고(GROMO-1252), 거기서
// 방해 비율만큼을 뺀다(GROMO-1214 ⑥). 재로그인 복원(FocusContext·SubjectContext) 전용 —
// 두 컨텍스트가 같은 함수를 써야 과목 합 == 홈 총합이 유지된다.
export function sessionTodayFocusSeconds(s: FocusSessionResponse): number {
  return minusDistraction(todayOverlapSeconds(s.startedAt, s.endedAt), s);
}

// 복원 스냅샷(오늘 세션+태그) 통합 조회(GROMO-920) — Focus·Subject 컨텍스트가 각자 조회하면
// 같은 요청이 중복되고 '오늘' 판정 시각도 달라져 자정 경계에서 홈 총합·과목별 합이 어긋날 수 있다.
// 실패는 부분별 null — 세션 조회가 실패해도 태그(과목 목록) 복원은 살리는 기존 동작 유지.
export interface TodayFocusRestore {
  sessions: FocusSessionResponse[] | null;
  tags: FocusTagResponse[] | null;
}

let restoreShared: Promise<TodayFocusRestore> | null = null;
// 폐기 세대 — abort 이후 도착한 이전 세대의 결과를 소비자 단에서 무효화한다(tagSync와 같은 방식)
let restoreGeneration = 0;

// 공유 스냅샷은 완료 후에도 유지한다(코덱스 리뷰) — 한쪽 프로바이더의 로컬 로드가 늦어 첫 조회가
// 끝난 뒤에 호출돼도, 재조회 없이 같은 스냅샷으로 계산해 홈 총합·과목별 합의 일치를 지킨다.
// 해제는 로그아웃·계정 전환의 abortFocusRestore()가 담당(프로바이더도 그때 리마운트됨).
// 태그 실패는 세션 조회를 기다리지 않고 즉시 확정(코덱스 리뷰) — 태그 없인 두 컨텍스트 모두
// 세션을 쓸 수 없는데 느린 세션 조회가 ready(OrphanFocusSettler 대기)를 붙들지 않게.
export function fetchTodayFocusRestore(): Promise<TodayFocusRestore> {
  if (!restoreShared) {
    const gen = restoreGeneration;
    restoreShared = Promise.all([fetchTodayFocusSessions().catch(() => null), getFocusTags()])
      .then(([sessions, tags]) =>
        // abort가 끼어든 조회는 실패로 강등(코덱스 리뷰) — 이미 await로 붙어 있던 이전 계정
        // 프로바이더가 낡은 스냅샷을 화면에 적용하고 persist effect로 로컬에 되쓰지 않게.
        gen === restoreGeneration ? { sessions, tags } : { sessions: null, tags: null },
      )
      .catch(() => ({ sessions: null, tags: null }));
  }
  return restoreShared;
}

// 로그아웃·계정 전환 시 공유 스냅샷을 폐기한다(코덱스 리뷰) — 캐시를 비워 새 계정 프로바이더가
// 이전 계정 데이터를 재사용하지 않게 하고, 진행 중이던 조회는 세대 증가로 결과를 무효화한다.
// 나가 있는 요청 자체는 중단하지 않는다(응답은 버려짐) — 다음 호출이 새로 조회한다.
// 호출 순서 주의: App.tsx의 스토리지 클리어(multiRemove)보다 항상 먼저 실행돼야
// '클리어 후 이전 계정 결과 되쓰기' 경로가 막힌다(현재 두 호출부 모두 충족).
export function abortFocusRestore(): void {
  restoreGeneration++;
  restoreShared = null;
}
