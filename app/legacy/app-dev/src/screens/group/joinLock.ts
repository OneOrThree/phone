import { useSyncExternalStore } from 'react';

// 그룹 참여(joinGroup) 전역 단일 실행 잠금 — 명세 docs/app/group-plan.md §0(사용자당 그룹 1개).
//
// 왜 컴포넌트가 아니라 모듈에 두는가:
//   서버 joinGroup은 사용자당 그룹 1개를 강제하지 않는다(GroupService:207-243). 참여 요청 두 개가
//   동시에 살아 있으면 둘 다 성공해 두 그룹에 걸치고, 앱은 groups[0]만 보여주므로 나머지 한 곳은
//   들어가지도 나가지도 못하는 상태로 남는다(§0).
//   시트 안의 ref 잠금은 **시트를 가로지르는 경합**을 못 막는다 — 찾기 시트에서 A 참여가 진행 중일 때
//   초대 링크가 도착하면 GroupScreen이 찾기 시트를 내리고(setFindOpen(false)) 초대 시트를 여는데,
//   언마운트는 진행 중인 요청을 취소하지 않으므로 새 시트에서 B 참여가 함께 나갈 수 있다.
//   잠금을 컴포넌트 밖에 두면 잠금의 수명이 **요청의 수명**과 일치해 이 창이 닫힌다.
//
// 취소(AbortController)가 아니라 직렬화인 이유: joinGroup은 이미 서버 상태를 바꾸는 요청이라
// 클라이언트 취소는 응답만 버릴 뿐 가입을 되돌리지 못한다 — "취소했는데 가입됨"이 더 나쁘다.

export type JoinToken = { readonly id: number };

let holder: JoinToken | null = null;
let nextId = 1;
// 참여 요청이 끝난 횟수. 시트가 캐시해 둔 '내 소속 그룹'의 세대로 쓴다 — 조회 이후 이 값이
// 달라졌다면 그 사이 어딘가에서 참여가 끝난 것이므로 캐시를 믿을 수 없다.
let completions = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

// 잠금을 잡으면 토큰을, 이미 누가 쥐고 있으면 null을 돌려준다(대기하지 않는다 — 호출부는 버튼을
// 비활성으로 두고 사용자가 다시 누르게 한다).
export function acquireJoinLock(): JoinToken | null {
  if (holder) return null;
  holder = { id: nextId++ };
  emit();
  return holder;
}

// 잠금을 쥔 토큰만 풀 수 있다 — 늦게 끝난 이전 요청이 새 요청의 잠금을 푸는 것을 막는다.
export function releaseJoinLock(token: JoinToken): void {
  if (holder !== token) return;
  holder = null;
  completions++;
  emit();
}

export function isJoinLocked(): boolean {
  return holder !== null;
}

export function joinCompletionCount(): number {
  return completions;
}

export function subscribeJoinLock(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

// 잠금 상태를 구독한다 — 참여 버튼의 스피너·비활성이 **누가 쥐고 있든** 잠금과 함께 움직인다.
// (다른 시트가 쥔 잠금이 풀렸을 때 이쪽 버튼이 살아나려면 구독이 필요하다.)
export function useJoinLocked(): boolean {
  return useSyncExternalStore(subscribeJoinLock, isJoinLocked);
}

// 테스트 격리 전용 — 모듈 스코프 상태라 한 파일 안의 테스트끼리 잠금이 새면 뒤 테스트가 죽는다.
// 프로덕션 코드에서는 부르지 않는다.
export function resetJoinLock(): void {
  holder = null;
  completions = 0;
}
