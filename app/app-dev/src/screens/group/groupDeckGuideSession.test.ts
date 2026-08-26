import {
  isGroupDeckGuideCompletedInSession,
  markGroupDeckGuideCompletedInSession,
  reserveUnknownGroupDeckGuideAttempt,
  resetGroupDeckGuideSessionForTests,
} from './groupDeckGuideSession';

describe('groupDeckGuideSession', () => {
  beforeEach(resetGroupDeckGuideSessionForTests);

  test('영속 완료 key 저장 실패와 무관하게 현재 앱 세션의 완료를 기억한다', () => {
    expect(isGroupDeckGuideCompletedInSession()).toBe(false);
    markGroupDeckGuideCompletedInSession();
    expect(isGroupDeckGuideCompletedInSession()).toBe(true);
  });

  test('완료 key를 읽지 못한 fallback 노출은 앱 세션당 한 번만 예약한다', () => {
    expect(reserveUnknownGroupDeckGuideAttempt()).toBe(true);
    expect(reserveUnknownGroupDeckGuideAttempt()).toBe(false);
  });
});
