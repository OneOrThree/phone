// 결과 모달의 **선점(claim) · 확인(ack)** 경계 — 계약 §3 · D8 · N51.
//
// ⚠️ **임시 대역이다.** 실제 구현은 W3(GROMO-1577)가 `./challengeResult`에 이미 export 해 두었고,
//    이 워크트리(W1)에는 아직 그 파일이 도착하지 않았다. 그래서 호출부(ChallengeResultHost)는
//    **진짜로 이 함수들을 부르고**, 통합 시점에 이 파일의 본문만 아래 한 줄로 갈아 끼운다:
//
//      export { claimChallengeResult, ackChallengeResult } from './challengeResult';
//
//    호출부를 TODO 주석으로 남기지 않은 이유: 세 PR이 다 머지돼도 **호출부가 없으면 기능이
//    안 켜지고 테스트는 전부 초록**이다(조정자 사전 게이트가 잡은 실패 모드). 배선을 먼저
//    완성해 두면 통합은 재수출 한 줄로 끝난다.
//
// 대역의 반환값은 **지금 동작을 그대로 유지하는 값**이다 — 서버(W2)가 배포되기 전에 이 코드가
// 실려 나가도 결과 모달이 멈추지 않아야 한다:
//   · claim  : 항상 성공(토큰은 로컬 합성). 즉 "선점 개념이 없던 시절"과 같은 흐름.
//   · ack    : 항상 성공(no-op). 로컬 1회 가드(D2)가 재노출을 막던 종전 그대로다.

export interface ChallengeResultClaimOk {
  ok: true;
  claimToken: string;
}

export interface ChallengeResultClaimHeld {
  ok: false;
  // 서버가 계산한 **상대 지연**(절대 시각 금지 — 인스턴스 간 시계가 어긋난다). 모르면 null.
  retryAfterMs: number | null;
}

export type ChallengeResultClaim = ChallengeResultClaimOk | ChallengeResultClaimHeld;

let localTokenSeq = 0;

export async function claimChallengeResult(sessionId: string): Promise<ChallengeResultClaim> {
  localTokenSeq += 1;
  return { ok: true, claimToken: `local:${sessionId}:${localTokenSeq}` };
}

/**
 * 확인(ack). **`false`는 "서버에 반영되지 않았다"**는 뜻이고, 호출부는 모달을 다시 띄우지 않고
 * ack만 재시도해야 한다(IA §4.3 — 재노출 없이 ack만 재시도). `RESULT_CLAIM_STALE`처럼 서버
 * 상태가 이미 옳은 경우는 구현체가 내부에서 `true`로 접는다(무한 재시도 방지).
 */
export async function ackChallengeResult(
  _sessionId: string,
  _claimToken: string,
): Promise<boolean> {
  return true;
}
