/**
 * 집중 세션 도메인 모듈(GROMO-2009). 공개 business-api 의 무접두 경로만 부른다 —
 * `/internal/**`·`/api/v1/**`·data-api 직접 호출은 범위 밖이다.
 *
 * 계약(`docs/prd/fishcat/focus-rest-session/low-level-design.md` §2):
 *  - `POST /focus-sessions`                       시작. `Idempotency-Key`(UUID36) 필수,
 *                                               body `{islandId, subject, targetMinutes?}`.
 *  - `GET  /focus-sessions/current`              진행 세션. 없으면 `data:null`(404 아님).
 *  - `POST /focus-sessions/{id}/pause|resume`    body `{expectedVersion}` 한 필드 + 키 필수.
 *  - `POST /focus-sessions/{id}/finish`          body `{expectedVersion}` + 키 필수 → 정산 뷰.
 *  - `GET  /focus-sessions/pending-result`       서버 자동 종료의 미확인 결과. 없으면 data:null.
 *  - `POST /focus-sessions/{id}/acknowledge`     결과 확인. 본문·키 없음 — 서버 조건부 UPDATE 가 멱등.
 *
 * 쓰기 의도마다 `Idempotency-Key` 는 호출부가 의도당 한 번 만든다 — 응답 유실·재시도는
 * **같은 키와 같은 body** 로 보낸다(어댑터가 키를 만들면 유실 재호출 때 멱등이 깨진다).
 */
import { request } from './client';

/** 진행 세션 뷰 — 시각 필드는 UTC ISO-8601 문자열이다. */
export type FocusSessionView = {
  id: string;
  islandId: string;
  subject: string;
  targetMinutes: number | null;
  status: 'active' | 'paused';
  /** serverNow 시점의 순수 집중 초 — 휴식은 들어가지 않는다. */
  activeSeconds: number;
  serverNow: string;
  startedAt: string;
  restStartedAt: string | null;
  /** pause/resume/finish 의 expectedVersion. 전이마다 +1. */
  version: number;
  /**
   * ACTIVE 구간 목록(GROMO-2131) — 없으면 구버전 서버라 undefined 로 둔다(퀘스트 집계는
   * 기존처럼 seconds 로 뭉뚱그린다). 마지막 구간이 열려 있어도 서버가 serverNow 로 닫아 보낸다.
   */
  activeIntervals?: { startedAt: string; endedAt: string }[];
};

/** finish·pending-result 공용 정산 뷰 — earnedFish·allocation 은 서버 확정값이다. */
export type FocusFinishView = {
  /** 완료 기록 id(= sessionId) — acknowledge 경로에 이 값을 쓴다. */
  recordId: string;
  islandId: string;
  subject: string;
  targetMinutes: number | null;
  activeSeconds: number;
  goalAchieved: boolean;
  earnedFish: number;
  allocation: { personalFishAdded: number; constructionFishAdded: number };
  completedAt: string;
  questProgress: { id: string; myRate: number }[];
  /** ACTIVE 구간 목록(GROMO-2131) — 전부 닫힌 구간. 없으면 구버전 서버. */
  activeIntervals?: { startedAt: string; endedAt: string }[];
};

export type FocusSessionStartInput = {
  islandId: string;
  subject: string;
  /** 선택 — 없으면 키 자체를 생략한다(명시적 null 금지). */
  targetMinutes?: number;
};

/** 진행 세션이 없으면 null 이 정상값이다(`data:null`). */
export function currentFocusSession(): Promise<FocusSessionView | null> {
  return request<FocusSessionView | null>('/focus-sessions/current');
}

/** 자동 종료된 미확인 결과 — 없으면 null 이 정상값이다. */
export function pendingFocusResult(): Promise<FocusFinishView | null> {
  return request<FocusFinishView | null>('/focus-sessions/pending-result');
}

export function startFocusSession(
  input: FocusSessionStartInput,
  idempotencyKey: string,
): Promise<FocusSessionView> {
  return request<FocusSessionView>('/focus-sessions', {
    method: 'POST',
    idempotencyKey,
    body: input,
  });
}

const versioned = (expectedVersion: number, idempotencyKey: string) => ({
  method: 'POST' as const,
  idempotencyKey,
  body: { expectedVersion },
});

export function pauseFocusSession(
  sessionId: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<FocusSessionView> {
  return request<FocusSessionView>(
    `/focus-sessions/${encodeURIComponent(sessionId)}/pause`,
    versioned(expectedVersion, idempotencyKey),
  );
}

export function resumeFocusSession(
  sessionId: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<FocusSessionView> {
  return request<FocusSessionView>(
    `/focus-sessions/${encodeURIComponent(sessionId)}/resume`,
    versioned(expectedVersion, idempotencyKey),
  );
}

export function finishFocusSession(
  sessionId: string,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<FocusFinishView> {
  return request<FocusFinishView>(
    `/focus-sessions/${encodeURIComponent(sessionId)}/finish`,
    versioned(expectedVersion, idempotencyKey),
  );
}

/**
 * 결과 1회 표시의 확인 — 본문·멱등 키 없음(서버 `acknowledged_at IS NULL` 조건부 UPDATE 가
 * 최초 1회만 세팅해 재시도가 무해하다).
 */
export function acknowledgeFocusResult(sessionId: string): Promise<null> {
  return request<null>(`/focus-sessions/${encodeURIComponent(sessionId)}/acknowledge`, {
    method: 'POST',
  });
}
