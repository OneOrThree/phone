export type GroupEntrySource = 'tab' | 'invite' | 'push' | 'return' | 'unknown';

type DirectGroupEntrySource = Extract<GroupEntrySource, 'invite' | 'push' | 'unknown'>;

export type GroupEntryToken = number;

export interface ClaimedGroupEntry {
  source: GroupEntrySource;
  token: GroupEntryToken | null;
}

// 외부 진입이 실제로 GroupScreen의 새 focus를 만들 때만 쌓는 1회성 값이다.
// 이미 focus된 화면에 도착한 warm invite/push는 이 모듈을 호출하지 않는다.
let pendingDirectEntry: { source: DirectGroupEntrySource; token: GroupEntryToken } | null = null;
let nextToken = 1;
let pendingInitialRoomReturn = false;

export function queueDirectGroupEntry(source: DirectGroupEntrySource): GroupEntryToken | null {
  // 첫 외부 전이의 원인을 보존한다. 화면이 focus되기 전에 후속 링크가 도착해도
  // 다음 episode의 source를 최신 링크로 덮어쓰지 않는다.
  if (pendingDirectEntry !== null) return null;
  const token = nextToken++;
  pendingDirectEntry = { source, token };
  return token;
}

export function peekGroupEntry(fallback: GroupEntrySource): GroupEntrySource {
  return pendingDirectEntry?.source ?? fallback;
}

// focus episode가 외부 진입 원인을 자기 로컬 상태로 귀속할 때 쓴다. 이 시점엔 서버 목록 성공이
// 아직 아니므로 전역 pending은 유지하고, 성공·blur·명시적 취소가 같은 token으로 마무리한다.
export function claimGroupEntry(fallback: GroupEntrySource): ClaimedGroupEntry {
  return pendingDirectEntry
    ? { source: pendingDirectEntry.source, token: pendingDirectEntry.token }
    : { source: fallback, token: null };
}

export function consumeGroupEntry(fallback: GroupEntrySource): GroupEntrySource {
  const source = pendingDirectEntry?.source ?? fallback;
  pendingDirectEntry = null;
  return source;
}

export function consumeClaimedGroupEntry(claim: ClaimedGroupEntry): GroupEntrySource {
  discardQueuedGroupEntry(claim.token);
  return claim.source;
}

// 비동기 우회를 시작한 호출이 자신이 예약한 source만 폐기한다. 그 사이 로그인 승격을 기다리는
// invite 등 다른 흐름의 source가 먼저 들어 있었다면 token이 다르므로 건드리지 않는다.
export function discardQueuedGroupEntry(token: GroupEntryToken | null): boolean {
  if (token === null || pendingDirectEntry?.token !== token) return false;
  pendingDirectEntry = null;
  return true;
}

export function clearPendingGroupEntry(): void {
  pendingDirectEntry = null;
  pendingInitialRoomReturn = false;
}

// 결과성 push가 lazy GroupScreen을 focus하지 않고 GroupRoom으로 곧바로 우회하면, 방을 닫은
// 뒤의 첫 GroupScreen focus는 탭 선택이 아니라 자식 화면에서의 복귀다. 이 표식은 source queue와
// 별개로 그 한 번의 fallback만 return으로 고정한다.
export function markInitialGroupRoomReturn(): void {
  pendingInitialRoomReturn = true;
}

export function consumeInitialGroupRoomReturn(): boolean {
  const pending = pendingInitialRoomReturn;
  pendingInitialRoomReturn = false;
  return pending;
}

export function discardInitialGroupRoomReturn(): void {
  pendingInitialRoomReturn = false;
}
