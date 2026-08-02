// 세션 저장 응답의 서버 스트릭 판정 공유(GROMO-807) — 세션 화면이 발행하고 결과 화면이 구독한다.
// 업로드는 fire-and-forget이라 결과 화면 진입 '후에' 응답이 도착할 수 있어, 내비게이션 파라미터가
// 아닌 모듈 구독(goalCelebration과 같은 패턴)으로 전달하고 도착 시 화면을 갱신한다.
// 메모리 보관만 한다 — 판정은 그날 하루짜리 값이라 영속화하면 자정 넘김·재설치 오염만 생긴다.
//
// ⚠️ 오프라인 대기열(GROMO-614) flush 성공 시에는 발행하지 않는다 — 어제 실패분이 오늘 flush되면
// 응답의 '그날 누적'이 어제 기준이라 오늘 판정으로 쓰면 오염된다. 그 경로는 기존 추정 판정이 폴백.
import type { FocusSessionSaveResponse } from '@/types/dto/focus';
import { todayStr } from '@/utils/localDate';

export interface SessionSaveVerdict {
  date: string; // 수신한 로컬 날짜(YYYY-MM-DD) — 자정을 넘긴 잔존 판정이 다음 날로 새지 않게 소비처에서 대조
  dayTotalFocusSeconds: number;
  streakQualifiedToday: boolean;
  // 이 세션 저장으로 지급된 시간조각(서버 응답). 결과 화면 +N ⏳ 연출용. 미구현/미도착 시 undefined.
  // ⚠️ 뽀모도로는 블록마다 저장돼 응답이 여러 번 오지만, 아래 단조증가 가드로 '가장 큰 누적'을 실은
  // 응답만 남는다 — 즉 여기 재화도 그 응답 1건 기준이라 블록별 합산이 아니다(BE 지급 설계에 맞춰 재검토).
  awardedCoins?: number;
  goalRewardCoins?: number; // 목표 달성 보너스 시간조각(>0일 때만 표기)
}

let current: SessionSaveVerdict | null = null;
const listeners = new Set<() => void>();

export function subscribeSessionSaveVerdict(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// useSyncExternalStore 스냅샷 — 같은 참조를 유지해야 하므로 여기서 날짜 필터링하지 않는다(소비처 몫).
export function getSessionSaveVerdict(): SessionSaveVerdict | null {
  return current;
}

// 저장 성공 응답 반영 — 뽀모도로는 블록마다 업로드하므로 응답이 여러 번, 순서 보장 없이 도착할 수
// 있다. 그날 누적은 단조증가라 큰 값만 남기면 늦게 도착한 이전 블록 응답이 최신 판정을 덮지 않는다.
export function publishSessionSaveVerdict(res: FocusSessionSaveResponse): void {
  // 구버전 백엔드(빈 바디 201) 방어 — 필드가 없으면 발행하지 않고 추정 판정 폴백을 유지한다.
  if (
    typeof res?.dayTotalFocusSeconds !== 'number' ||
    typeof res?.streakQualifiedToday !== 'boolean'
  )
    return;
  const next: SessionSaveVerdict = {
    date: todayStr(),
    dayTotalFocusSeconds: res.dayTotalFocusSeconds,
    streakQualifiedToday: res.streakQualifiedToday,
    awardedCoins: res.awardedCoins,
    goalRewardCoins: res.goalRewardCoins,
  };
  if (
    current &&
    current.date === next.date &&
    current.dayTotalFocusSeconds >= next.dayTotalFocusSeconds
  )
    return;
  current = next;
  listeners.forEach((listener) => listener());
}
