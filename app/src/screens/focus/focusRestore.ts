// 재로그인 복원용 — 오늘 세션을 서버에서 받아 집중초를 합산한다(GROMO-677).
// 업로드(settleFocusBlock)가 집중 블록 구간 [startedAt, endedAt]만 실어 보내므로
// endedAt - startedAt = 그 블록의 집중초. 여기서는 '오늘에 걸친' 세션을 모으기만 한다 —
// 서버 조회(/focus-session)는 startedAt 필터라 자정 걸친 세션이 잘리므로, 어제 자정부터
// 받아와 endedAt이 오늘(로컬 자정 이후)인 것만 남긴다(리뷰 반영). 자정을 걸친 세션은 어제 몫이
// 섞여 있으니, '오늘 집중'으로 적립하는 쪽(FocusContext·SubjectContext)은 세션 전체 길이가
// 아니라 todayRestoreSeconds로 오늘 몫만 더한다(GROMO-1252).
import { getAllFocusSessions, getFocusTags } from '@/services/focusApi';
import { todayOverlapSeconds } from '@/utils/localDate';
import { serverTodayStr, serverZoneAlignedWithLocal } from '@/utils/serverZone';
import type { FocusSessionResponse, FocusTagResponse } from '@/types/dto/focus';

export async function fetchTodayFocusSessions(): Promise<FocusSessionResponse[]> {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const fromDate = new Date(midnight);
  fromDate.setDate(fromDate.getDate() - 1);
  const all = await getAllFocusSessions(fromDate.toISOString(), new Date().toISOString());
  return all.filter((s) => Date.parse(s.endedAt) >= midnight.getTime());
}

// 세션 1건의 집중초(구간 전체 길이) — 시계가 뒤로 간 비정상 레코드는 0 처리.
// 날짜로 자르지 않는 값이다: 최장 세션(LongestSessionStat)·리그 주간 합산처럼 세션 자체의
// 길이가 필요한 곳 전용. '오늘 몫'이 필요하면 todayOverlapSeconds를 쓴다(GROMO-1252).
export function sessionFocusSeconds(s: FocusSessionResponse): number {
  const ms = Date.parse(s.endedAt) - Date.parse(s.startedAt);
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}

// 세션 1건이 '오늘'(기기 로컬 자정 기준)에 기여한 집중초 — 복원 적립(FocusContext 총합·과목별 누적) 전용.
//
// 서버가 완료 시점에 확정한 날짜별 분포(focusSecondsByDate)를 내려줬으면 그걸 쓴다(GROMO-1252 3차 ①) —
// 사전집계(DailyFocusStat)에 가산한 바로 그 값이라, 일시정지가 자정을 걸친 세션(23:50~23:55 집중 →
// 일시정지 → 00:10~00:15 집중)에서 구간 겹침 추정(900초)이 아니라 실제 몫(300초)이 된다.
//
// 다만 서버 분포의 날짜 축은 **서버 존**(프로필 응답의 timeZone — utils/serverZone)이고 이 값의 소비처는
// 기기 로컬 자정 리셋 스토어다. 두 축이 어긋나면 인접 버킷 시간이 섞이므로, 경계가 겹칠 때만
// (serverZoneAlignedWithLocal) 서버 분포를 쓰고 그 외에는 종전 겹침 추정으로 폴백한다.
// 3·4차엔 게이트가 KST 하드코딩(kstLocalSameDay)이라 서버 존이 KST가 아닌 유저가 양쪽으로 틀렸다(5차 ①):
// GB 유저 + 런던 기기는 게이트가 닫혀 정확한 분포를 버렸고, GB 유저 + KST 기기는 게이트가 열린 채
// 런던 키 맵을 KST 날짜로 인덱싱했다. 이제 게이트가 서버 존 기준이고, 키도 같은 축(serverTodayStr)에서 뽑는다
// — 게이트가 열렸다면 두 축의 벽시계가 같아 로컬 '오늘'과 같은 날짜 문자열이다.
export function todayRestoreSeconds(s: FocusSessionResponse): number {
  if (s.focusSecondsByDate && serverZoneAlignedWithLocal()) {
    return s.focusSecondsByDate[serverTodayStr()] ?? 0;
  }
  return todayOverlapSeconds(s.startedAt, s.endedAt);
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
