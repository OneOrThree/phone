import {
  consumeCardInteraction,
  createCardInteractionContext,
  invalidateCardInteraction,
  resetCardInteractionStateForTest,
  ROOM_ATTRIBUTION_TTL_MS,
} from './cardInteraction';

beforeEach(resetCardInteractionStateForTest);

test('카드 CTA 상관키는 최초 성공 결과에서 정확히 한 번 소비된다', () => {
  const interaction = createCardInteractionContext(1_000);
  const route = { entrySource: 'group_card' as const, ...interaction };

  expect(consumeCardInteraction(route, ROOM_ATTRIBUTION_TTL_MS, 2_000)).toBe(
    interaction.interactionId,
  );
  expect(consumeCardInteraction(route, ROOM_ATTRIBUTION_TTL_MS, 2_000)).toBeUndefined();
});

test('취소·만료된 상관키는 결과 이벤트에 붙지 않는다', () => {
  const interaction = createCardInteractionContext(1_000);
  invalidateCardInteraction(interaction.interactionId);

  expect(
    consumeCardInteraction(
      { entrySource: 'group_card', ...interaction },
      ROOM_ATTRIBUTION_TTL_MS,
      2_000,
    ),
  ).toBeUndefined();
});
