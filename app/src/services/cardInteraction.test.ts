import {
  consumeCardInteraction,
  createCardInteractionContext,
  FOCUS_ATTRIBUTION_TTL_MS,
  invalidateCardInteraction,
  normalizeFocusEntrySource,
  resetCardInteractionStateForTest,
  ROOM_ATTRIBUTION_TTL_MS,
} from './cardInteraction';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => resetCardInteractionStateForTest());

describe('카드 CTA 상관키', () => {
  test('수락마다 새 비식별 UUID를 만들고 시각은 route context에만 담는다', () => {
    const first = createCardInteractionContext(100);
    const second = createCardInteractionContext(200);

    expect(first.interactionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second.interactionId).not.toBe(first.interactionId);
    expect(first.interactionAcceptedAt).toBe(100);
    expect(second.interactionAcceptedAt).toBe(200);
  });

  test('Room은 30초 안의 같은 ID를 최초 결과 한 번에만 소비한다', () => {
    const context = {
      entrySource: 'group_card' as const,
      interactionId: ID_A,
      interactionAcceptedAt: 1_000,
    };

    expect(consumeCardInteraction(context, ROOM_ATTRIBUTION_TTL_MS, 31_000)).toBe(ID_A);
    expect(consumeCardInteraction(context, ROOM_ATTRIBUTION_TTL_MS, 31_000)).toBeUndefined();
  });

  test('Focus는 10분 경계까지 귀속하고 초과하면 결과 ID를 생략한다', () => {
    expect(
      consumeCardInteraction(
        {
          entrySource: 'group_card',
          interactionId: ID_A,
          interactionAcceptedAt: 1_000,
        },
        FOCUS_ATTRIBUTION_TTL_MS,
        601_000,
      ),
    ).toBe(ID_A);
    expect(
      consumeCardInteraction(
        {
          entrySource: 'group_card',
          interactionId: ID_B,
          interactionAcceptedAt: 1_000,
        },
        FOCUS_ATTRIBUTION_TTL_MS,
        601_001,
      ),
    ).toBeUndefined();
  });

  test('background·route 취소로 만료한 ID는 재개 후 성공에도 귀속하지 않는다', () => {
    invalidateCardInteraction(ID_A);

    expect(
      consumeCardInteraction(
        {
          entrySource: 'group_card',
          interactionId: ID_A,
          interactionAcceptedAt: 1_000,
        },
        FOCUS_ATTRIBUTION_TTL_MS,
        2_000,
      ),
    ).toBeUndefined();
  });

  test('A 취소 뒤 B 성공은 B만 소비하고 non-card source의 남은 ID는 무시한다', () => {
    invalidateCardInteraction(ID_A);

    expect(
      consumeCardInteraction(
        { entrySource: 'group_card', interactionId: ID_A, interactionAcceptedAt: 1_000 },
        ROOM_ATTRIBUTION_TTL_MS,
        2_000,
      ),
    ).toBeUndefined();
    expect(
      consumeCardInteraction(
        { entrySource: 'group_card', interactionId: ID_B, interactionAcceptedAt: 1_500 },
        ROOM_ATTRIBUTION_TTL_MS,
        2_000,
      ),
    ).toBe(ID_B);
    expect(
      consumeCardInteraction(
        { entrySource: 'home_fab', interactionId: ID_A, interactionAcceptedAt: 1_000 },
        FOCUS_ATTRIBUTION_TTL_MS,
        2_000,
      ),
    ).toBeUndefined();
  });

  test('source가 없는 구버전 진입은 unknown으로 정규화한다', () => {
    expect(normalizeFocusEntrySource()).toBe('unknown');
    expect(normalizeFocusEntrySource('group_room')).toBe('group_room');
  });
});
