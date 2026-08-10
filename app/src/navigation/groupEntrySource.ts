export type GroupEntrySource = 'tab' | 'invite' | 'push' | 'return' | 'unknown';

type DirectGroupEntrySource = Extract<GroupEntrySource, 'invite' | 'push' | 'unknown'>;

// 외부 진입이 실제로 GroupScreen의 새 focus를 만들 때만 쌓는 1회성 값이다.
// 이미 focus된 화면에 도착한 warm invite/push는 이 모듈을 호출하지 않는다.
let pendingDirectSource: DirectGroupEntrySource | null = null;
let pendingInitialGroupRoomReturn = false;

export function queueDirectGroupEntry(source: DirectGroupEntrySource): void {
  // 첫 외부 전이의 원인을 보존한다. 화면이 focus되기 전에 후속 링크가 도착해도
  // 다음 episode의 source를 최신 링크로 덮어쓰지 않는다.
  if (pendingDirectSource === null) pendingDirectSource = source;
}

export function consumeGroupEntry(fallback: GroupEntrySource): GroupEntrySource {
  const source = pendingDirectSource ?? fallback;
  pendingDirectSource = null;
  return source;
}

export function clearPendingGroupEntry(): void {
  pendingDirectSource = null;
  pendingInitialGroupRoomReturn = false;
}

export function markInitialGroupRoomReturn(): void {
  pendingInitialGroupRoomReturn = true;
}

export function consumeInitialGroupRoomReturn(): boolean {
  const pending = pendingInitialGroupRoomReturn;
  pendingInitialGroupRoomReturn = false;
  return pending;
}

// GroupRoom에서 다른 전역 탭으로 이동할 때 초기 room-return 표식이 다음 episode로 새지 않게 한다.
export function discardInitialGroupRoomReturn(): void {
  pendingInitialGroupRoomReturn = false;
}
