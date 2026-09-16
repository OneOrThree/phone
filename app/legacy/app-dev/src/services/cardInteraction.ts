export const ROOM_ATTRIBUTION_TTL_MS = 30_000;
export const FOCUS_ATTRIBUTION_TTL_MS = 10 * 60_000;

export type FocusEntrySource =
  | 'group_card'
  | 'group_room'
  | 'group_find'
  | 'invite'
  | 'home_fab'
  | 'home'
  | 'stats_compare'
  | 'league'
  | 'friend'
  | 'group'
  | 'notification'
  | 'unknown';

export interface CardInteractionContext {
  interactionId: string;
  interactionAcceptedAt: number;
}

export interface CardInteractionRouteContext {
  entrySource?: FocusEntrySource;
  interactionId?: string;
  interactionAcceptedAt?: number;
}

const consumedIds = new Set<string>();
const invalidatedIds = new Set<string>();

function randomUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === 'x' ? random : 8 + (random % 4);
    return value.toString(16);
  });
}

/**
 * 카드 CTA가 실제로 수락된 시점에만 호출한다. 반환값은 route에만 전달하며 저장소에 쓰지 않는다.
 */
export function createCardInteractionContext(now = Date.now()): CardInteractionContext {
  return {
    interactionId: randomUuid(),
    interactionAcceptedAt: now,
  };
}

/**
 * background, 목적 route 취소/이탈, navigation 실패 때 호출한다.
 * route에 값이 남아도 이후 결과가 과거 의도에 귀속되지 않게 한다.
 */
export function invalidateCardInteraction(interactionId?: string): void {
  if (interactionId) invalidatedIds.add(interactionId);
}

/**
 * 성공 결과 이벤트 직전에 호출한다. 유효한 카드 intent만 최초 한 번 ID를 돌려준다.
 * 결과 이벤트 자체는 반환값이 없어도 발행하며, 그 경우 interaction_id만 생략한다.
 */
export function consumeCardInteraction(
  context: CardInteractionRouteContext,
  ttlMs: number,
  now = Date.now(),
): string | undefined {
  const { entrySource, interactionId, interactionAcceptedAt } = context;
  if (entrySource !== 'group_card' || !interactionId || interactionAcceptedAt == null) {
    return undefined;
  }
  if (consumedIds.has(interactionId) || invalidatedIds.has(interactionId)) return undefined;

  const ageMs = now - interactionAcceptedAt;
  if (ageMs < 0 || ageMs > ttlMs) {
    invalidatedIds.add(interactionId);
    return undefined;
  }

  consumedIds.add(interactionId);
  return interactionId;
}

export function normalizeFocusEntrySource(source?: FocusEntrySource): FocusEntrySource {
  return source ?? 'unknown';
}

/** FocusCategory의 재시도는 source를 보존하되, 이미 transfer/폐기한 상관키는 다시 넘기지 않는다. */
export function resolveFocusSessionRouteContext(
  context: CardInteractionRouteContext,
  transferInteraction: boolean,
): Required<Pick<CardInteractionRouteContext, 'entrySource'>> &
  Pick<CardInteractionRouteContext, 'interactionId' | 'interactionAcceptedAt'> {
  return {
    entrySource: normalizeFocusEntrySource(context.entrySource),
    interactionId: transferInteraction ? context.interactionId : undefined,
    interactionAcceptedAt: transferInteraction ? context.interactionAcceptedAt : undefined,
  };
}

/** 테스트 격리 전용. 런타임 호출 금지. */
export function resetCardInteractionStateForTest(): void {
  consumedIds.clear();
  invalidatedIds.clear();
}
