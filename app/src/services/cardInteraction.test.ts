import {
  CARD_INTERACTION_TTL_MS,
  GROUP_ROOM_INTERACTION_TTL_MS,
  interruptCardInteraction,
  resolveCardInteraction,
} from './cardInteraction';

describe('resolveCardInteraction', () => {
  const acceptedAt = 1_000_000;
  const context = {
    entrySource: 'group_card' as const,
    interactionId: 'interaction-1',
    interactionAcceptedAt: acceptedAt,
  };

  test('group_card context만 TTL 안에서 결과 귀속에 사용한다', () => {
    expect(resolveCardInteraction(context, acceptedAt + CARD_INTERACTION_TTL_MS)).toEqual({
      interactionId: 'interaction-1',
      interactionAcceptedAt: acceptedAt,
    });
    expect(resolveCardInteraction(context, acceptedAt + CARD_INTERACTION_TTL_MS + 1)).toBeNull();
    expect(resolveCardInteraction({ ...context, entrySource: 'unknown' }, acceptedAt)).toBeNull();
  });

  test('미래 timestamp와 불완전 context는 귀속하지 않는다', () => {
    expect(resolveCardInteraction(context, acceptedAt - 1)).toBeNull();
    expect(resolveCardInteraction({ entrySource: 'group_card' }, acceptedAt)).toBeNull();
  });

  test('방 CTA 결과는 별도 30초 TTL 안에서만 귀속한다', () => {
    expect(
      resolveCardInteraction(
        context,
        acceptedAt + GROUP_ROOM_INTERACTION_TTL_MS,
        GROUP_ROOM_INTERACTION_TTL_MS,
      ),
    ).not.toBeNull();
    expect(
      resolveCardInteraction(
        context,
        acceptedAt + GROUP_ROOM_INTERACTION_TTL_MS + 1,
        GROUP_ROOM_INTERACTION_TTL_MS,
      ),
    ).toBeNull();
  });
});

describe('interruptCardInteraction', () => {
  test('진입 경로만 남기고 pending interaction 귀속은 제거한다', () => {
    expect(
      interruptCardInteraction({
        entrySource: 'group_card',
        interactionId: 'interaction-1',
        interactionAcceptedAt: 1_000_000,
      }),
    ).toEqual({ entrySource: 'group_card' });
    expect(interruptCardInteraction(undefined)).toBeUndefined();
  });
});
