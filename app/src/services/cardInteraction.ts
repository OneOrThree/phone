export interface CardInteractionContext {
  interactionId: string;
  interactionAcceptedAt: number;
}

export type AttributionEntrySource =
  | 'group_card'
  | 'group_room'
  | 'group_find'
  | 'invite'
  | 'home_fab'
  | 'unknown';

export interface CardInteractionRouteContext {
  entrySource?: AttributionEntrySource;
  interactionId?: string;
  interactionAcceptedAt?: number;
}

export const CARD_INTERACTION_TTL_MS = 10 * 60 * 1000;
export const GROUP_ROOM_INTERACTION_TTL_MS = 30 * 1000;

/** 카드 CTA에서 시작한 context만 짧은 TTL 안에서 결과 이벤트에 귀속한다. */
export function resolveCardInteraction(
  context: CardInteractionRouteContext | null | undefined,
  now = Date.now(),
  ttlMs = CARD_INTERACTION_TTL_MS,
): CardInteractionContext | null {
  if (
    context?.entrySource !== 'group_card' ||
    typeof context.interactionId !== 'string' ||
    context.interactionId.length === 0 ||
    typeof context.interactionAcceptedAt !== 'number' ||
    now < context.interactionAcceptedAt ||
    now - context.interactionAcceptedAt > ttlMs
  ) {
    return null;
  }
  return {
    interactionId: context.interactionId,
    interactionAcceptedAt: context.interactionAcceptedAt,
  };
}

function randomUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === 'x' ? random : 8 + (random % 4);
    return value.toString(16);
  });
}

export function createCardInteractionContext(now = Date.now()): CardInteractionContext {
  return { interactionId: randomUuid(), interactionAcceptedAt: now };
}
