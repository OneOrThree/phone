// 결과 모달의 **선점(claim) · 재검증 · 확인(ack) · ack 복구** 경계 — 계약 §4(N53 개정) · D8 · N51.
//
// 이 파일은 **경계 이름만 남은 재수출**이다. 구현은 전부 `./challengeResult`에 있다.
//
// 왜 파일을 남겨 두는가 — 이 배치에서 W1(조정자·호스트)과 W3(서버 배선)이 서로 다른 워크트리에서
// 굴러, W1이 실물이 도착하기 전에 **호출부를 진짜로 배선해 두기 위한 대역**으로 만든 파일이다.
// 통합 시점(#672 머지 후)에 본문을 이 재수출로 갈아 끼웠다. 이름을 유지하면 호출부 diff가 없어
// 통합이 한 파일에서 끝난다.
//
// ⚠️ **다시 대역으로 되돌리지 말 것.** 대역의 claim은 항상 성공하고 ack는 no-op이라, 되돌려도
//    **테스트는 전부 초록인데 서버 확인이 한 건도 안 남는다.** 그 상태로 배포되면 결과 모달이
//    기기 간 1회 노출을 보장하지 못하고(같은 계정의 두 기기가 같은 결과를 본다) 서버 큐에서
//    빠지지도 않는다. 앱 lint 워크플로에 이 파일이 대역으로 되돌아갔는지 보는 가드가 있다.
export {
  claimChallengeResult,
  ackChallengeResult,
  pendingAckChallengeResults,
  reconcileChallengeResultAck,
  type ChallengeResultClaim,
} from './challengeResult';
