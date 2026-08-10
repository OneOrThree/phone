import {
  clearPendingGroupEntry,
  consumeInitialGroupRoomReturn,
  consumeGroupEntry,
  peekGroupEntry,
  discardInitialGroupRoomReturn,
  markInitialGroupRoomReturn,
  queueDirectGroupEntry,
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

test('성공 결과 전에는 source를 읽어도 소비하지 않는다', () => {
  queueDirectGroupEntry('invite');

  expect(peekGroupEntry('tab')).toBe('invite');
  expect(peekGroupEntry('return')).toBe('invite');
  expect(consumeGroupEntry('return')).toBe('invite');
  expect(peekGroupEntry('return')).toBe('return');
});

test('초기 그룹방 복귀 표식은 전역 탭 이탈에서 폐기된다', () => {
  markInitialGroupRoomReturn();
  discardInitialGroupRoomReturn();

  expect(consumeInitialGroupRoomReturn()).toBe(false);
});
