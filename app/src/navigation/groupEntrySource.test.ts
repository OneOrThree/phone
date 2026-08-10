import {
  clearPendingGroupEntry,
  consumeGroupEntry,
  queueDirectGroupEntry,
  settlePendingPushGroupList,
  waitForPendingPushGroupList,
} from './groupEntrySource';

afterEach(() => clearPendingGroupEntry());

test('direct source는 새 episode에서 한 번만 소비한다', () => {
  queueDirectGroupEntry('invite');

  expect(consumeGroupEntry('tab')).toBe('invite');
  expect(consumeGroupEntry('return')).toBe('return');
});

test('focus 전에 연속 외부 진입이 와도 최초 source를 덮어쓰지 않는다', () => {
  queueDirectGroupEntry('invite');
  queueDirectGroupEntry('push');

  expect(consumeGroupEntry('tab')).toBe('invite');
});

test('push 목록 gate는 성공 episode 결과를 기다렸다 한 번 공유한다', async () => {
  queueDirectGroupEntry('push');
  const pending = waitForPendingPushGroupList();
  expect(pending).not.toBeNull();

  settlePendingPushGroupList(['group-1']);
  await expect(pending).resolves.toEqual(['group-1']);
  expect(waitForPendingPushGroupList()).toBeNull();
});
