import {
  claimGroupDeckGuideUnknownFallback,
  completeGroupDeckGuide,
  groupDeckGuideSteps,
  markGroupDeckGuideCompletedInSession,
  resetGroupDeckGuideSessionForTests,
  resolveGroupDeckGuideDecision,
} from './groupDeckGuide';

beforeEach(resetGroupDeckGuideSessionForTests);

test('그룹 수에 맞는 4단계 문구와 마지막 programmatic back을 정의한다', () => {
  expect(groupDeckGuideSteps(1)).toHaveLength(4);
  expect(groupDeckGuideSteps(1)[1].text).toContain('그룹이 늘면');
  expect(groupDeckGuideSteps(2)[1].text).toContain('옆으로 넘기면');
  expect(groupDeckGuideSteps(2)[3]).toMatchObject({
    anchor: 'active-card',
    requiresBack: true,
  });
});

test('미완료 안내는 overlay slot 유무에 따라 shown과 pending으로 고정한다', () => {
  expect(resolveGroupDeckGuideDecision('incomplete', false)).toEqual({
    exposure: 'shown',
    queue: true,
  });
  expect(resolveGroupDeckGuideDecision('incomplete', true)).toEqual({
    exposure: 'pending',
    queue: true,
  });
});

test('key read 실패 fallback은 overlay slot을 얻은 뒤에만 앱 세션에서 소비한다', () => {
  expect(resolveGroupDeckGuideDecision('unknown', false)).toEqual({
    exposure: 'unknown',
    queue: true,
  });
  // 대기 중 blur/unmount된 요청은 slot을 얻지 않았으므로 다음 focus에서도 queue 가능하다.
  expect(resolveGroupDeckGuideDecision('unknown', false).queue).toBe(true);
  expect(claimGroupDeckGuideUnknownFallback()).toBe(true);
  expect(resolveGroupDeckGuideDecision('unknown', false)).toEqual({
    exposure: 'unknown',
    queue: false,
  });
  expect(claimGroupDeckGuideUnknownFallback()).toBe(false);
});

test('현재 세션에서 완료하면 key write 결과와 무관하게 재노출하지 않는다', () => {
  markGroupDeckGuideCompletedInSession();
  expect(resolveGroupDeckGuideDecision('incomplete', false)).toEqual({
    exposure: 'completed',
    queue: false,
  });
});

test('완료 이벤트를 write보다 먼저 발행하고 write 실패도 현재 완료를 취소하지 않는다', async () => {
  const order: string[] = [];
  const failed = jest.fn();
  const completed = completeGroupDeckGuide(
    () => order.push('event'),
    () => {
      order.push('write');
      return Promise.reject(new Error('disk'));
    },
    failed,
  );

  expect(completed).toBe(true);
  expect(order).toEqual(['event', 'write']);
  await Promise.resolve();
  expect(failed).toHaveBeenCalledTimes(1);
  expect(resolveGroupDeckGuideDecision('incomplete', false).queue).toBe(false);
  expect(completeGroupDeckGuide(jest.fn(), jest.fn(), jest.fn())).toBe(false);
});
