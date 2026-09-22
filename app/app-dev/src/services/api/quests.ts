/**
 * 섬 일일 퀘스트 공개 API (GROMO-2014, island-quests LLD §1·§2 — business-api
 * `IslandQuestController`). 무접두 경로이고 성공 봉투·오류 형태는 공통 client 가 벗긴다 —
 * 이 모듈은 정확한 path/body/키만 보증한다.
 *
 * - 진행률·수령 가능·달성·보너스는 응답 필드가 정본이다 — rate===100 으로 달성을 추정하거나
 *   보상량을 상수로 만들지 않는다.
 * - `windowStart`/`windowEnd`·`date` 의 시각 축은 UTC 다(결정 Q-6) — 벽시계 문자열을
 *   로컬 타임존으로 재해석하지 않는다.
 * - 쓰기(생성·수정·수령)는 호출자가 만든 UUID36 `Idempotency-Key` 를 받는다. 같은 의도의
 *   재시도는 같은 key·같은 본문으로 보낸다(서버가 원 결과를 재생한다).
 * - 생성 본문은 허용 키만 받는다 — screen 에 `windowStart`/`windowEnd` 를 싣거나 모르는
 *   키를 넣으면 400 이다. `timezone` 은 생략(=UTC) 또는 "UTC" 만 받는다.
 *   ⚠️ 서버 `HH:mm` 은 `LocalTime` 엄격 파싱이라 `24:00` 을 받지 못한다 — 자정 종료는
 *   호출부가 `23:59` 로 내려 보낸다(마지막 1분은 표현할 수 없다).
 * - 수정(PATCH)은 `title`/`targetMinutes` 만 받는다 — type·창·expectedVersion 을 섞으면 400.
 * - claim 본문은 정확히 `{occurrenceId, expectedVersion}` 두 키다 — 사용자 ID·claimable·
 *   지급량은 서버가 판정하므로 보내지 않는다.
 */
import { request } from './client';

/** 회차 헤더 — current 목록의 항목. 수령 축은 요청한 주민이다(GROMO-1991). */
export type QuestItem = {
  id: string;
  occurrenceId: string;
  title: string;
  type: string;
  windowStart: string | null;
  windowEnd: string | null;
  timezone: string;
  date: string;
  targetMinutes: number;
  /** 판정 대상이 아니거나 아직 미집계면 null — 0% 로 그리지 않는다. */
  myRate: number | null;
  reward: { currency: string; amount: number };
  settlementStatus: string;
  claimable: boolean;
  /** claimable·claimed 일 때 null. 값은 서버 enum(예: NOT_ACHIEVED·MEASUREMENT_PENDING). */
  claimBlockedReason: string | null;
  claimed: boolean;
  bonusAmount: number;
  bonusGranted: boolean;
  version: number;
};

export type QuestCurrent = { items: QuestItem[] };

/** 판정 대상 주민 — achieved·claimed 는 서버 값이다(rate 추정 금지). */
export type QuestMember = {
  userId: string;
  name: string | null;
  rate: number | null;
  measurementStatus: string;
  achieved: boolean;
  claimed: boolean;
};

/** 회차 진행 — 헤더 필드 + 판정 대상 주민 목록. */
export type QuestProgress = Omit<QuestItem, never> & {
  members: QuestMember[];
  nextCursor: string | null;
};

export type QuestCreated = { id: string; title: string };
export type QuestUpdated = { id: string; title: string; targetMinutes: number };
/** 수령 결과 — villagePointsAdded 는 내 몫, bonusAdded 는 이 요청이 함께 적립한 전원 보너스. */
export type QuestClaimed = {
  claimId: string;
  occurrenceId: string;
  villagePointsAdded: number;
  bonusAdded: number;
  claimed: boolean;
};

/** 생성 본문 — focus 는 windowStart/windowEnd 필수, screen 은 창 필드 금지. */
export type QuestCreateBody = {
  title: string;
  type: 'focus' | 'screen';
  targetMinutes: number;
  windowStart?: string;
  windowEnd?: string;
  timezone?: string;
};
/** 수정 본문 — 보낸 필드만 간다(생략은 유지, 명시 null 은 서버가 거절). */
export type QuestUpdateBody = { title?: string; targetMinutes?: number };

const enc = encodeURIComponent;

export function getCurrentQuests(islandId: string): Promise<QuestCurrent> {
  return request<QuestCurrent>(`/islands/${enc(islandId)}/quests/current`);
}

/** occurrenceId 필수. 다음 주민 페이지는 서버가 발급한 cursor를 그대로 보낸다. */
export function getQuestProgress(
  islandId: string,
  questId: string,
  occurrenceId: string,
  cursor?: string,
): Promise<QuestProgress> {
  const query = new URLSearchParams({ occurrenceId });
  if (cursor !== undefined) query.set('cursor', cursor);
  return request<QuestProgress>(
    `/islands/${enc(islandId)}/quests/${enc(questId)}/progress?${query.toString()}`,
  );
}

export function createQuest(
  islandId: string,
  body: QuestCreateBody,
  key: string,
): Promise<QuestCreated> {
  return request<QuestCreated>(`/islands/${enc(islandId)}/quests`, {
    method: 'POST',
    body,
    idempotencyKey: key,
  });
}

export function updateQuest(
  islandId: string,
  questId: string,
  body: QuestUpdateBody,
  key: string,
): Promise<QuestUpdated> {
  return request<QuestUpdated>(`/islands/${enc(islandId)}/quests/${enc(questId)}`, {
    method: 'PATCH',
    body,
    idempotencyKey: key,
  });
}

/** 개인 몫 수령 — 본문은 정확히 {occurrenceId, expectedVersion} 두 키다. */
export function claimQuest(
  islandId: string,
  questId: string,
  body: { occurrenceId: string; expectedVersion: number },
  key: string,
): Promise<QuestClaimed> {
  return request<QuestClaimed>(`/islands/${enc(islandId)}/quests/${enc(questId)}/claims`, {
    method: 'POST',
    body,
    idempotencyKey: key,
  });
}
