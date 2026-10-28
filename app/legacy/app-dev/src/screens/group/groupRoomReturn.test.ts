import { resolveGroupRoomReturn } from './groupRoomReturn';

const context = { groupId: 'b', sourceIndex: 1, departureRevision: 3 };

test('stable groupId가 남아 있으면 새 index의 같은 뒷면으로 복귀한다', () => {
  expect(resolveGroupRoomReturn(context, ['b', 'a', 'c'])).toEqual({
    kind: 'same_back',
    groupId: 'b',
    index: 0,
  });
});

test('출발 그룹이 사라지면 같은 시각 slot의 다음 카드 앞면을 선택한다', () => {
  expect(resolveGroupRoomReturn(context, ['a', 'c'])).toEqual({
    kind: 'fallback_front',
    groupId: 'c',
    index: 1,
  });
});

test('출발이 마지막 카드였으면 남은 마지막 카드 앞면을 선택한다', () => {
  expect(resolveGroupRoomReturn({ ...context, sourceIndex: 4 }, ['a', 'c'])).toEqual({
    kind: 'fallback_front',
    groupId: 'c',
    index: 1,
  });
});

test('남은 소속이 없으면 기존 빈 상태로 복귀한다', () => {
  expect(resolveGroupRoomReturn(context, [])).toEqual({ kind: 'empty' });
});
