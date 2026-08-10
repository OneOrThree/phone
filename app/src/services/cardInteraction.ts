export const ROOM_ATTRIBUTION_TTL_MS = 30_000;
export const FOCUS_ATTRIBUTION_TTL_MS = 10 * 60_000;

export type FocusEntrySource =
  | 'group_card'
  | 'group_room'
  | 'group_find'
  | 'invite'
  | 'home_fab'
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

export function createCardInteractionContext(now = Date.now()): CardInteractionContext {
  const interactionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    return (token === 'x' ? random : 8 + (random % 4)).toString(16);
  });
  return { interactionId, interactionAcceptedAt: now };
}

export function invalidateCardInteraction(interactionId?: string): void {
  if (interactionId) invalidatedIds.add(interactionId);
}

export function consumeCardInteraction(
  context: CardInteractionRouteContext,
  ttlMs: number,
  now = Date.now(),
): string | undefined {
  const { entrySource, interactionId, interactionAcceptedAt } = context;
  if (entrySource !== 'group_card' || !interactionId || interactionAcceptedAt == null) return;
  if (consumedIds.has(interactionId) || invalidatedIds.has(interactionId)) return;
  const age = now - interactionAcceptedAt;
  if (age < 0 || age > ttlMs) {
    invalidatedIds.add(interactionId);
    return;
  }
  consumedIds.add(interactionId);
  return interactionId;
}

export function normalizeFocusEntrySource(source?: FocusEntrySource): FocusEntrySource {
  return source ?? 'unknown';
}

export function resetCardInteractionStateForTest(): void {
  consumedIds.clear();
  invalidatedIds.clear();
}
