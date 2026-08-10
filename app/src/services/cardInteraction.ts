export interface CardInteractionContext {
  interactionId: string;
  interactionAcceptedAt: number;
}

export interface CardInteractionRouteContext {
  entrySource?: 'group_card' | 'unknown';
  interactionId?: string;
  interactionAcceptedAt?: number;
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
