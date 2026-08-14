// 결과 모달의 **선점(claim) · 재검증 · 확인(ack) · ack 복구** 경계 — 계약 §4(N53 개정) · D8 · N51.
//
// ⚠️ **임시 대역이다.** 실제 구현은 W3(GROMO-1577)가 `./challengeResult`에 이미 export 해 두었고,
//    이 워크트리(W1)에는 아직 그 파일이 도착하지 않았다. 그래서 호출부(ChallengeResultHost)는
//    **진짜로 이 함수들을 부르고**, 통합 시점에 이 파일의 본문만 아래 한 줄로 갈아 끼운다:
//
//      export {
//        claimChallengeResult, ackChallengeResult,
//        pendingAckChallengeResults, reconcileChallengeResultAck,
//      } from './challengeResult';
//
//    호출부를 TODO 주석으로 남기지 않은 이유: 세 PR이 다 머지돼도 **호출부가 없으면 기능이
//    안 켜지고 테스트는 전부 초록**이다(조정자 사전 게이트가 잡은 실패 모드). 배선을 먼저
//    완성해 두면 통합은 재수출 한 줄로 끝난다.
//
// 대역의 반환값은 **지금 동작을 그대로 유지하는 값**이다 — 서버(W2)가 배포되기 전에 이 코드가
// 실려 나가도 결과 모달이 멈추지 않아야 한다:
//   · claim/재검증 : 항상 성공(토큰은 로컬 합성). 즉 "선점 개념이 없던 시절"과 같은 흐름.
//   · ack          : 항상 성공(no-op). 로컬 1회 가드(D2)가 재노출을 막던 종전 그대로다.
//   · ack 복구     : 대상 0건(서버 acknowledged 필드가 없으면 판정 자체가 불가능하다).
import type { ChallengeResultCandidate } from './challengeResult';

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

/**
 * 선점 획득 **및 재검증**(계약 §4 — N53 개정).
 *
 * `currentToken`을 실어 부르면 "내가 아직 이 회차의 활성 claim 보유자인가"를 서버에 되묻고,
 * 맞으면 lease를 갱신한 **새 토큰**을 돌려준다. 아니면 `ok:false`다.
 *
 * ⚠️ 이 인자가 있는 이유가 곧 이 경로의 존재 이유다: A가 선점하고 백그라운드로 내려간 사이
 *    lease(2분)가 만료돼 B가 재선점하면, A가 복귀했을 때 **A의 낡은 성공 응답**은 여전히
 *    `ok:true`다. 그것을 믿고 노출하면 두 기기가 같은 결과를 동시에 본다. 그래서 호출부는
 *    **렌더 직전에** 반드시 이 재검증을 한 번 더 통과해야 한다.
 */
export async function claimChallengeResult(
  sessionId: string,
  _currentToken?: string,
): Promise<ChallengeResultClaim> {
  localTokenSeq += 1;
  return { ok: true, claimToken: `local:${sessionId}:${localTokenSeq}` };
}

/**
 * 확인(ack). **`false`는 "서버에 반영되지 않았다"**는 뜻이고, 호출부는 모달을 다시 띄우지 않고
 * ack만 재시도해야 한다(N51 — IA §4.3). `RESULT_CLAIM_STALE`처럼 서버 상태가 이미 옳은 경우는
 * 구현체가 내부에서 `true`로 접는다(무한 재시도 방지).
 */
export async function ackChallengeResult(
  _sessionId: string,
  _claimToken: string,
): Promise<boolean> {
  return true;
}

/**
 * **로컬 마커는 있는데 서버는 아직 미확인**인 회차 — ack 재시도 대상.
 *
 * 로컬 1회 가드는 노출 시점에 찍히는데(D2) ack는 그 뒤에 실패할 수 있다. 그 실행이 끝나면
 * 다음 실행에서 `filterUnseenChallengeResults`가 마커를 보고 후보를 **버리므로**, claim·ack
 * 경로가 다시 열리지 않고 서버에는 영원히 미확인으로 남는다(그리고 그 미확인 회차의 푸시
 * 클레임도 닫히지 않는다). 그 구멍을 여기서 메운다.
 */
export async function pendingAckChallengeResults(
  _userId: string,
  _candidates: ChallengeResultCandidate[],
): Promise<ChallengeResultCandidate[]> {
  return [];
}

/**
 * **노출 없이** claim → ack만 조용히 보낸다. 이미 본 것이 확실하므로 재노출하지 않는다.
 * 실패는 삼킨다(다음 실행이 같은 대상을 다시 집어 온다).
 */
export async function reconcileChallengeResultAck(_sessionId: string): Promise<boolean> {
  return true;
}
