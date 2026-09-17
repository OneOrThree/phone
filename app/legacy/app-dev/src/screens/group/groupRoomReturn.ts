export interface GroupRoomReturnContext {
  groupId: string;
  sourceIndex: number;
  departureRevision: number;
}

export type GroupRoomReturnTarget =
  | { kind: 'same_back'; groupId: string; index: number }
  | { kind: 'fallback_front'; groupId: string; index: number }
  | { kind: 'empty' };

/** 성공한 전체 목록에서 stable groupId를 찾고, 없으면 같은 시각 slot으로 복귀한다. */
export function resolveGroupRoomReturn(
  context: GroupRoomReturnContext,
  groupIds: readonly string[],
): GroupRoomReturnTarget {
  const sameIndex = groupIds.indexOf(context.groupId);
  if (sameIndex >= 0) return { kind: 'same_back', groupId: context.groupId, index: sameIndex };
  if (groupIds.length === 0) return { kind: 'empty' };

  const index = Math.min(Math.max(context.sourceIndex, 0), groupIds.length - 1);
  return { kind: 'fallback_front', groupId: groupIds[index], index };
}
