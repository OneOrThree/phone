// 카드 '지난 결과' 한 줄의 **단일 소스 선택기** — v2 `lastSettledSession`(LLD §2.1)과 구서버
// `lastSettledBet`를 하나의 표시 모델로 접는다(#570 codex ①).
//
// 왜 표시 모델을 LastSettledBet(구 타입)으로 맞추나: 결과 시트(LastBetResultSheet)는 A2 소유
// 파일이라 이 배치에서 props 타입을 바꾸지 않는다(계약 §5). 서버 필드가 갈려도 화면 계약은
// 그대로 두고, 갈라짐을 **여기 한 곳에서만** 흡수한다.
//
// ⚠️ 분업(계약·형제 PR): 카드 표시용은 `lastSettledSession`, **결과 모달 큐는
//    `/me/challenge-results`**(A2 소유 축, N53)다. 이 파일은 카드 축만 다룬다 — 모달 큐를
//    여기서 만들지 않는다.
import type {
  GroupBetStatus,
  GroupChallengeResponse,
  LastSettledBet,
  LastSettledSession,
} from '@/types/dto/group';

// 회차 상태 → 표시용 내기 상태. v2에만 있는 두 값의 처리:
//   VOIDED  → 'REFUNDED' : 무산·삭제 무효화는 **전액 환불된 사건**이라 환불 표기와 뜻이 같다.
//                          (결과 시트의 환불 배너가 그대로 성립한다 — 새 상태를 흘리면 시트가
//                           모르는 값으로 else 강하해 "돈이 어디 갔는지" 침묵한다)
//   UNUSED  → null       : 참가자 0명으로 닫힌 회차는 결과·내역에서 제외된다(N52). 표시하지 않는다.
function toDisplayStatus(status: LastSettledSession['status']): GroupBetStatus | null {
  if (status === 'UNUSED') return null;
  if (status === 'VOIDED') return 'REFUNDED';
  return status;
}

/**
 * 카드가 그릴 '지난 결과' 1건. 없으면 null.
 *
 * v2 필드가 있으면 그것이 정본이고(회차 모델), 없으면 구서버 `lastSettledBet`로 폴백한다 —
 * 서버 배포가 앱보다 늦어도(그 반대여도) 카드가 빈 채로 남지 않는다.
 */
export function pickLastSettled(challenge: GroupChallengeResponse): LastSettledBet | null {
  const session = challenge.lastSettledSession ?? null;
  if (session !== null) {
    const status = toDisplayStatus(session.status);
    if (status === null) return null;
    return {
      betDate: session.sessionDate,
      stake: session.stake,
      pot: session.pot,
      status,
      results: session.results,
      goalMinutes: session.goalMinutes,
    };
  }
  return challenge.lastSettledBet ?? null;
}

/**
 * '내가 참가한 회차가 정산됐다'를 감지하는 서명(GroupRoomScreen이 잔액 재동기화에 쓴다).
 *
 * v2는 내 결과가 응답 최상위에 요약돼 있어(myAchieved·myPayout) results를 뒤지지 않아도 된다.
 * null(미확정)과 0(확정된 0코인)은 다른 사실이라 같은 글자로 뭉개지 않는다 — 뭉개면 지급이
 * 확정된 순간을 놓쳐 카드엔 지급액이 뜨는데 전역 잔액이 정산 전 값에 머문다.
 */
export function settledSignatureOf(
  challenge: GroupChallengeResponse,
  myUserId: string | null,
): string {
  if (!myUserId) return '';
  const session = challenge.lastSettledSession ?? null;
  if (session !== null) {
    // myJoined를 모르는 응답(필드 부재)은 결과 명단에서 나를 찾아 판정한다.
    const mine = session.results.find((r) => r.userId === myUserId);
    const joined = session.myJoined ?? mine !== undefined;
    if (!joined) return '';
    const achieved = session.myAchieved ?? mine?.achieved ?? null;
    const payout = session.myPayout ?? mine?.payout ?? null;
    return `${challenge.id}:${session.sessionDate}:${session.status}:${achieved ?? '?'}:${payout ?? '?'}`;
  }
  const last = challenge.lastSettledBet ?? null;
  if (last === null) return '';
  const mine = last.results.find((r) => r.userId === myUserId);
  if (mine === undefined) return '';
  return `${challenge.id}:${last.betDate}:${last.status}:${mine.achieved ?? '?'}:${mine.payout ?? '?'}`;
}
