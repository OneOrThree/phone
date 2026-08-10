import {
  completeGroupDeckGuide,
  isGroupDeckGuideCompletedInSession,
  resetGroupDeckGuideSessionForTests,
  resolveGroupDeckGuideDecision,
} from './groupDeckGuide';

beforeEach(resetGroupDeckGuideSessionForTests);

test('완료 key와 overlay blocker를 실제 exposure 상태로 나눈다', () => {
  expect(resolveGroupDeckGuideDecision('completed', false)).toEqual({
    exposure: 'completed',
    queue: false,
  });
  expect(resolveGroupDeckGuideDecision('incomplete', false)).toEqual({
    exposure: 'shown',
    queue: true,
  });
  expect(resolveGroupDeckGuideDecision('incomplete', true)).toEqual({
    exposure: 'pending',
    queue: true,
  });
});

test('read 실패 fallback은 세션당 한 번만 queue에 등록한다', () => {
  expect(resolveGroupDeckGuideDecision('unknown', false)).toEqual({
    exposure: 'unknown',
    queue: true,
  });
  expect(resolveGroupDeckGuideDecision('unknown', false)).toEqual({
    exposure: 'unknown',
    queue: false,
  });
});

test('마지막 action의 완료 이벤트는 write 결과와 무관하게 정확히 한 번이다', async () => {
  const logCompleted = jest.fn();
  const logWriteFailed = jest.fn();
  const persist = jest.fn().mockRejectedValue(new Error('disk full'));

  expect(completeGroupDeckGuide(logCompleted, persist, logWriteFailed)).toBe(true);
  expect(completeGroupDeckGuide(logCompleted, persist, logWriteFailed)).toBe(false);
  await Promise.resolve();

  expect(isGroupDeckGuideCompletedInSession()).toBe(true);
  expect(logCompleted).toHaveBeenCalledTimes(1);
  expect(logWriteFailed).toHaveBeenCalledTimes(1);
});
