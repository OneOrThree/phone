// 챌린지 결과 큐의 "아직 보여줄 것이 남았는가" 신호 — **소유자는 ChallengeResultHost 하나**다.
//
// 왜 필요한가: 결과 모달이 그룹방(GroupRoomScreen)에서 루트 호스트로 옮겨 가며, 방이 쥐고 있던
// 탈퇴 유예 로직(N53·C8 — "탈퇴자가 결과 푸시로 들어온 경우 결과를 보여주기 전에 방을 내리지
// 않는다")이 근거를 잃었다. 방은 이제 결과 큐를 보지 못한다. 그렇다고 방이 결과를 **또** 조회하면
// 같은 엔드포인트를 두 곳에서 부르고 두 판정이 갈린다.
//
// 그래서 호스트가 자기 판정을 여기 한 줄로 공표하고, 방은 그것만 읽는다. 신호는 3상이다 —
// **'없다'와 '모른다'를 절대 뭉개지 않는다**(challengeResult.ts의 null 계약 D1과 같은 이유):
//   unknown : 아직 조회 전이거나 조회·가드 읽기가 실패했다. 이 상태로 방을 내리면 다른 소속
//             그룹이 없는 탈퇴자는 자기 정산 결과를 **영영** 못 본다.
//   pending : 보여줄 결과가 큐에 남아 있다(지금 떠 있는 모달 포함).
//   none    : 성공한 조회가 "보여줄 것이 없다"를 확정했다. 이때만 방이 내려가도 된다.
export type ChallengeResultGateState = 'unknown' | 'pending' | 'none';

let state: ChallengeResultGateState = 'unknown';
const listeners = new Set<(next: ChallengeResultGateState) => void>();

export function getChallengeResultGate(): ChallengeResultGateState {
  return state;
}

/** ChallengeResultHost 전용 — 다른 곳에서 부르면 두 개의 정본이 생긴다. */
export function setChallengeResultGate(next: ChallengeResultGateState): void {
  if (state === next) return;
  state = next;
  // 스냅샷을 돌린다 — 리스너가 자기 구독을 해제해도(탈퇴 유예 종료 → 언마운트) 순회가 깨지지 않게.
  Array.from(listeners).forEach((listener) => listener(next));
}

export function subscribeChallengeResultGate(
  listener: (next: ChallengeResultGateState) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Jest에서 앱 프로세스 경계를 재현하기 위한 테스트 전용 reset. */
export function resetChallengeResultGateForTests(): void {
  state = 'unknown';
  listeners.clear();
}
