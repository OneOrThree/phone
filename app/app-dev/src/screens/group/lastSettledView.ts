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

// ── 무효화 사유 — **문구 소스는 이 표 하나다** ─────────────────────────────────
// 카드 한 줄과 결과 시트 배너가 **각자 switch로** 같은 값 축을 매핑하고 있었다(#570 리뷰):
// 지금은 결과가 같아도 새 사유가 생기면 한쪽만 고치고 잊게 된다 — 그게 바로 이번 라운드에
// 고친 "카드와 시트가 갈리는" 버그의 재발 구조다. 정규화(키 접기)와 라벨을 여기 한 곳에 두고,
// 두 화면은 **길이만 다른 문자열을 같은 표에서 조립**한다. 새 사유는 이 파일만 고치면 된다.

/**
 * 정규화된 사유 키 — 서버 값 축의 이문·별칭을 접은 결과.
 *
 * ⚠️ **`AUTO_REFUND`는 더 이상 별도 키가 아니다.** 24시간 초과 자동 환불의 서버 값은
 * `REFUND_DEADLINE` 하나뿐이고(`GroupBetVoidReason` enum은 `INSUFFICIENT_PARTICIPANTS`·
 * `CHALLENGE_DELETED`·`REFUND_DEADLINE` 셋이 전부다), 앱이 파생하던 `AUTO_REFUND`는 서버가
 * 사유를 안 주던 시절의 폴백이다. 둘을 갈라 두니 **같은 사건에 문구가 둘**이 됐고, 실제
 * 응답에는 사유가 실려 오므로 사용자는 늘 `REFUND_DEADLINE` 쪽 문구만 봤다 — 그게
 * 「기한이 지나 **무효**」였다. 돈을 돌려받은 사람에게 무효라고 말한 셈이다(codex 리뷰).
 * 두 키를 하나로 접고 문구를 환불 계열로 바로잡는다. 폴백 값 `'AUTO_REFUND'`는 별칭으로만
 * 남아 같은 키로 접힌다.
 */
export type VoidReasonKey = 'SHORT_PARTICIPANTS' | 'CHALLENGE_DELETED' | 'REFUND_DEADLINE';

// 서버 값 → 키. 값 축이 문서 간 이문 상태다 — policy N33은 `INSUFFICIENT_PARTICIPANTS`,
// LLD §2.1은 `SHORT_PARTICIPANTS`. **둘 다 같은 키로 접는다**(어느 쪽이 와도 같은 문장).
const VOID_REASON_ALIASES: Readonly<Record<string, VoidReasonKey>> = {
  SHORT_PARTICIPANTS: 'SHORT_PARTICIPANTS',
  INSUFFICIENT_PARTICIPANTS: 'SHORT_PARTICIPANTS',
  CHALLENGE_DELETED: 'CHALLENGE_DELETED',
  REFUND_DEADLINE: 'REFUND_DEADLINE',
  // 앱 파생 폴백(아래 pickLastSettled) — 서버가 보내는 값이 아니다. 뜻이 REFUND_DEADLINE과
  // 같으므로 같은 키로 접는다. 갈라 두면 같은 사건에 문구가 둘 생긴다.
  AUTO_REFUND: 'REFUND_DEADLINE',
};

// 키별 문구 조각. summary = 카드 한 줄(집계 자리를 대신한다), cause = 시트 배너의 앞 문장.
// 배너는 여기에 환불 사실을 이어 붙인다 — 돈이 어디 갔는지 침묵하면 "코인이 사라졌다"로 읽힌다.
const VOID_REASON_LABELS: Readonly<Record<VoidReasonKey, { summary: string; cause: string }>> = {
  SHORT_PARTICIPANTS: { summary: '참가자가 부족해 무산', cause: '참가자가 부족해 무산됐어요' },
  CHALLENGE_DELETED: { summary: '챌린지 삭제로 무효', cause: '챌린지가 삭제돼 무효가 됐어요' },
  // 24h 초과 자동 환불 — **무효가 아니라 환불**이다. 정본 문구는 IA §4.3의
  // `정산이 지연돼 참가비를 돌려드렸어요`이고, 아래 REFUNDED_TAIL이 뒷문장을 맡으므로
  // cause에는 앞부분만 둔다(다른 사유들과 같은 조립 규칙).
  REFUND_DEADLINE: { summary: '정산이 지연돼 환불', cause: '정산이 지연됐어요' },
};

// 환불 사실 — 두 화면이 같은 문장을 쓴다(카드는 자리가 좁아 요약만, 시트는 여기까지 말한다).
const REFUNDED_TAIL = '참가비는 돌려드렸어요';

/**
 * 24시간 초과 자동 환불의 요약 — **달성자가 없어서가 아니라** 정산이 24시간을 넘겨 환불된
 * 회차다(IA §4.2 상태도). 달성자 0명은 `FORFEITED`(적립금 소멸)로 갈린다.
 *
 * 사유가 실려 오면(정상 응답) `voidSummary('REFUND_DEADLINE')`이 같은 값을 내고, 사유 없이
 * 상태만 온 `REFUNDED`(구서버)는 내역이 이 상수로 떨어진다 — **두 경로가 한 문자열**이다.
 * 표에서 직접 꺼내는 이유도 그것이다(사본을 만들면 화면마다 말이 갈린다).
 */
export const AUTO_REFUND_SUMMARY = VOID_REASON_LABELS.REFUND_DEADLINE.summary;

/**
 * 서버 사유 값 → 정규화 키. 모르는 값·없음은 null — **폴백 판단도 여기 한 곳**에서 난다.
 * (카드는 종전 달성 집계 문장으로, 시트는 종전 환불 배너로 각각 떨어진다.)
 */
export function voidReasonKey(voidReason: string | null | undefined): VoidReasonKey | null {
  if (!voidReason) return null;
  return VOID_REASON_ALIASES[voidReason] ?? null;
}

/**
 * 카드 '지난 결과' 한 줄의 **무효화 요약** — 무산·삭제 환불은 판정을 한 적이 없으므로
 * 「N명 중 0명 달성」으로 적으면 시트를 열기도 전에 카드가 거짓을 말한다(#570 codex ①).
 */
export function voidSummary(voidReason: string | null): string | null {
  const key = voidReasonKey(voidReason);
  return key === null ? null : VOID_REASON_LABELS[key].summary;
}

/**
 * 결과 시트의 **무효화 배너** — 사유 + 돈의 행방까지 말한다(LastBetResultSheet가 이걸 쓴다).
 * 같은 표에서 나오므로 카드 요약과 분류가 갈릴 수 없다.
 */
export function voidBanner(voidReason: string | null): string | null {
  const key = voidReasonKey(voidReason);
  return key === null ? null : `${VOID_REASON_LABELS[key].cause}. ${REFUNDED_TAIL}`;
}

/** 표시 모델 + v2에만 있는 곁가지(무효화 사유) — 시트가 문장을 가르는 데 쓴다. */
export interface LastSettledView {
  bet: LastSettledBet;
  // VOIDED에서만 값이 있다. 이 값이 있으면 "달성한 사람이 없어 전원 환불"이 **거짓**이므로
  // 시트가 사유별 문장으로 갈아 끼운다(#570 codex ④). 구서버·모르는 값이면 null(종전 문장).
  voidReason: string | null;
}

/**
 * 카드가 그릴 '지난 결과' 1건. 없으면 null.
 *
 * v2 필드가 있으면 그것이 정본이고(회차 모델), 없으면 구서버 `lastSettledBet`로 폴백한다 —
 * 서버 배포가 앱보다 늦어도(그 반대여도) 카드가 빈 채로 남지 않는다.
 */
export function pickLastSettled(challenge: GroupChallengeResponse): LastSettledView | null {
  const session = challenge.lastSettledSession ?? null;
  if (session !== null) {
    const status = toDisplayStatus(session.status);
    if (status === null) return null;
    return {
      bet: {
        betDate: session.sessionDate,
        stake: session.stake,
        pot: session.pot,
        status,
        results: session.results,
        goalMinutes: session.goalMinutes,
      },
      // v2 `REFUNDED`는 **24시간 자동 환불**이라 판정도 무산도 아니다 — 그대로 두면 "달성한
      // 사람이 없어 전원 환불"(구 룰 문장)로 접혀 거짓이 된다(#570 codex ⑤).
      // 실제 서버는 사유(`REFUND_DEADLINE`)를 함께 내려주므로 대개 `??` 왼쪽이 쓰인다.
      // `'AUTO_REFUND'`는 사유를 안 주던 구서버용 폴백이고, 별칭 표에서 `REFUND_DEADLINE`과
      // **같은 키로 접혀** 문구가 갈리지 않는다(codex 리뷰).
      voidReason:
        session.status === 'VOIDED'
          ? (session.voidReason ?? null)
          : session.status === 'REFUNDED'
            ? (session.voidReason ?? 'AUTO_REFUND')
            : null,
    };
  }
  const legacy = challenge.lastSettledBet ?? null;
  return legacy === null ? null : { bet: legacy, voidReason: null };
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
