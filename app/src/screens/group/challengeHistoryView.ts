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
import { AUTO_REFUND_SUMMARY, voidSummary } from './lastSettledView';
import { categoryLabel, missionLabel } from './components/challengeLabel';
import { progressFraction } from './components/progressFormat';

/** 미참가 회차의 손익 자리 — 그룹 축 목록이라 내가 안 낀 날도 함께 실린다. */
export const NOT_JOINED_TEXT = '미참여';
/** 환불로 끝난 날의 손익 자리 — 숫자 0은 "0코인 벌었다"로 읽혀 환불 사실을 지운다. */
export const REFUNDED_TEXT = '환불';

/**
 * 한 줄의 미션 라벨 — **회차에 박제된 스냅샷**으로 만든다(챌린지 행이 삭제됐을 수 있다).
 * 카드·시트와 같은 문장 규칙을 쓰도록 challengeLabel에 그대로 위임한다.
 *
 * 스냅샷이 모자라는 세 단계를 뭉개지 않는다(손익 3상과 같은 원칙 — 모르는 것을 지어내지 않는다):
 *   · 카테고리를 모른다              → **null**. 라벨 자리를 비운다. `categoryLabel` 폴백은
 *     null을 FOCUS로 뭉개 「집중 시간」이라고 **단언**한다 — 과거 스크린타임 이력이 집중
 *     챌린지로 보인다(카테고리는 이 목록에서 가장 크게 갈리는 축이라 오표기 비용이 크다).
 *   · 카테고리만 안다(방식 null)   → 카테고리 명사. 시간·목표를 지어내지 않는다.
 *   · 문장을 못 만든다(목표·창 부재) → 종전대로 카테고리 명사.
 *
 * ⚠️ **창 문장에서 「매일」을 뺀다**(`everyday: false`) — 카드와 유일하게 다른 자리다.
 *    카드는 요일 배지를 같은 화면에 세워 「매일 …」을 곧바로 정정하지만, 이력 DTO에는
 *    `repeatDays`가 없고 이 목록에는 배지도 없다. 그대로 두면 **월요일에만 도는 챌린지의
 *    지난 기록이 "매일 실행된 목표"로 설명된다**(codex 리뷰). 없는 사실을 말하느니 창만 적는다
 *    — policy §A9의 목록 시안도 요일 없는 창 문장이다.
 *
 * ⚠️ **스크린타임에는 목표 방향(「이하」)을 싣는다**(`direction: true`) — 두 번째로 카드와
 *    다른 자리다. 스크린타임은 집중과 판정 방향이 반대라(채우는 게 아니라 유지) 방향을 빼면
 *    `55/60분`이 **달성으로 찍힌 줄**이 모순으로 읽힌다. 카드에는 방향 캡션이 따로 서지만
 *    이 목록엔 캡션 자리가 없어 라벨이 유일한 설명이다(codex 리뷰 · policy §A9 시안
 *    `하루 폰 2시간 이하`). 여기서도 문장 사본을 만들지 않고 옵션만 켠다.
 */
export function historyMissionLabel(item: GroupChallengeHistoryItem): string | null {
  const { missionCategory, missionType } = item;
  if (missionCategory === null) return null;
  if (missionType === null) return categoryLabel({ missionCategory });
  const source = {
    missionCategory,
    missionType,
    // 스냅샷의 목표분이 곧 그날의 durationMinutes다(하루형·창형 공통).
    durationMinutes: item.goalMinutes,
    windowStart: item.windowStart,
    windowEnd: item.windowEnd,
  };
  return missionLabel(source, { everyday: false, direction: true }) ?? categoryLabel(source);
}

/**
 * 결과 요약 — 목록에서 한 줄이 스스로 무슨 일이 있었는지 말해야 한다.
 *
 * 판정이 **일어난 날**만 달성 집계로 적는다: 무산·삭제 무효화는 판정을 한 적이 없어
 * 「N명 중 0명 달성」이 거짓이 된다(#570에서 카드가 실제로 거짓말했던 자리).
 * 결말로 끝난 날(REFUNDED·FORFEITED)도 집계보다 결말이 정보다 — 그 문장을 쓴다.
 *
 * ⚠️ **REFUNDED는 달성자가 없어서 생기는 상태가 아니다** — 정산 시도가 24시간을 넘겨 자동
 *    환불된 회차다(IA §4.2 상태도 · §4.3). 달성자 0명은 `FORFEITED`(적립금 소멸)로 갈린다.
 *    「달성한 사람이 없어 전원 환불」이라고 적으면 자동 환불을 받은 사용자에게 **원인을
 *    틀리게** 알려준다(codex 리뷰). 문구는 카드가 쓰는 공용 표의 AUTO_REFUND 그대로다 —
 *    같은 상태를 화면마다 다른 말로 설명하면 그게 다음 버그다.
 */
export function historySummary(item: GroupChallengeHistoryItem): string {
  // 사유가 실려 오면 상태로 역추론하지 않고 그 값을 그대로 분기한다(N55 — 사유 축은 종료 사유다).
  const reason = voidSummary(item.voidReason);
  if (reason !== null) return reason;
  if (item.status === 'VOIDED') return '무산돼 전원 환불';
  // 사유가 없거나(구서버) 모르는 값인 REFUNDED — 상태 자체가 24시간 초과 자동 환불을 뜻한다.
  if (item.status === 'REFUNDED') return AUTO_REFUND_SUMMARY;
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
 *
 * ⚠️ **화면에 보이는 것은 전부 여기 있어야 한다.** 카드 컨테이너가 `accessible`이라 자식
 *    `Text`는 개별적으로 읽히지 않는다 — 이 문자열이 그 줄의 전부다. 참가비·적립금이 빠져
 *    있었고, 돈이 오간 기록을 보는 화면에서 스크린 리더 사용자만 판돈과 총액을 확인할 수
 *    없었다(codex 리뷰). 숫자에는 단위(코인)를 붙인다 — 붙이지 않으면 "삼십"만 읽힌다.
 *
 * 순서는 카드의 시각 순서를 따른다(날짜 → 미션 → 요약·근거 → 참가비·적립금). 손익만
 * 마지막이다: 날짜 줄 오른쪽 끝에 있지만 그 줄의 결론이라 끝에서 읽는 편이 낫다(종전 유지).
 */
export function historyRowA11y(item: GroupChallengeHistoryItem, dateText: string): string {
  const parts = [
    dateText,
    item.challengeDeleted ? '삭제된 챌린지' : null,
    historyMissionLabel(item),
    historySummary(item),
    historyBasis(item),
    `참가비 ${item.stake}코인`,
    `적립금 ${item.pot}코인`,
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
