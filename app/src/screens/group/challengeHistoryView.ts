// 그룹 챌린지 내역 한 줄의 **표시 모델** (GROMO-1277 · policy §A9 · N6-1).
//
// 화면(GroupChallengeHistoryScreen)은 이 파일이 만든 문자열만 그린다 — 목록 한 줄의 판단
// (무엇을 요약으로 적을지 · 내 손익을 어떻게 부호로 적을지 · 미참가를 어떻게 말할지)이
// FlatList renderItem 안에 흩어지면 테스트할 수 없고, 다음 사람이 조건을 하나 더 얹는다.
//
// ⚠️ **무효화 사유 문구는 여기서 만들지 않는다.** `lastSettledView`의 공용 매핑(voidSummary)에
//    위임한다 — 카드 한 줄과 결과 시트가 각자 switch를 들고 있다가 갈라졌던 재발 구조를
//    이번 배치에서 두 번 고쳤다(#570). 세 번째 사본을 만들지 않는다.
//
// ⚠️ 문구에 「회차」를 쓰지 않는다(N28 · FR-9-3) — 날짜·요일이 이미 그 뜻을 말한다.
//    코드 식별자(session…)는 그대로다.
import type { GroupChallengeHistoryItem } from '@/types/dto/group';
import { voidSummary } from './lastSettledView';
import { categoryLabel, missionLabel } from './components/challengeLabel';
import { progressFraction } from './components/progressFormat';

/** 미참가 회차의 손익 자리 — 그룹 축 목록이라 내가 안 낀 날도 함께 실린다. */
export const NOT_JOINED_TEXT = '미참여';
/** 환불로 끝난 날의 손익 자리 — 숫자 0은 "0코인 벌었다"로 읽혀 환불 사실을 지운다. */
export const REFUNDED_TEXT = '환불';

/**
 * 한 줄의 미션 라벨 — **회차에 박제된 스냅샷**으로 만든다(챌린지 행이 삭제됐을 수 있다).
 * 카드·시트와 같은 문장 규칙을 쓰도록 challengeLabel에 그대로 위임한다.
 * 스냅샷이 모자라면(V39 백필 이전 정산분) 카테고리 명사로 떨어진다 — 목표를 지어내지 않는다.
 */
export function historyMissionLabel(item: GroupChallengeHistoryItem): string {
  const source = {
    missionCategory: item.missionCategory,
    missionType: item.missionType,
    // 스냅샷의 목표분이 곧 그날의 durationMinutes다(하루형·창형 공통).
    durationMinutes: item.goalMinutes,
    windowStart: item.windowStart,
    windowEnd: item.windowEnd,
  };
  return missionLabel(source) ?? categoryLabel(source);
}

/**
 * 결과 요약 — 목록에서 한 줄이 스스로 무슨 일이 있었는지 말해야 한다.
 *
 * 판정이 **일어난 날**만 달성 집계로 적는다: 무산·삭제 무효화는 판정을 한 적이 없어
 * 「N명 중 0명 달성」이 거짓이 된다(#570에서 카드가 실제로 거짓말했던 자리).
 * 승자 0명의 결말(REFUNDED·FORFEITED)도 집계보다 결말이 정보다 — 그 문장을 쓴다.
 */
export function historySummary(item: GroupChallengeHistoryItem): string {
  const reason = voidSummary(item.voidReason);
  if (reason !== null) return reason;
  if (item.status === 'VOIDED') return '무산돼 전원 환불';
  if (item.status === 'REFUNDED') return '달성한 사람이 없어 전원 환불';
  if (item.status === 'FORFEITED') return '아무도 달성하지 못해 참가비 소멸';
  return `${item.participantCount}명 중 ${item.achievedCount}명 달성`;
}

/** 손익 자리의 색 축 — 숫자에만 부호 색을 준다(문구 자리는 중립). */
export type HistoryDeltaTone = 'plus' | 'minus' | 'zero' | 'muted';

/**
 * 내 손익 한 칸. payout은 '받은 금액'이라 그대로 적으면 참가비를 낸 사실이 지워진다 —
 * 손익(payout − stake)으로 환산한다(결과 시트 deltaText와 같은 규칙).
 *
 * 세 갈래를 뭉개지 않는다:
 *   · myPayout null  = **미참가**  (그룹 축이라 남의 회차도 목록에 있다 — 0코인이 아니다)
 *   · 환불로 끝난 날  = `환불`      (돌려받았다는 사실이 `0`보다 정확하다)
 *   · 그 밖          = `+45`/`−30` (몰수는 payout 0이라 자연히 −stake로 떨어진다)
 */
export function historyDelta(item: GroupChallengeHistoryItem): {
  text: string;
  tone: HistoryDeltaTone;
} {
  if (item.myPayout === null) return { text: NOT_JOINED_TEXT, tone: 'muted' };
  if (item.status === 'VOIDED' || item.status === 'REFUNDED') {
    return { text: REFUNDED_TEXT, tone: 'zero' };
  }
  const delta = item.myPayout - item.stake;
  if (delta > 0) return { text: `+${delta}`, tone: 'plus' };
  if (delta < 0) return { text: `${delta}`, tone: 'minus' };
  return { text: '0', tone: 'zero' };
}

/**
 * 내 판정 근거(정산에 쓴 기록 분) — 인별 명단이 없는 그룹 축 목록에서 **내 숫자만은** 남긴다.
 * 미참가·미계측(null)은 근거 자체를 그리지 않는다 — 없는 숫자를 '0분'으로 지어내지 않는다.
 */
export function historyBasis(item: GroupChallengeHistoryItem): string | null {
  if (item.myPayout === null || item.myProgressMinutes === null) return null;
  return progressFraction(item.myProgressMinutes, item.goalMinutes);
}

/**
 * 행 전체를 한 덩어리로 읽는 음성 라벨 — 따로 읽히면 `—`·`+45`가 맥락 없이 발음된다
 * (진행 리스트·결과 시트의 rowA11y와 같은 이유).
 */
export function historyRowA11y(item: GroupChallengeHistoryItem, dateText: string): string {
  const parts = [
    dateText,
    item.challengeDeleted ? '삭제된 챌린지' : null,
    historyMissionLabel(item),
    historySummary(item),
    historyBasis(item),
    historyDeltaA11y(item),
  ];
  return parts.filter((p) => p !== null).join(', ');
}

// 손익의 음성 표기 — '+45'는 "플러스 사십오"로 읽혀 단위가 사라진다. 코인까지 말한다.
// '0'도 마찬가지로 숫자만 읽히면 무슨 0인지 알 수 없어 사실을 문장으로 옮긴다.
function historyDeltaA11y(item: GroupChallengeHistoryItem): string {
  const { text, tone } = historyDelta(item);
  if (tone === 'muted') return text;
  if (tone === 'zero') return text === REFUNDED_TEXT ? '참가비 환불' : '변동 없음';
  const payout = item.myPayout ?? 0;
  const amount = Math.abs(payout - item.stake);
  return tone === 'plus' ? `${amount}코인 획득` : `${amount}코인 손실`;
}

/**
 * FOCUS 창의 5분 관용치 안내를 세울까 — 결과 시트와 같은 조건이다: 창형 집중이면서
 * **실측 분이 실제로 그려질 때만**. 숫자가 하나도 없으면 모순으로 읽힐 대상이 없다.
 *
 * 구 화면은 이 판단을 route param(챌린지 1개의 미션 메타)으로 했다. 그룹 축 목록은 여러
 * 챌린지가 섞이므로 **줄마다 실린 스냅샷**으로 판단한다 — 진입 경로에 기대지 않는다.
 */
export function showToleranceNotice(items: readonly GroupChallengeHistoryItem[]): boolean {
  return items.some(
    (item) =>
      item.missionCategory === 'FOCUS' &&
      item.missionType === 'TIME_WINDOW' &&
      historyBasis(item) !== null,
  );
}
