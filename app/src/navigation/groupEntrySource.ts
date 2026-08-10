export type GroupEntrySource = 'tab' | 'invite' | 'push' | 'return' | 'unknown';

type DirectGroupEntrySource = Extract<GroupEntrySource, 'invite' | 'push' | 'unknown'>;

// 외부 진입이 실제로 GroupScreen의 새 focus를 만들 때만 쌓는 1회성 값이다.
// 이미 focus된 화면에 도착한 warm invite/push는 이 모듈을 호출하지 않는다.
let pendingDirectSource: DirectGroupEntrySource | null = null;

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

/** 게스트 단계처럼 이벤트를 발행할 수 없는 episode에서 source를 소비하지 않고 읽는다. */
export function peekGroupEntry(fallback: GroupEntrySource): GroupEntrySource {
  return pendingDirectSource ?? fallback;
}

export function clearPendingGroupEntry(): void {
  pendingDirectSource = null;
}
