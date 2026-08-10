import {
  clearPendingGroupEntry,
  consumeGroupEntry,
  discardQueuedGroupEntry,
  peekGroupEntry,
  queueDirectGroupEntry,
} from './groupEntrySource';

afterEach(() => clearPendingGroupEntry());

test('direct source는 새 episode에서 한 번만 소비한다', () => {
  queueDirectGroupEntry('invite');

  expect(consumeGroupEntry('tab')).toBe('invite');
  expect(consumeGroupEntry('return')).toBe('return');
});

test('focus 전에 연속 외부 진입이 와도 최초 source를 덮어쓰지 않는다', () => {
  const inviteToken = queueDirectGroupEntry('invite');
  const pushToken = queueDirectGroupEntry('push');

  expect(inviteToken).not.toBeNull();
  expect(pushToken).toBeNull();
  expect(consumeGroupEntry('tab')).toBe('invite');
});

test('성공 결과 전에는 source를 읽어도 소비하지 않는다', () => {
  queueDirectGroupEntry('invite');

  expect(peekGroupEntry('tab')).toBe('invite');
  expect(peekGroupEntry('return')).toBe('invite');
  expect(consumeGroupEntry('return')).toBe('invite');
  expect(peekGroupEntry('return')).toBe('return');
});

test('비동기 우회는 자신이 예약한 source만 폐기한다', () => {
  const inviteToken = queueDirectGroupEntry('invite');
  const rejectedPushToken = queueDirectGroupEntry('push');

  expect(discardQueuedGroupEntry(rejectedPushToken)).toBe(false);
  expect(peekGroupEntry('tab')).toBe('invite');
  expect(discardQueuedGroupEntry(inviteToken)).toBe(true);
  expect(peekGroupEntry('tab')).toBe('tab');
});
