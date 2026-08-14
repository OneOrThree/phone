import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View, type AlertButton } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import {
  BET_CANCEL_FORBIDDEN,
  BET_CANCEL_HAS_OTHERS,
  BET_LEAVE_CLOSED,
  BET_NOT_JOINED,
  BET_NOT_OPEN,
  BET_SESSION_NOT_FOUND,
  cancelBet,
  challengeGroupId,
  getChallengeDeletionPreview,
  getMyOpenBetSessions,
  groupErrorCode,
  leaveBet,
  leaveSession,
} from '@/services/groupApi';
import { logGroupBetCanceled } from '@/services/analyticsEvents';
import { useCoins } from '@/store/CoinContext';
import { useToast } from '@/store/ToastContext';
import { useOverlayAlert } from '@/store/useOverlayAlert';
import { todayStrKst } from '@/utils/localDate';
import { nowSecondsInZone, timeStrToSeconds } from '@/utils/challengeTime';
import type {
  ChallengeDeletionPreviewResponse,
  ChallengeMemberProgress,
  GroupChallengeResponse,
} from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';
import {
  REPEAT_DAY_LABELS,
  REPEAT_DAY_ORDER,
  fmtMonthDayDow,
  fmtRelativeDay,
  hhmmOf,
  kstDateOfInstant,
  repeatDayOf,
  weekRemainingActiveDates,
} from '../challengeSchedule';
import { pickLastSettled, voidSummary } from '../lastSettledView';
import { categoryLabel, missionLabel } from './challengeLabel';
import {
  UNMEASURED,
  progressFraction,
  progressFractionA11y,
  unmeasuredA11y,
} from './progressFormat';
import ChallengeDeleteSheet from './ChallengeDeleteSheet';
import JoinNextSheet from './JoinNextSheet';
import JoinWeekSheet, { type JoinWeekEntry } from './JoinWeekSheet';
import LastBetResultSheet from './LastBetResultSheet';

// 챌린지 카드(그룹방 챌린지 섹션 1장) — 명세 docs/app/group-plan-2.md §3-2.
//
// 미션 라벨 + 멤버별 진행 리스트. 방장은 우측 상단 X 버튼으로 삭제한다(GROMO-1101 —
// 옛 롱프레스는 발견 가능성이 0이라 힌트 캡션까지 필요했다. 오탭 시 되돌릴 방법이 없는 동작이라
// 확인 Alert 한 겹은 그대로 둔다).
//
// ⚠️ 진행 표기 3상(§3-2) — 0과 null을 뭉개지 않는다:
//     achieved === true   → '달성 ✓'
//     progressMinutes 값  → '32/60분'  (FOCUS는 목표까지 얼마나 채웠나, SCREEN_TIME은 예산을 얼마나 썼나)
//     progressMinutes null→ '—'        (SCREEN_TIME 미집계 — '0분 썼다'와 완전히 다른 뜻이다)
//
// memberProgress 자체가 null이면 리스트 대신 한 줄 캡션을 둔다 — 신서버(V20+)는 창(TIME_WINDOW)
// 진행률도 채워 주지만, 구서버·목표분 없는 구 창 챌린지는 여전히 null을 준다.
// 아무 설명 없이 비우면 '아무도 안 했다'로 읽힌다.

// SCREEN_TIME 챌린지는 '많이 할수록 좋은' 집중과 반대 방향이라 카드에 뜻을 한 줄 적는다(§3-2).
const SCREEN_TIME_CAPTION = '오늘 스크린타임을 목표 이하로 유지해요';
// SCREEN_TIME 창(TIME_WINDOW) 카드의 측정 한계 고지 — 계약이 문구까지 고정했다
// (contract.md §2 "카드·시트 안내 문구 필수"). 15분 눈금 버킷 측정이라 오차·누락이 구조적이고,
// 이 판정 위로 코인이 움직일 수 있어(내기) 카드에도 상시 노출한다.
const WINDOW_MEASURE_CAPTION =
  '사용 시간은 15분 단위로 집계돼 오차가 있을 수 있어요. 앱 버전이나 기기 상태에 따라 집계가 늦거나 누락될 수 있어요';
// 서버가 canParticipate=false를 준 경우 — 스크린타임 권한이 없어 이 그룹에서 집계가 안 된다.
const NO_PERMISSION_CAPTION = '스크린타임 권한이 없어 참여할 수 없어요';
// '—'가 실제로 뜬 SCREEN_TIME 카드에만 — 기호만 봐서는 0분인지 값이 없는 건지 알 수 없다.
const UNMEASURED_CAPTION = '— 는 아직 집계되지 않았어요';
// memberProgress 자체가 null인 챌린지(TIME_WINDOW) — 리스트를 그냥 비우면 '아무도 안 했다'로 읽힌다.
const NO_PROGRESS_CAPTION = '이 챌린지는 진행률을 표시하지 않아요';
// 이미 오늘 목표를 채운 사람은 참가할 수 없다(무위험 참가 차단 — 백 명세 결정 7).
// 버튼만 잠그면 왜 안 눌리는지 알 방법이 없어 사유를 한 줄로 적는다.
const BET_ACHIEVED_CAPTION = '이미 오늘 목표를 달성해서 참가할 수 없어요';
// 개설자는 자동 참가라(계약 §2-1) 달성자는 **개설도** 거절된다(BET_ALREADY_ACHIEVED, 409).
// 같은 사실이지만 막히는 동작이 달라 문장을 따로 둔다 — '참가할 수 없어요'는 참가 버튼이 없는
// 카드에서 무엇이 막혔는지 말해 주지 못한다.
const BET_ACHIEVED_CREATE_CAPTION = '이미 오늘 목표를 달성해서 내기를 열 수 없어요';
// SCREEN_TIME은 차단 방향이 반대다(계약 §2 참가 가드 행) — 달성은 하루/창이 끝나야 확정이라
// '잠정 달성'은 참가를 막지 않고, **이미 목표를 초과해 확정 패배**한 사람만 막는다
// (BET_ALREADY_FAILED — 질 게 확정된 판돈 투입 방지). 문장도 방향에 맞춘다.
const BET_FAILED_CAPTION = '이미 목표를 초과해서 참가할 수 없어요';
const BET_FAILED_CREATE_CAPTION = '이미 목표를 초과해서 내기를 열 수 없어요';
// 철회 직후의 사실 고지 — 영역을 그냥 비우면 방금 한 일이 사라진 것처럼 보인다(betLocked와 같은 이유).
// 재참여할 수 있는 철회에서는 참가 진입점 **아래**에 붙는다(GROMO-1112) — 캡션만 남기고 버튼을
// 걷어 버리면 한 번 빠진 사람은 다음 재조회 전까지 다시 들어갈 방법이 없다.
const BET_LEFT_CAPTION = '참여를 취소했어요. 참가비는 잔액으로 돌아왔어요';
// 취소(당일 단독 개설자 carve-out) 직후의 자리 표시 — 누른 버튼(「참여 취소」)과 같은 동사로
// 말하되, 여기서는 **내기 자체가 닫힌다**는 결과가 하나 더 있어 그 사실까지 적는다(N27로
// 두 버튼 문구가 「참여 취소」로 합쳐진 뒤에도 두 결말은 여전히 다르다).
const BET_CANCELED_CAPTION = '참여를 취소해 내기가 닫혔어요. 참가비는 잔액으로 돌아왔어요';
// 휴면 챌린지(GROMO-1201) — OPEN 내기가 없고 과거 내기 이력만 남았다. 서버는 마지막 참가자가
// 철회해도 챌린지를 지우지 않고 남겨 두므로(백엔드 테스트가 잠근다) 카드가 사유를 한 줄로 말한다.
// 배지 문구 '휴면'은 계약 §2 고정 — '비활성'은 INACTIVE 노출 대비 예약어라 쓰지 않는다.
const DORMANT_CAPTION = '참가자가 없어요';
// 비활성 요일(FR-16-2) — 카드를 감추지 않고 진행 리스트 자리에 쉬는 날임을 적는다.
// 진행률을 재지 않는 날이라(서버 memberProgress null) '아무도 안 했다'로 읽히면 안 된다.
const REST_CAPTION = '오늘은 쉬는 날이에요';
// 창(TIME_WINDOW) 시각의 해석 시간대 — 계약 §1: 저장된 창 시각은 Asia/Seoul 벽시계다.
// 서버 "HH:mm:ss"와 현재를 같은 벽시계 공간에서 비교한다(challengeTime 유틸 관례).
const KST_ZONE = 'Asia/Seoul';

// 'YYYY-MM-DD' → '7월 31일'. 연도는 넣지 않는다 — '지난 내기'는 늘 최근 며칠이다.
// '7/31' 축약은 날짜인지 비율인지 한눈에 안 읽혀 단위를 붙인다(ChallengeResultModal과 같은 표기).
// 형식이 다르면 원문을 그대로 둔다(서버가 다른 포맷을 주면 깨진 날짜보다 원문이 낫다).
function monthDay(betDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(betDate);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : betDate;
}

// 취소 유예 카운트다운을 켜는 창 — 이보다 멀면 타이머를 걸지 않는다(예약분·창형은 몇 시간
// 뒤가 마감이라 매초 타이머가 순수 낭비다). 실제로 다투는 구간은 하루형의 5분 유예다.
const LEAVE_COUNTDOWN_WINDOW_SEC = 3600;

/**
 * 취소 유예 초읽기 — **이 자식만 매초 리렌더된다**(#570 codex ⑤).
 *
 * 타이머를 카드 본체에 두면 진행 리스트·시트까지 매초 다시 그려진다. 그래서 남은 시간 표시만
 * 떼어 자식으로 두고, 부모 상태는 **마감에 닿는 순간 한 번만** 건드린다(onExpire) — 그때
 * 버튼이 함께 사라진다. 마감이 지났는데 버튼만 남아 있으면 눌러도 서버가 BET_LEAVE_CLOSED로
 * 거절하므로, "시간이 남아 보이는데 안 되는" 화면이 된다(그게 지적의 본체다).
 *
 * 언마운트·마감 도달 시 인터벌을 반드시 정리한다.
 */
export function LeaveCountdown({
  deadlineMs,
  onExpire,
  testID,
}: {
  deadlineMs: number;
  onExpire: () => void;
  testID?: string;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (Date.now() >= deadlineMs) {
      onExpire();
      return;
    }
    const id = setInterval(() => {
      const t = Date.now();
      setNowMs(t);
      if (t >= deadlineMs) {
        clearInterval(id);
        onExpire();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [deadlineMs, onExpire]);

  const sec = Math.max(0, Math.floor((deadlineMs - nowMs) / 1000));
  const m = Math.floor(sec / 60);
  const rest = sec % 60;
  return (
    <Text style={s.caption} testID={testID}>
      {m > 0 ? `${m}분 ${rest}초 안에 취소할 수 있어요` : `${rest}초 안에 취소할 수 있어요`}
    </Text>
  );
}

// 다음 활성일 문구(FR-16-1) — 상대·절대를 섞는다(ux §02 note): 오늘·내일이면 그대로, 그 밖은
// '다음 8/12(수)'. "3일 뒤" 같은 상대 표현은 쓰지 않는다 — 요일 반복에서는 날짜가 곧 정보다.
function nextDayPhrase(dateStr: string, today: string, time: string | null): string {
  const rel = fmtRelativeDay(dateStr, today);
  const timePart = time !== null ? ` ${time}` : '';
  return rel === '오늘' || rel === '내일' ? `${rel}${timePart}` : `다음 ${rel}${timePart}`;
}

// 멤버 한 명의 진행 표기 — 위 3상 규칙 그대로.
// 미집계·기록 분 조각은 결과 모달과 공유한다(progressFormat) — 달성 표기만 여기 고유다.
function progressText(p: ChallengeMemberProgress, durationMinutes: number | null): string {
  if (p.progressMinutes === null) return UNMEASURED;
  if (p.achieved) return '달성 ✓';
  return progressFraction(p.progressMinutes, durationMinutes);
}

// 행 전체를 한 덩어리로 읽히게 한다 — 안 묶으면 VoiceOver가 닉네임과 진행을 따로 읽고
// '—'를 "대시"로 발음해 미집계라는 뜻이 전달되지 않는다.
function progressA11y(p: ChallengeMemberProgress, durationMinutes: number | null): string {
  if (p.progressMinutes === null) return unmeasuredA11y(p.nickname);
  if (p.achieved) return `${p.nickname} 달성`;
  return progressFractionA11y(p.nickname, p.progressMinutes, durationMinutes);
}

// 내기 시트를 어떤 모드로 열 것인가 — 개설(아직 내기 없음) / 참가(OPEN 내기에 합류).
export type BetSheetMode = 'create' | 'join';

// '지난 내기' 영역이 지금 무엇을 열고 있나(GROMO-1221) — 시트와 히스토리 화면 push는 배타다.
//   null                : 아무것도 안 열림
//   { kind: 'last' }    : 지난 내기 결과 시트(GROMO-1099)가 떠 있다
//   { kind: 'history' } : 시트를 걷고 히스토리 화면 push 대기 — 커밋 후 이펙트가 소비한다.
// boolean 두 개가 아니라 유니온 하나인 이유: 시트 열림과 push가 동시에 참이 될 조합 자체를
// 타입에서 없앤다 — 네이티브 모달(SheetShell asModal)이 뜬 채로 push 하면 새 화면이 모달
// 아래 깔리거나 전환이 씹히는 플랫폼 이슈가 있어 '닫힌 뒤 push'가 불변식이다.
type LastBetView = { kind: 'last' } | { kind: 'history' } | null;

export interface ChallengeCardProps {
  challenge: GroupChallengeResponse;
  // 내가 방장인가 — 롱프레스 삭제 진입점을 여는 조건.
  isOwner: boolean;
  // 내 userId — 진행 리스트에서 내 행을 맨 위로 올리고 강조하는 데만 쓴다.
  // 카드를 순수 표현 컴포넌트로 두려고 Context 대신 부모(GroupRoomScreen)가 내려준다.
  myUserId?: string | null;
  // 삭제 확인까지 끝난 뒤 호출 — 부모(GroupRoomScreen)가 API를 부르고 재조회한다.
  // Promise를 돌려주면 카드가 **완료를 기다린 뒤** 환불 잔액을 다시 받는다(#570 codex ③) —
  // 동기 콜백(구 호출부·테스트)도 그대로 받는다.
  onDelete: (challengeId: string) => void | Promise<void>;
  // 내기 시트 진입 — 시트 상태·API·재조회는 전부 부모가 쥔다(카드는 표현만).
  // 미전달이면 내기 영역 자체를 그리지 않는다 — 눌러도 아무 일이 없는 버튼을 세우지 않기 위해서다.
  onOpenBet?: (mode: BetSheetMode) => void;
  // 내기 진입점 잠금 — 부모가 성공 직후 재조회하는 동안 켠다. 그 창에서 카드는 아직 '내기 이전'
  // 모습이라 다시 누르면 같은 내기를 또 열려 하고, 서버가 BET_ALREADY_EXISTS로 튕긴다(3차 리뷰 F6).
  // 영역 자체는 그대로 둔다 — 사라졌다 나타나면 방금 한 일이 취소된 것처럼 보인다.
  betLocked?: boolean;
  // 카드가 서버 상태를 바꾼 직후(철회·취소 성공) 호출 — 부모가 챌린지 목록을 재조회한다.
  // 마지막 참가자가 철회해도 서버는 내기만 CANCELED로 닫고 챌린지는 남긴다(GROMO-1201 휴면) —
  // 재조회 없이는 닫힌 내기·휴면 표시가 다음 자연 재조회(포커스 복귀·당겨서 새로고침)까지
  // 낡은 모습으로 남는다.
  // ⚠️ 미전달이면 낙관 반영만으로 버틴다 — 다음 자연 재조회가 도착하면 그 응답이 낙관을 덮는다
  //    (아래 seenChallengeRef). 늦게 도착해도 표시가 어긋나지 않는다.
  onBetChanged?: () => void;
  // 이 카드가 소유한 시트(지난 결과·다음 활성일·주간·삭제)의 열림 상태 보고(GROMO-1578).
  // 넷 다 SheetShell asModal(RN 네이티브 Modal)이라 부모의 결과 모달과 겹치면 딤이 포개지고
  // 표시 순서가 플랫폼 재량이 된다 — 부모(GroupRoomScreen)가 이 값을 배타 조건에 넣어 결과
  // 모달을 미룬다. 열림이 갈릴 때마다 부르고, 언마운트 시 false로 정리한다.
  // ⚠️ **콜백 신원을 고정해서 넘겨라**(useCallback) — 매 렌더 새 함수를 주면 아래 정리 이펙트가
  //    렌더마다 재등록되며 false를 흘려, 시트가 떠 있는데도 열림이 취소된다.
  onSheetVisibilityChange?: (challengeId: string, open: boolean) => void;
  // **await 뒤에 여는 시트**(주간 예약·삭제 프리플라이트)의 승인 게이트(GROMO-1576).
  //
  // 왜 위 보고만으로 부족한가: 저 콜백은 시트가 **열린 뒤**의 사실을 알린다. 그런데 이 카드의
  // 시트 일부는 탭과 마운트 사이에 조회가 끼어 있어서, **여는 시점을 응답이 정한다.** 그 사이에
  // 루트의 챌린지 결과 모달이 slot을 얻어 노출까지 갈 수 있고, 조정자는 보유자를 뺏지 않으므로
  // 그대로 마운트하면 RN Modal 두 개가 겹친다. 그러면 결과 모달이 **사실상 안 보인 채**
  // seen 마커와 ack이 나간다(그 둘은 렌더 커밋 시점에 찍힌다 — 사용자가 인지한 시점이 아니다).
  //
  // 그래서 그 시트들만 이 게이트를 통과한 뒤에 마운트한다. `false`면 열지 않는다(화면이 blur
  // 됐거나 부모가 요청을 접었다). 미전달이면 종전대로 곧바로 연다.
  // ⚠️ 동기로 열리는 시트(지난 결과·다음 활성일)는 이 게이트를 타지 않는다 — 전면 모달이 떠
  //    있으면 그 버튼을 누를 수 없어 겹칠 수 없다(OverlaySlotContext의 A/B 판단).
  // ⚠️ 카드 신원을 실어 부른다 — 부모가 **요청을 카드에 묶어** 두어야, 승인을 기다리는 사이
  //    이 카드가 사라졌을 때(재조회에서 챌린지가 빠짐) 그 요청을 취소할 수 있다. 취소하지
  //    않으면 나중에 승인이 떨어져 **사라진 카드**가 자기 id를 부모의 열림 집합에 넣고,
  //    되돌릴 카드가 없어 전면 오버레이가 영구히 막힌다.
  onRequestSheetSlot?: (challengeId: string) => Promise<boolean>;
  // 이 카드가 시트 요청/승인을 **포기한다**는 신호 — 부모가 대기를 거절하고 자리를 푼다.
  // 부르는 자리 둘: 카드가 사라질 때(언마운트) · 확인 Alert에서 사용자가 물러났을 때.
  // ⚠️ 위 `onSheetVisibilityChange(id, false)`로 대신할 수 없다. 그 신호는 "시트가 닫혔다"와
  //    "카드가 포기했다"를 구분하지 못해, 닫힘 보고가 멀쩡히 대기 중인 요청까지 취소한다.
  //    포기를 알리지 않으면 반대로, 나중에 승인이 떨어져 **사라진 카드**가 자기 id를 부모의
  //    열림 집합에 넣고 되돌릴 주체가 없어 전면 오버레이가 영구히 막힌다.
  onAbandonSheetSlot?: (challengeId: string) => void;
  // 이 카드가 **네이티브 Alert를 쥐고 있는 구간**의 보고(GROMO-1576).
  //
  // 왜 필요한가: 부모(GroupRoomScreen)는 딥링크로 groupId가 갈릴 때 이 카드의 승인·요청을
  // 접는데(그룹 전환 블록), 그 판단은 **렌더 중**에 내려진다. 반면 카드의 언마운트 정리는
  // **커밋 뒤**라, "나 유예 중이다"를 그때 알려서는 이미 늦다. 그래서 유예의 근거가 되는
  // 사실 — "지금 네이티브 Alert를 들고 있다" — 를 **뜨는 순간** 올린다.
  // 부모는 이 값으로 **곧 보고할 카드**와 **영영 안 올 카드**를 구분한다: 전자의 승인만
  // 남기고 나머지는 종전대로 접는다. 근거 없이 남기면 빈 등록이 영구 점유가 된다.
  // ⚠️ 열림 보고(onSheetVisibilityChange)로 대신할 수 없다 — 그 신호는 "이 카드의 시트가
  //    떠 있다"는 뜻이고, 삭제 확인 Alert는 **시트를 열지 않은 채** 승인만 쥐고 있다.
  // ⚠️ **콜백 신원을 고정해서 넘겨라**(useCallback) — 다른 슬롯 콜백과 같은 이유다.
  onAlertHoldChange?: (challengeId: string, held: boolean) => void;
}

export default function ChallengeCard({
  challenge,
  isOwner,
  myUserId,
  onDelete,
  onOpenBet,
  betLocked,
  onBetChanged,
  onSheetVisibilityChange,
  onRequestSheetSlot,
  onAbandonSheetSlot,
  onAlertHoldChange,
}: ChallengeCardProps) {
  // 내기 참가 철회의 API·잔액 갱신을 카드가 직접 쥔다 — 시트(BetSheet)는 참가자
  // 상태에선 부모(GroupRoomScreen)의 stale 검사가 즉시 닫아 버려 진입 자체가 불가능하고,
  // 부모는 다른 워크스트림이 동시에 만지는 파일이라 이 배치에서도 배선을 늘리지 않았다
  // (재조회는 선택 콜백 onBetChanged로만 열어 둔다). groupId도 같은 이유로
  // prop이 아니라 groupApi의 조회 캐시(challengeGroupId)에서 역참조한다.
  const { refresh: refreshCoins } = useCoins();
  const { show } = useToast();
  // ── 이 카드가 띄우는 **모든** Alert의 입구(GROMO-1576) ─────────────────────────
  // 네이티브 Alert는 RN Modal **위에** 뜬다. 그래서 이 카드의 Alert가 떠 있는 동안 결과 모달이
  // 마운트되면, 사용자는 아무것도 못 봤는데 그 회차에 seen 마커와 ack이 나간다(둘 다 렌더 커밋
  // 시점에 찍힌다). 그 상태로 앱이 종료되면 정산 통지가 영구 유실된다.
  //
  // ⚠️ **왜 이 배치에서 함께 닫는가** — 예전엔 결과 모달이 GroupRoomScreen 소유라 **방 진입
  //    1회**에만 떴고, 카드 Alert가 떠 있는 중에 결과가 도착할 경로가 사실상 없었다. 이 배치가
  //    소유자를 루트로 옮기고 **제한적 재조회(30초×5회)**와 **BET_RESULT 포그라운드 재조회**를
  //    붙이면서, **화면에 머무는 중에도 결과가 도착**하게 됐다 — 발생 조건을 우리가 만들었다.
  //    "원래 있던 것"이 아니라 "이 PR이 창을 넓힌 것"이라 여기서 닫는다.
  //
  // 쓰는 법은 조정자 헤더의 A/B 축과 같다 — **여는 시점이 동기인가**로 갈린다.
  //   · 탭 핸들러에서 곧바로 뜨는 것(확인창·즉시 실패) → `showGatedAlert(...)` 동기.
  //   · `await` 뒤에 뜨는 실패 통보 → `showGatedAlert.afterSlot(...)`. 여는 시점을 응답이
  //     정하므로 기다리는 사이 결과가 먼저 노출될 수 있고, 그러면 그 **위를** 덮는다.
  // ⚠️ 단 **이미 자기 쪽이 자리를 쥐고 있으면 기다리지 않는다**(GroupCreateScreen에서 세운
  //    예외). 이 카드에서는 시트를 연 뒤 얹히는 Alert가 그 경우이고, 그쪽은 별도 입구인
  //    `alertOverCardSlot`이 맡는다(등록 유지까지 함께).
  // ⚠️ id에 챌린지를 실는다. 한 방에 카드가 여럿이라 고정 문자열을 쓰면 서로의 등록을 덮는다.
  const showGatedAlert = useOverlayAlert(`group.card.alert:${challenge.id}`);
  const [leaveBusy, setLeaveBusy] = useState(false);
  // 철회·취소 성공의 낙관 반영 — 재조회 응답이 도착하기 전까지는 카드가 스스로 '빠짐/닫힘'을
  // 그린다(onBetChanged를 받지 못한 카드는 다음 자연 재조회까지). betId를 쥐므로 같은 내기를
  // 다시 내려줘도 표시가 되돌아가지 않는다.
  // kind는 자리 캡션의 동사를 가른다 — 철회('빠졌어요')와 취소('취소했어요')는 누른 버튼이 다르다.
  const [closedBet, setClosedBet] = useState<{ betId: string; kind: 'leave' | 'cancel' } | null>(
    null,
  );
  // 철회·취소가 공유하는 연타 락 — 두 진입점은 배타 노출이라 같은 락 하나로 충분하다.
  const leaveLock = useRef(false);
  // 지난 내기 결과 시트(GROMO-1099) + 히스토리 push(GROMO-1221) — 데이터는
  // challenge.lastSettledBet 그대로, 열림 상태만 카드가 쥔다(유니온 근거는 타입 주석).
  const [lastBetView, setLastBetView] = useState<LastBetView>(null);
  // 히스토리 화면 push — 카드가 직접 navigation을 쥔다. 부모(GroupRoomScreen)는 형제
  // 워크스트림 전유라 콜백을 늘리지 않는다(철회의 groupId 역참조와 같은 이유). groupId도
  // 같은 이유로 prop이 아니라 groupApi의 조회 캐시(challengeGroupId)에서 꺼낸다.
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  // push는 **이펙트에서** 한다 — 'history'로 바뀐 커밋에서 시트(네이티브 모달)가 이미
  // 언마운트된 뒤에 navigate가 나가므로 '시트가 열린 채 push 금지' 불변식이 렌더 구조로
  // 보장된다(콜백에서 곧장 navigate 하면 같은 프레임에 모달 해제와 push가 겹친다).
  useEffect(() => {
    if (lastBetView?.kind !== 'history') return;
    setLastBetView(null);
    const groupId = challengeGroupId(challenge.id);
    if (groupId === null) {
      // 캐시 미적중(이론상 앱 재시작 직후뿐) — 철회·취소와 같은 공통 문구 결.
      showGatedAlert('기록을 열 수 없어요', '잠시 후 다시 시도해 주세요.');
      return;
    }
    // 그룹 축 내역 화면(GROMO-1277)으로 간다 — 이 진입점은 **이 챌린지만** 보는 필터다
    // (IA §1: 화면은 하나, 챌린지별 보기는 challengeId 필터). 미션 메타는 응답의 회차
    // 스냅샷에 실려 오므로 더 이상 route param으로 나르지 않는다.
    navigation.navigate('GroupChallengeHistory', {
      groupId,
      challengeId: challenge.id,
      // 필터로 들어왔다는 사실을 헤더가 말하게 한다 — 안 밝히면 그룹 전체 이력으로 읽힌다.
      // 방향(`이하`)을 켜서 넘긴다: 내역 화면엔 카드의 스크린타임 캡션 자리가 없어 이 라벨이
      // 필터 헤더의 유일한 설명이고, 방향이 빠지면 「하루 60분 스크린타임만 보는 중」이
      // 집중과 같은 뜻으로 읽힌다(codex 리뷰). 카드 본문 문구는 캡션이 맡으므로 그대로 둔다.
      challengeLabel: missionLabel(challenge, { direction: true }) ?? categoryLabel(challenge),
    });
  }, [lastBetView, challenge, navigation, showGatedAlert]);

  const label = missionLabel(challenge);
  const progress = challenge.memberProgress;
  // 내 행을 맨 위로 — 10명이면 닉네임을 눈으로 훑어야 내 진행률을 찾는다(리그 화면의 isMe 관행).
  // 나머지는 서버가 준 순서를 그대로 둔다.
  const rows = progress
    ? [
        ...progress.filter((p) => !!myUserId && p.userId === myUserId),
        ...progress.filter((p) => !myUserId || p.userId !== myUserId),
      ]
    : null;
  // 미집계 캡션은 '—'가 실제로 뜬 카드에만 — 없는 기호를 설명하면 노이즈다.
  const hasUnmeasured =
    challenge.missionCategory === 'SCREEN_TIME' &&
    !!rows &&
    rows.some((p) => p.progressMinutes === null);

  // 내기를 걸 수 있는 카드인가 — DURATION 전부 + 목표분 있는 TIME_WINDOW(계약 §2 내기 게이트,
  // 카테고리 제한 제거 — SCREEN_TIME도 리스크 수용으로 허용됐다). 목표분 없는 창 챌린지는
  // 판정 자체가 불가라 제외한다. 지원하지 않는 카드에는 '지난 내기'까지 **아무것도** 그리지 않는다.
  // openBet은 const라 아래 betSupported 안에서 좁혀진 타입이 그대로 유지된다 — 진입점마다 `?.`를
  // 또 붙이면 '없을 수도 있다'는 잘못된 신호가 남는다.
  const openBet = onOpenBet;
  // 이 서버가 내기를 아는가 — `bet` 필드가 **아예 없는** 응답은 '내기가 없다'가 아니라 '내기를
  // 모르는 구버전 서버'다(DTO에서 optional인 이유). undefined를 null로 뭉개면 순차 배포 구간 내내
  // 모든 카드에 눌러도 없는 엔드포인트로 나가 실패만 하는 '내기 걸기'가 선다(코덱스 리뷰).
  // 내기를 아는 서버는 없을 때 null을 **명시로** 내려준다(백 GroupChallengeResponse는 NON_NULL
  // 생략을 쓰지 않는다) — 백엔드가 그 DTO에 @JsonInclude(NON_NULL)을 붙이면 이 판정이 깨진다.
  // v2 내기 설정(#572/B8 additive) — **오늘 회차 유무와 무관한** 챌린지 단위 설정이다.
  // 서버는 "설정은 켜져 있는데 오늘 회차만 없는 날"(마지막 참가자 취소로 회차 삭제·lazy 개설 전)에
  // `bet=null`을 주는데, 그것만 보고 영역을 접으면 **참여할 수 없는 챌린지**가 된다.
  // `bet` 객체에 설정을 겹쳐 담지 않은 이유는 구앱 계약(`bet != null` → `betId` 유효)이 깨져서다.
  const betConfig = challenge.betConfig;
  const betKnown = challenge.bet !== undefined || betConfig !== undefined;
  const isWindow = challenge.missionType === 'TIME_WINDOW';
  const isScreenTime = challenge.missionCategory === 'SCREEN_TIME';
  const betSupported =
    !!openBet &&
    betKnown &&
    (challenge.missionType === 'DURATION' || (isWindow && challenge.durationMinutes != null));
  const bet = challenge.bet ?? null;
  // 끝난 챌린지에는 **새로 돈을 걸 수 없다** — 앱은 INACTIVE를 종료로 취급하는데(만들기 시트의
  // 중복 판정도 ACTIVE만 센다) 서버 개설 경로는 상태를 보지 않으므로, 진입점을 여는 쪽이 막는다
  // (코덱스 리뷰). 이미 걸린 내기·지난 내기는 그대로 읽힌다 — 막는 건 돈이 나가는 자리뿐이다.
  const betOpenable = challenge.status === 'ACTIVE';
  // 내가 지금 내기에 들어갈 수 없는 상태인가 — 개설·참가 진입점을 잠그는 근거다. 서버 가드와
  // 판정 근거를 맞춘다(계약 §2 참가 가드 행 — 카테고리별로 방향이 반대다):
  //   FOCUS       : 이미 달성(achieved === true) → 무위험 참가라 차단(BET_ALREADY_ACHIEVED)
  //   SCREEN_TIME : 이미 목표 초과(achieved === false) → 확정 패배라 차단(BET_ALREADY_FAILED).
  //                 achieved === true는 '잠정 달성'(지금까지 이하 유지)일 뿐이라 잠그면
  //                 사실상 전원이 잠긴다 — 절대 차단 근거로 쓰지 않는다.
  // null(미판정·미집계)은 어느 쪽으로도 세지 않는다 — 진행 리스트의 3상 규칙 그대로다.
  const myProgressRow = myUserId ? progress?.find((p) => p.userId === myUserId) : undefined;
  const myBlockedNow = isScreenTime
    ? myProgressRow?.achieved === false
    : myProgressRow?.achieved === true;
  // 잠금 사유 문장 — 카테고리에 따라 막힌 방향이 다르다(위 주석).
  const blockedCaption = isScreenTime ? BET_FAILED_CAPTION : BET_ACHIEVED_CAPTION;
  const blockedCreateCaption = isScreenTime
    ? BET_FAILED_CREATE_CAPTION
    : BET_ACHIEVED_CREATE_CAPTION;
  // 개설 진입점을 잠그는 이유 2가지(재조회 중 · 이미 확정) — 잠금 표시는 같고 사유만 다르다.
  const createBlocked = !!betLocked || myBlockedNow;
  // 내기 기준일 — 'YYYY-MM-DD'는 사전순이 곧 시간순이다. 철회의 '시작 전' 판정·'내일 시작' 배지·
  // 미래 내기 잠금 해제가 같이 쓴다. 서버가 오늘 내기가 없으면 내일 내기를 폴백으로 내려줄 수
  // 있고(계약 §3 응답 보수, W2), bet.date가 없으면(구서버) 조회일(오늘) 내기로 간주한다(DTO 주석).
  const betDate = bet?.date ?? todayStrKst();
  const isFutureBet = betDate > todayStrKst();
  // 참가 진입점 잠금 — FOCUS는 서버가 준 bet.myAchievedNow(이미 달성), SCREEN_TIME은 내 진행
  // 행의 확정 패배다. 스크린타임의 myAchievedNow는 표시용 잠정값이라 잠금에 쓰지 않는다(DTO 주석).
  // (joinBlockedNow 는 아래 회차 축 파생 뒤에 둔다 — todaySession 을 봐야 하기 때문이다.)
  // ── 참여 상태·표시값의 축: **회차(bet.session)가 정본, 레거시 최상위 필드는 폴백** ──
  // 브리지가 끝나면(1418) 서버는 정식 v2 형태(`enabled`·`stake`·`session`)만 내리고 최상위
  // `status`·`myJoined`·`participants`는 사라진다(N36 병기 종료). 레거시 축으로 분기를 짜 두면
  // 그 순간 **참여 가능한 회차가 정보 행으로 떨어지고, 참여자는 참여 중 표시·당일 취소 버튼을
  // 통째로 잃는다** — 조용히 깨지는 종류라 지금 축을 바꿔 둔다(#570 codex ②).
  // (구서버·브리지 응답에서는 session이 undefined라 폴백이 종전과 완전히 같은 값을 만든다.)
  const todaySession = bet?.session ?? null;
  const sessionAware = bet !== null && bet.session !== undefined;
  const myJoinedNow = sessionAware ? todaySession?.myJoined === true : bet?.myJoined === true;
  const sessionOpenNow = sessionAware ? todaySession?.status === 'OPEN' : bet?.status === 'OPEN';
  // 서버가 participants를 빠뜨려도 카드가 죽지 않게 — 인원 수는 표시용일 뿐이다.
  const betMembers = (todaySession?.participants ?? bet?.participants)?.length ?? 0;
  // 표시 금액도 회차 우선 — 회차는 개설 시점 stake·pot을 박제한다(설정 변경과 갈릴 수 있다).
  const displayStake = todaySession?.stake ?? bet?.stake ?? 0;
  const displayPot = todaySession?.pot ?? bet?.pot ?? 0;

  // 참가 진입점 잠금 — FOCUS는 서버가 준 myAchievedNow(이미 달성), SCREEN_TIME은 내 진행 행의
  // 확정 패배다. 스크린타임의 myAchievedNow는 표시용 잠정값이라 잠금에 쓰지 않는다(DTO 주석).
  // ⚠️ 미래(내일) 내기는 오늘 진행률 스냅샷으로 잠그지 않는다(#473 리뷰) — 내일의 집중·사용량은
  //    미지수라 오늘 '이미 달성/초과'는 차단 근거가 못 된다. 서버도 폴백 내기의
  //    myAchievedNow=false를 보장하지만 구서버·경합 대비 앱에서도 방어적으로 끊는다.
  // 회차 축을 먼저 본다(#570 리뷰) — 레거시 최상위 필드만 보면 브리지 철거(1418) 순간
  // undefined 가 되어 **이 잠금이 조용히 풀린다**. 서버가 BET_ALREADY_ACHIEVED 로 최종
  // 거부하니 참가비가 새지는 않지만, 위 myJoinedNow 와 같은 클래스의 "조용히 깨지는" 자리다.
  const myAchievedNowValue = sessionAware
    ? todaySession?.myAchievedNow === true
    : bet?.myAchievedNow === true;
  const joinBlockedNow = !isFutureBet && (isScreenTime ? myBlockedNow : myAchievedNowValue);

  // ── 낙관 반영 폐기 — 재조회가 도착하면 서버 값이 정본이다(GROMO-1112) ──
  // challenge 객체가 갈렸다 = 부모가 **새 응답**을 내려 줬다는 신호다(부모는 조회 응답을 그대로
  // state에 담고, 재조회 전까지는 리렌더마다 같은 객체를 다시 내려준다).
  // 값 비교(betId·인원·myJoined)로는 이 순간을 잡을 수 없다 — 재참여하면 서버 상태가 철회 전과
  // 완전히 같아져(같은 내기·같은 인원·다시 참가 중) 서명이 원래 값으로 되돌아오기 때문이다.
  // 버리지 않으면 재참여한 뒤에도 '빠졌어요' 캡션과 참가 진입점이 그대로 남는다.
  // 이펙트가 아니라 **렌더 중** 조정인 이유: 이펙트는 커밋 뒤라 '재조회는 도착했는데 카드는
  // 아직 빠진 상태'인 프레임이 실제로 한 번 그려진다. React가 공식으로 허용하는 패턴이고
  // 부모(GroupRoomScreen의 groupId 리셋)도 같은 패턴을 쓴다.
  const seenChallengeRef = useRef(challenge);
  if (seenChallengeRef.current !== challenge) {
    seenChallengeRef.current = challenge;
    if (closedBet !== null) setClosedBet(null);
  }
  // 내가 방금 빠진(철회)·닫은(취소) 내기인가 — 낙관 반영(위 state 주석).
  const leftByMe = bet !== null && closedBet !== null && bet.betId === closedBet.betId;
  // 참가 철회 가능 조건(계약 §4) — 참가 중 && OPEN && **시작 전**. 개설자·단독이어도 시작 전이면
  // 철회가 우선이다(GROMO-1102 — 단독 개설자가 철회하면 서버가 내기를 자동 CANCELED 하므로
  // 옛 취소의 의미가 보존된다). '시작 전' 판정은 서버와 같은 기준이다(계약 §4):
  //   TIME_WINDOW → 내일 이후 내기는 항상 전, 오늘 내기는 KST 벽시계 < 창 시작 시각일 때만.
  //                 **과거 날짜 내기는 항상 시작 후다**(GROMO-1208) — 서버는 창 시작을 내기
  //                 날짜(bet_date)에 앵커해 판정한다(GroupBetService.requireBeforeStart). 자정
  //                 걸침 창(예: 22:00~01:00)의 어제 내기를 오늘 00:30에 초만 비교하면(1800 <
  //                 79200) 앱 혼자 '시작 전'으로 읽어 철회를 세우고 서버는 BET_LEAVE_CLOSED로
  //                 튕긴다 — 취소 carve-out이 !leavable 뒤라 어느 버튼도 못 서는 dead-end였다.
  //                 (오늘/과거 판정의 날짜축도 서버와 같은 KST다 — GROMO-1219에서 통일)
  //   DURATION   → 내기 날짜가 내일 이후일 때만(당일은 하루 집계가 이미 진행 중이라 불가)
  // 판정이 어긋난 레이스는 서버가 정본으로 끝낸다(BET_LEAVE_CLOSED로 돌아온다).
  // 경계는 서버와 같은 strict `<`다(서버 !isBefore와 대우) — 창 시작 정각은 이미 시작이다.
  const isPastBet = betDate < todayStrKst();
  const beforeStart = isWindow
    ? !isPastBet &&
      (isFutureBet ||
        (challenge.windowStart !== null &&
          nowSecondsInZone(KST_ZONE) < timeStrToSeconds(challenge.windowStart)))
    : isFutureBet;
  const leavable =
    bet !== null && !leftByMe && bet.status === 'OPEN' && bet.myJoined && beforeStart;
  // 당일 단독 개설자 carve-out(#474 리뷰 회귀 지적) — 철회는 '시작 전'만 허용이라(위) 당일
  // DURATION·창 시작 후의 '개설자 단독 OPEN' 내기가 어느 버튼으로도 못 닫는 회귀가 생겼다.
  // 이 조합만 기존 cancelBet(개설자 단독 취소 — 서버에 살아 있고 시작 여부를 보지 않는다)으로
  // 복원한다. leavable이면 철회가 우선이라 두 버튼이 함께 서지 않는다(배타).
  // creatorUserId를 모르는 구서버는 개설자를 판정할 수 없어 진입점을 세우지 않는다(기존 원칙).
  const cancelable =
    !leavable &&
    bet !== null &&
    !leftByMe &&
    bet.status === 'OPEN' &&
    bet.myJoined &&
    bet.creatorUserId !== undefined &&
    !!myUserId &&
    bet.creatorUserId === myUserId &&
    betMembers === 1;
  // 철회 직후에도 이 내기에 다시 들어갈 수 있는가(GROMO-1112) — 한 번 빠지면 재참여 동선이
  // 사라지던 문제를 낙관 반영 안에서 되살린다. 조건 3가지:
  //   kind === 'leave' : 취소(cancelBet)는 내기를 통째로 닫는 동작이라 들어갈 자리가 없다
  //   betMembers > 1   : 남은 참가자가 있어야 재참여할 OPEN 내기가 남는다. 마지막 참가자였으면
  //                      서버가 내기를 CANCELED로 닫아 들어갈 자리 자체가 없다(챌린지는 지우지
  //                      않고 휴면으로 남긴다 — GROMO-1201) — 여기서 참가 버튼을 세우면 닫힌
  //                      내기로 들어가는 요청만 만든다.
  //   OPEN·betOpenable : 마감된 내기·끝난 챌린지에는 들어갈 수 없다(② 분기와 같은 기준 —
  //                      두 조건을 맞춰 둬야 rejoinable인데 ②가 안 서는 구멍이 생기지 않는다)
  // 참가 자체의 잠금(이미 달성·초과, betLocked)은 ② 분기와 같은 판정을 그대로 쓴다.
  const rejoinable =
    leftByMe &&
    closedBet?.kind === 'leave' &&
    betMembers > 1 &&
    bet?.status === 'OPEN' &&
    betOpenable;
  // 참가 진입 행에 적을 인원 — 철회 직후에는 아직 내 몫이 빠지지 않은 응답을 보고 있어 1을 뺀다
  // (⓪ 정보 행의 참가비·적립금 표기와 같은 규칙).
  const joinMembers = rejoinable ? betMembers - 1 : betMembers;

  // ── 요일 반복(GROMO-1274) — additive 필드가 있는 신서버 응답에서만 산다. 없으면(구서버)
  //    아래 파생이 전부 비활성으로 접혀 **종전 렌더 그대로**다(방어 — 브리핑 공통 규칙). ──
  const repeatDays =
    Array.isArray(challenge.repeatDays) && challenge.repeatDays.length > 0
      ? challenge.repeatDays
      : null;
  const todayKst = todayStrKst();
  const todayRepeatDay = repeatDayOf(todayKst);
  // 오늘이 도는 날인가 — 서버 activeToday가 있으면 **우선**하고(판정 정본은 서버 KST), 없으면
  // repeatDays에서 파생한다(같은 KST 날짜축 — GROMO-1219).
  const activeToday =
    repeatDays !== null
      ? (challenge.activeToday ?? (todayRepeatDay !== null && repeatDays.includes(todayRepeatDay)))
      : true;
  // 비활성 요일 — 카드를 감추지 않고 가라앉힌다(FR-16-2). 끝난 챌린지는 침강 대신 기존 표시.
  const resting = repeatDays !== null && !activeToday && challenge.status === 'ACTIVE';
  // 다음 활성일(오늘 제외 — LLD §2.1 계약) — 표기는 KST 날짜로 접는다. 파싱 실패는 표기 생략.
  const nextDate =
    challenge.nextSessionAt !== undefined ? kstDateOfInstant(challenge.nextSessionAt) : null;
  const startHHmm =
    isWindow && challenge.windowStart !== null ? hhmmOf(challenge.windowStart) : null;
  // 요일 줄 오른쪽 문구 — 회차 상태를 따른다(ux §02 표). '오늘 09:00'을 창이 끝난 뒤에도 두면
  // 거짓말이 된다. 하루형 활성일은 자정 시작·자정 종료라 '진행 중'이 하루 종일 사실이다.
  // ⚠️ **끝난 챌린지는 오늘/진행 중 분기를 타지 않는다**(#570 codex ②) — 종료·삭제된 챌린지도
  //    요일은 그대로라, 상태를 안 보면 하루형이 영영 「진행 중 · 자정 종료」로 남는다.
  //    앱이 보는 값은 'ACTIVE' | 'INACTIVE'다(서버가 ENDED를 레거시 와이어에서 INACTIVE로
  //    다운맵한다 — #567/B1) — 미래에 ENDED가 그대로 와도 안전하도록 `!== 'ACTIVE'`로 판정한다.
  const nextLine = (() => {
    if (repeatDays === null) return null;
    if (challenge.status !== 'ACTIVE') return null;
    if (activeToday) {
      if (isWindow && challenge.windowStart !== null && challenge.windowEnd !== null) {
        const nowSec = nowSecondsInZone(KST_ZONE);
        const startSec = timeStrToSeconds(challenge.windowStart);
        const endSec = timeStrToSeconds(challenge.windowEnd);
        if (nowSec < startSec) return `오늘 ${startHHmm}`;
        if (nowSec < endSec) return `진행 중 · ${hhmmOf(challenge.windowEnd)} 종료`;
        return nextDate !== null ? nextDayPhrase(nextDate, todayKst, startHHmm) : null;
      }
      return '진행 중 · 자정 종료';
    }
    return nextDate !== null ? nextDayPhrase(nextDate, todayKst, startHHmm) : null;
  })();
  // 요일 줄 음성 안내 — 배지 7칸을 낱자로 읽으면 뜻이 전달되지 않아 한 문장으로 묶는다(진행 행 관례).
  const dowA11y =
    repeatDays !== null
      ? `매주 ${REPEAT_DAY_ORDER.filter((d) => repeatDays.includes(d))
          .map((d) => REPEAT_DAY_LABELS[REPEAT_DAY_ORDER.indexOf(d)])
          .join('·')} 반복${nextLine !== null ? ` · ${nextLine}` : ''}`
      : '';

  // ── 회차 모델(신서버 — bet.session 필드 존재) 파생. undefined = 구서버(종전 렌더). ──
  // 오늘 회차의 참가 마감이 지났는가 — 창형은 창이 열리는 순간 잠기지만(§C3) 회차 자체는
  // 정산 전까지 OPEN으로 남는다. 그 구간을 '참가 가능'으로 읽으면 카드가 「참가하기」를 세우고
  // 누르면 항상 BET_SESSION_CLOSED로 실패한다(#570 codex ③). 마감 판정은 서버가 준
  // joinClosesAt이 정본이다 — 앱이 창 시작 시각으로 재구성하지 않는다(기기 시계·자정 걸침 사고).
  // 파싱 실패는 '마감 안 됨'으로 둔다(서버가 최종 판정 — 멀쩡한 참가를 앱이 막지 않는다).
  const todaySessionClosed = (() => {
    const closesAt = bet?.session?.joinClosesAt;
    if (closesAt === undefined) return false;
    const ms = Date.parse(closesAt);
    return !Number.isNaN(ms) && Date.now() >= ms;
  })();
  // 이 응답이 v2인가 — 표식은 요일 반복(repeatDays) 또는 내기 설정(betConfig)이다.
  const isV2 = repeatDays !== null || betConfig !== undefined;
  // 내기가 켜져 있는가 — **betConfig가 있으면 그것이 정본**이다(오늘 회차 유무와 무관한 설정).
  // 없으면 종전대로 오늘 내기 객체에서 읽는다(브리지 응답·구서버).
  const betOn = betConfig !== undefined ? betConfig.enabled : bet !== null && bet.enabled !== false;
  // 참가비 두 축을 구분한다(#572/B8 — 돈 경로 계약):
  //   reserveStake  = **지금 설정값**(betConfig) — 아직 열리지 않은 회차에 앞으로 박제될 금액.
  //                   주간 예약(join-week)은 대상이 여러 날이고 각 날짜의 박제값을 알 수 없어
  //                   이 값으로 합계를 낸다(실제와 갈리면 서버 총액 판정이 정본 — 알려진 한계).
  //   nextStake     = **다음 활성일 회차에 박제된 금액**(nextSessionStake). 회차가 이미 열려
  //                   있으면 `join-next`가 차감하는 건 이 값이다 — 설정이 낮아졌거나 브리지
  //                   기간에 구앱이 다른 stake로 열었으면 둘이 갈리고, 이 값을 안 보면 화면이
  //                   안내한 금액보다 더 많이 차감된다. null(회차 미개설)이면 설정값으로 폴백.
  const reserveStake = betConfig?.stake ?? bet?.stake ?? 0;
  const nextStake = challenge.nextSessionStake ?? reserveStake;
  // 오늘 회차로 더 참가할 수 없다(회차 없음 = 쉬는 날·미개설 / 참가 마감 경과) — 이 카드의 행동은
  // '다음 활성일 예약'으로 넘어간다. 단 **이미 참가 중이면** 참여 중 행·취소 동선이 우선이다.
  const todayJoinClosed =
    isV2 &&
    (bet === null ||
      (bet.session !== undefined &&
        (bet.session === null || (todaySessionClosed && !bet.session.myJoined))));
  // 다음 활성일 1건 예약 진입점(GROMO-1419 — N45·FR-31-1): 오늘 참가가 닫힌 신서버 카드에서만.
  // 미래 회차라 무위험 참가 검사(이미 달성·초과)로 잠그지 않는다.
  // SCREEN_TIME 권한 없음(canParticipate=false)이면 서버가 join-next를 N50으로 거절한다 —
  // "권한이 없어 참여할 수 없어요" 안내 옆에 돈 나가는 버튼을 세우지 않는다(#570 codex ④).
  const nextJoinable =
    todayJoinClosed &&
    betOn &&
    betOpenable &&
    challenge.canParticipate &&
    // 예약 진입점의 금액 축은 박제값(nextStake)이다 — 안내와 차감이 어긋나면 안 된다.
    nextStake > 0 &&
    nextDate !== null &&
    challenge.nextSessionJoined !== true;
  // 이미 잡아 둔 다음 활성일 예약 — **오늘 참여 여부와 무관하게** 상태와 취소 동선을 보여준다
  // (#570 codex ①). 오늘도 참여 중이면 ⓪-v2 분기를 타지 않는데, 그 조건에 취소를 묶어 두면
  // join-week으로 미리 낸 돈을 무를 자리가 화면에서 사라진다 — 이미 나간 돈이라 더 나쁘다.
  const nextReserved =
    isV2 && challenge.nextSessionJoined === true && nextDate !== null && betOpenable;
  // 「이번 주 남은 날 전부」(GROMO-1276 — N14·§C2) 대상 산출: 이번 주(KST 월~일) 남은 활성일 중
  // 참가 가능 회차. 오늘은 '지금 참여 가능한 미참가 회차'일 때만(창형은 참가 마감 전 — N39와 같은
  // 원리로 참여 불가능한 오늘을 담으면 서버 400으로 전체가 죽는다). 이미 예약한 다음 활성일은
  // 뺀다 — 합계 표기가 실제 나갈 돈보다 부풀면 안 된다(서버는 조용히 건너뛰지만 표기가 거짓이 된다).
  // ⚠️ 금액은 **날짜마다 다를 수 있다**(#570 리뷰): 오늘 회차는 이미 열려 있어 개설 시점 stake가
  //    박제돼 있고, 아직 열리지 않은 날은 예약하는 순간 지금 설정값이 박제된다. 단가 하나로
  //    합계를 내면 관리자가 참가비를 바꾼 직후 **표시 합계 ≠ 실제 차감**이 된다 — 날짜별로 낸다.
  const weekEntries = (() => {
    if (
      repeatDays === null ||
      !betOn ||
      reserveStake <= 0 ||
      !betOpenable ||
      // 회차 모델을 모르는 브리지 응답(bet은 있는데 session 필드가 없다)에는 주간 예약을 걸지 않는다.
      (bet !== null && bet.session === undefined) ||
      // 권한 없는 SCREEN_TIME은 join-week도 N50으로 전부 거절된다 — 대상 자체를 만들지 않는다.
      !challenge.canParticipate
    ) {
      return [];
    }
    // 위에서 파생한 todaySession을 그대로 쓴다(같은 값을 두 번 만들지 않는다 — 축이 갈리면
    // 오늘 몫 판정과 표시가 어긋난다).
    const todayEligible =
      activeToday &&
      todaySession !== null &&
      todaySession.status === 'OPEN' &&
      !todaySession.myJoined &&
      !myBlockedNow &&
      // 참가 마감(joinClosesAt) 경과 판정은 창 시각 재구성이 아니라 서버 값이 정본이다(위 주석).
      !todaySessionClosed;
    // 미래 날짜는 원칙적으로 아직 회차가 없다 → 예약 시점의 설정값이 박제된다(= reserveStake).
    // **단 다음 활성일은 이미 열려 있을 수 있다**(nextSessionStake) — 그 날은 박제값이 정본이다
    // (#570 codex ②: 오늘 몫만 고치고 다음 회차를 빠뜨리면 같은 불일치가 하루 뒤에 남는다).
    const future = weekRemainingActiveDates(repeatDays, todayKst, false)
      .filter((d) => !(challenge.nextSessionJoined === true && d === nextDate))
      .map((date) => ({
        date,
        stake: date === nextDate ? nextStake : reserveStake,
      }));
    if (!todayEligible) return future;
    // 오늘 몫은 **박제값**이다 — 회차가 이미 서 있으므로 설정값이 아니라 그 회차의 stake가 나간다.
    const todayStake = todaySession?.stake ?? bet?.stake ?? reserveStake;
    return [{ date: todayKst, stake: todayStake }, ...future];
  })();
  // 남은 날이 1개 이하면 숨긴다 — 단건 참여와 같아져 의미가 없다(LLD §2.2).
  const weekEligible = weekEntries.length >= 2;

  // 취소 유예가 끝난 순간을 기록한다 — 자식 카운트다운이 마감에 닿을 때 **한 번만** 올린다.
  // 값을 마감 시각으로 두는 이유: 재조회로 회차·마감이 바뀌면 자연히 무효가 된다(비교 불일치).
  const [leaveExpiredAt, setLeaveExpiredAt] = useState<number | null>(null);

  // ── 오늘 회차 참여 취소 창(N22 · #570 codex ②) ──
  // 서버가 준 myLeaveDeadlineAt이 정본이다: 시작 전 참가는 회차 시작까지, **시작 후 참가(하루형)는
  // 참가+5분**(회차 종료 상한). 앱이 자체 계산하지 않는다 — 기기 시계가 틀어지면 버튼이 어긋난다.
  const leaveDeadlineMs = (() => {
    const at = todaySession?.myLeaveDeadlineAt;
    if (!at) return null;
    const ms = Date.parse(at);
    return Number.isNaN(ms) ? null : ms;
  })();
  const todayLeavable =
    todaySession !== null &&
    todaySession.myJoined &&
    todaySession.status === 'OPEN' &&
    leaveDeadlineMs !== null &&
    Date.now() < leaveDeadlineMs &&
    // 마감이 지난 순간 버튼을 내린다 — 카운트다운 자식이 알려준다(아래 LeaveCountdown).
    leaveExpiredAt !== leaveDeadlineMs;
  // 초읽기를 켜는가 — 마감이 가까울 때만(먼 예약분에 매초 타이머를 돌리지 않는다, 위 상수).
  const showLeaveCountdown =
    todayLeavable &&
    leaveDeadlineMs !== null &&
    leaveDeadlineMs - Date.now() <= LEAVE_COUNTDOWN_WINDOW_SEC * 1000;
  // 자식이 부르는 만료 콜백 — 참조가 매 렌더 갈리면 자식 이펙트가 인터벌을 다시 건다.
  const onLeaveExpired = useCallback(() => {
    if (leaveDeadlineMs !== null) setLeaveExpiredAt(leaveDeadlineMs);
  }, [leaveDeadlineMs]);

  // v2 시트(다음 활성일 예약·주간 예약) — 카드가 직접 연다(히스토리 push와 같은 이유로 부모
  // 배선을 늘리지 않는다). groupId는 조회 캐시 역참조 — 미적중이면 공통 문구.
  const [betV2Sheet, setBetV2Sheet] = useState<'next' | null>(null);
  // 주간 시트가 그릴 대상 날짜 — **열 때 확정**한다(아래 openWeekSheet). null = 닫힘.
  const [weekSheetDates, setWeekSheetDates] = useState<JoinWeekEntry[] | null>(null);
  const weekOpenLock = useRef(false);
  // 진행 중 삭제 2단계(GROMO-1425) — 프리플라이트 수치가 도착해야만 열린다(N49).
  const [deletePreview, setDeletePreview] = useState<ChallengeDeletionPreviewResponse | null>(null);
  const deleteLock = useRef(false);
  // 삭제 확정 요청의 시퀀스 — **사용자가 시트를 닫으면 올려서 진행 중이던 검증 결과를 버린다**
  // (#570 codex ①). 닫기를 막는 대신 결과를 폐기하는 쪽을 택했다: 응답이 늦을 때 시트에
  // 갇히는 것보다, 닫은 뒤에는 아무 일도 일어나지 않는 편이 안전하다(돈이 걸린 파괴 동작이다).
  const deleteSeqRef = useRef(0);
  const closeDeleteSheet = useCallback(() => {
    deleteSeqRef.current++;
    setDeletePreview(null);
  }, []);
  const cachedGroupId = challengeGroupId(challenge.id);

  // 시트를 여는 그 이벤트에서 부모에 먼저 알린다(GROMO-1578 · codex 사전 게이트 P2).
  // 아래 useEffect는 커밋 **뒤에** 돌아서, 시트가 마운트되는 커밋에 결과 큐가 채워지면 두 네이티브
  // Modal이 같은 프레임에 뜬다. 여는 이벤트에서 부모 setState를 같은 배치에 넣으면 결과 모달이
  // 내려가는 것과 시트가 뜨는 것이 한 커밋에 함께 처리돼 그 창이 사라진다.
  // 낙관 보고다 — 열림 조건(참가비·날짜·캐시)이 실제로는 거짓일 수 있는데, 그러면 위 이펙트가
  // 곧바로 false로 정정한다. 어긋나는 한 커밋 동안은 **결과 모달을 미루는 쪽**으로 틀린다.
  function openSheet() {
    onSheetVisibilityChange?.(challenge.id, true);
  }

  // await 뒤에 여는 시트의 승인 게이트(위 onRequestSheetSlot 주석). 부모가 미전달이면 통과.
  async function claimSheetSlot(): Promise<boolean> {
    return (await onRequestSheetSlot?.(challenge.id)) ?? true;
  }

  // 확보한 자리를 **열지 않고** 돌려준다(사용자가 확인 Alert에서 물러난 경우).
  // 돌려주지 않으면 부모가 다음 요청을 승인하지 못하고 slot도 계속 물고 있는다.
  function releaseSheetSlot() {
    onAbandonSheetSlot?.(challenge.id);
  }

  // ── 카드의 자리 위에 얹힌 네이티브 Alert(GROMO-1576) ────────────────────────
  //
  // ⚠️ **이 부류가 사는 곳을 가르는 축은 "명령형인가"가 아니다.** 진짜 축은 둘의 곱이다:
  //    ① 자리를 쥔 주체가 **네이티브 표면**이라 React 생명주기 밖에 있는가,
  //    ② 그 자리를 놓는 계기가 **사용자 조작 말고 배경 이벤트로도** 일어나는가.
  //    대조가 그것을 보여 준다 — GroupCreateScreen의 공유 다이얼로그도 이미 쥔 자리 안에서
  //    네이티브 시트를 열지만 **안전하다.** 그 다이얼로그는 사용자가 버튼을 눌러야만 닫히고
  //    beforeRemove가 이탈까지 막아, 배경 이벤트가 소유자를 없앨 수 없기 때문이다(②가 거짓).
  //    반면 이 카드는 **부모의 배경 재조회가 사용자 조작과 무관하게 카드를 없앤다.**
  //    선언형이라도 ②가 참이면 같은 결함이 난다 — 실제로 아래 세 Alert가 그랬다.
  //
  // 그래서 이 표식의 뜻은 "명령형 승인을 쥐고 있다"가 아니라 **"이 카드의 등록 위에 네이티브
  // Alert가 떠 있다"**이다. 그 동안 카드가 사라져도 부모의 등록을 **꺼뜨리지 않고**, 마지막
  // Alert가 닫힐 때 미뤄 둔 정리를 실행한다(useOverlayAlert의 openCount와 같은 모양).
  const openAlertCountRef = useRef(0);
  const cardUnmountedRef = useRef(false);
  // 언마운트가 미뤄 둔 정리 — 마지막 Alert가 닫히는 순간 실행한다.
  const deferredCleanupRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      cardUnmountedRef.current = true;
    },
    [],
  );

  // 이 카드의 등록 위에 얹히는 raw Alert의 **유일한 입구.** 자리마다 반납을 적으면 반드시
  // 한 곳을 빠뜨린다(이 배치에서 세 번 빠뜨렸다) — 닫힘 경로를 여기 한 곳으로 모은다.
  // ⚠️ 버튼을 안 넘기면 `확인` 하나를 명시한다. RN의 기본 버튼도 같은 모양이지만, 명시하지
  //    않으면 **닫힘 콜백을 얻을 수 없어** 미뤄 둔 정리를 영영 못 돌린다.
  // ⚠️ `onDismiss`도 항상 잇는다 — Android의 dismissExisting은 버튼 콜백을 건너뛴다.
  function alertOverCardSlot(
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: Parameters<typeof Alert.alert>[3],
  ) {
    openAlertCountRef.current += 1;
    // 0 → 1 전이에서만 알린다(겹쳐 뜬 둘째는 이미 참인 사실을 다시 말할 뿐이다).
    if (openAlertCountRef.current === 1) onAlertHoldChange?.(challenge.id, true);
    let closed = false;
    const close = () => {
      if (closed) return; // 한 Alert당 한 번만
      closed = true;
      openAlertCountRef.current = Math.max(0, openAlertCountRef.current - 1);
      if (openAlertCountRef.current > 0) return; // 겹쳐 뜬 Alert가 아직 남았다
      // 마지막이 닫혔다 — 부모의 "유예 중" 표식을 먼저 걷고, 그 다음 미뤄 둔 정리를 흘린다.
      onAlertHoldChange?.(challenge.id, false);
      const deferred = deferredCleanupRef.current;
      deferredCleanupRef.current = null;
      deferred?.();
    };
    const list: AlertButton[] = buttons && buttons.length > 0 ? buttons : [{ text: '확인' }];
    const wrapped = list.map((button) => ({
      ...button,
      // 호출부의 동작을 **먼저** 실행한다 — 그 안에서 시트를 여는 경우(삭제 확인) 미뤄 둔
      // 정리보다 앞서야 열림 보고와 정정의 순서가 뒤집히지 않는다.
      onPress: (value?: string) => {
        (button.onPress as ((value?: string) => void) | undefined)?.(value);
        close();
      },
    }));
    Alert.alert(title, message, wrapped, {
      ...options,
      onDismiss: () => {
        options?.onDismiss?.();
        close();
      },
    });
  }

  function openJoinNextSheet() {
    if (cachedGroupId === null) {
      // 캐시 미적중(이론상 앱 재시작 직후뿐) — 철회·히스토리와 같은 공통 문구 결.
      showGatedAlert('참여할 수 없어요', '잠시 후 다시 시도해 주세요.');
      return;
    }
    openSheet();
    setBetV2Sheet('next');
  }

  // 주간 시트 열기 — 카드의 nextSessionJoined는 **가장 가까운 1건**만 말한다(N45). 부분 예약을
  // 여러 날 해 뒀으면 나머지 예약일이 후보에 남아 합계가 부풀고 축소 제안까지 오염된다(#570
  // codex). 내 OPEN 회차 목록(1419 취소 동선과 같은 API)에서 이 챌린지의 예약일 **전체**를 받아
  // 뺀 집합으로만 시트를 연다 — 화면이 보여주는 돈과 실제 나갈 돈이 어긋나면 안 된다(N15).
  async function openWeekSheet() {
    if (cachedGroupId === null) {
      showGatedAlert('참여할 수 없어요', '잠시 후 다시 시도해 주세요.');
      return;
    }
    if (weekOpenLock.current) return; // 조회가 도는 동안의 연타 방지(leaveLock 관행)
    weekOpenLock.current = true;
    try {
      const mine = await getMyOpenBetSessions();
      const reserved = new Set(
        mine.filter((m) => m.challengeId === challenge.id).map((m) => m.sessionDate),
      );
      const targets = weekEntries.filter((e) => !reserved.has(e.date));
      if (targets.length === 0) {
        // 남은 날을 전부 예약해 뒀다 — 낡은 버튼이었다. 사실을 알리고 카드를 최신으로 갈아 끼운다.
        // 이미 원하던 상태인 종결 통보라 확인 버튼이 필요 없다 → 토스트
        // (정책 D19 — docs/prd/motion-v2/policy.md, 상위 정본 병합 전까지 여기가 정본).
        // ⚠️ tone 생략(중립 배너)은 의도다 — **이미 원하던 상태**라 아무것도 잘못되지 않았으므로
        //    danger 배너를 쓰지 않는다. 빨강은 진짜 못 한 것(마감 지남·정산됨 등)에만 남겨야
        //    신호가 산다. 톤이 둘뿐이라 생략(기본 중립)이 가장 가까운 표현이고, 「성공」이라고
        //    주장하지 않으려고 tone:'success'를 명시하지도 않는다(오너 결정 2026-08-11).
        //    아래 '이미 …' 계열 5곳도 같은 근거로 tone을 생략한다.
        show({ message: '이번 주 남은 날은 이미 모두 참여하고 있어요' });
        onBetChanged?.();
        return;
      }
      // 조회가 끝난 지금이 **실제로 여는 시점**이다 — 승인을 받고 마운트한다.
      if (!(await claimSheetSlot())) return;
      openSheet();
      setWeekSheetDates(targets);
    } catch {
      // 예약 현황을 모른 채 열면 이미 낸 날의 참가비까지 합계에 싣는다 — 열지 않는다.
      // 성공 경로가 claimSheetSlot()을 지나므로 **이 실패 경로도 승인을 받고** 띄운다.
      await showGatedAlert.afterSlot(
        '참여 정보를 확인하지 못했어요',
        '잠시 후 다시 시도해 주세요.',
      );
    } finally {
      weekOpenLock.current = false;
    }
  }

  // 예약해 둔 다음 활성일의 참여 취소(1419) — 카드 응답에는 미래 회차 sessionId가 없어(오늘
  // 회차만 실린다) 내 OPEN 회차 목록에서 (챌린지, 날짜)로 대상을 찾는다. 검증은 서버가 정본.
  async function doLeaveNext() {
    if (leaveLock.current || nextDate === null) return;
    leaveLock.current = true;
    setLeaveBusy(true);
    try {
      if (cachedGroupId === null) throw new Error('unknown groupId');
      const mine = await getMyOpenBetSessions();
      const target = mine.find((m) => m.challengeId === challenge.id && m.sessionDate === nextDate);
      if (target === undefined) {
        // 이미 취소됐거나 예약이 사라졌다 — 취소할 대상이 없는 **종결 상태**다. 재조회로 카드의
        // 예약 표시를 걷어 준다(안 그러면 없는 예약을 계속 취소하려 든다 — 아래 404와 같은 결).
        // 조치가 없는 결과 통보라 확인 버튼 없이 토스트로 알린다(정책 D19).
        // tone 생략 = 중립 배너 — 이미 원하던 상태라 danger를 쓰지 않는다(오너 결정 2026-08-11).
        show({ message: '이미 정리된 예약이에요 — 최신 상태로 새로고침할게요' });
        onBetChanged?.();
        return;
      }
      await leaveSession(cachedGroupId, target.sessionId);
      // 환불 반영은 서버가 정본 — 잔액·카드(nextSessionJoined)를 다시 받는다.
      refreshCoins();
      onBetChanged?.();
    } catch (e) {
      switch (groupErrorCode(e)) {
        // 목록을 받은 뒤 회차가 사라졌다(삭제·정산) — 취소할 대상이 없는 종결 상태다(#570 ③).
        // tone 생략 = 중립 배너 — 이미 원하던 상태라 danger를 쓰지 않는다(오너 결정 2026-08-11).
        case BET_SESSION_NOT_FOUND:
          show({ message: '이미 정리된 예약이에요 — 최신 상태로 새로고침할게요' });
          onBetChanged?.();
          break;
        case BET_LEAVE_CLOSED:
          show({ message: '취소할 수 있는 시간이 지나 참여 취소를 못 했어요', tone: 'error' });
          break;
        // 다른 기기에서 이미 취소했다 — 404와 같은 "취소할 대상이 없음"이다(#570 codex ④).
        // tone 생략 = 중립 배너 — 이미 원하던 상태라 danger를 쓰지 않는다(오너 결정 2026-08-11).
        case BET_NOT_JOINED:
          show({ message: '이미 취소된 참여예요 — 최신 상태로 새로고침할게요' });
          onBetChanged?.();
          break;
        // 카드를 그린 뒤 회차가 닫혔다(정산·마감) — 위 두 코드와 같은 **종결 상태**다.
        // 재조회 없이 두면 이미 정산된 회차에 「참여 취소」 버튼이 계속 떠서 같은 실패를
        // 반복해 누르게 된다. 레거시 경로(doLeaveBet·doCancelBet)는 조건이 깨진 응답이 오면
        // 버튼이 스스로 사라지는 구조라 자연 재조회에 맡기지만, v2 예약/당일 취소는 버튼 노출이
        // 서버 스냅샷(nextSessionJoined·myLeaveDeadlineAt)에 묶여 있어 재조회가 유일한 해소다.
        case BET_NOT_OPEN:
          show({ message: '이미 정산됐거나 닫힌 날이라 참여 취소를 못 했어요', tone: 'error' });
          onBetChanged?.();
          break;
        default:
          showGatedAlert.afterSlot('참여 취소를 못 했어요', '잠시 후 다시 시도해 주세요.');
      }
    } finally {
      leaveLock.current = false;
      setLeaveBusy(false);
    }
  }

  // 오늘 회차 참여 취소(N22·N27 · #570 codex ②) — **당일 참가자의 유일한 환불 창**이다.
  // 하루형은 회차 시작이 자정이라 레거시 '시작 전' 판정(beforeStart)이 영영 false다 — 그 축만
  // 두면 오탭으로 빠져나간 참가비를 되돌릴 버튼이 화면에 아예 없다(N22가 화면에서 죽는다).
  // 마감 판정은 서버가 준 myLeaveDeadlineAt이 정본이다 — 앱이 `참가시각 + 5분`을 자체 계산하면
  // 기기 시계가 틀어질 때 버튼이 어긋난다(LLD §2.2 "서버 시각 기준으로 앱이 카운트다운").
  async function doLeaveToday(sessionId: string) {
    if (leaveLock.current) return;
    leaveLock.current = true;
    setLeaveBusy(true);
    try {
      if (cachedGroupId === null) throw new Error('unknown groupId');
      await leaveSession(cachedGroupId, sessionId);
      // 환불 반영은 서버가 정본 — 잔액·카드를 다시 받는다.
      refreshCoins();
      onBetChanged?.();
    } catch (e) {
      switch (groupErrorCode(e)) {
        // 카드를 그린 뒤 회차가 사라졌다(삭제·정산) — **취소할 대상이 없는 종결 상태**다.
        // 공통 문구('잠시 후 다시 시도')로 떨어뜨리면 영원히 같은 실패를 반복하게 되므로,
        // 사실을 알리고 카드를 최신으로 갈아 끼운다(#570 codex ③).
        // tone 생략 = 중립 배너 — 이미 원하던 상태라 danger를 쓰지 않는다(오너 결정 2026-08-11).
        case BET_SESSION_NOT_FOUND:
          show({ message: '이미 정리된 날이에요 — 최신 상태로 새로고침할게요' });
          onBetChanged?.();
          break;
        case BET_LEAVE_CLOSED:
          show({ message: '취소할 수 있는 시간이 지나 참여 취소를 못 했어요', tone: 'error' });
          break;
        // 다른 기기에서 이미 취소했다 — 404와 같은 "취소할 대상이 없음"이다(#570 codex ④).
        // tone 생략 = 중립 배너 — 이미 원하던 상태라 danger를 쓰지 않는다(오너 결정 2026-08-11).
        case BET_NOT_JOINED:
          show({ message: '이미 취소된 참여예요 — 최신 상태로 새로고침할게요' });
          onBetChanged?.();
          break;
        // 카드를 그린 뒤 회차가 닫혔다(정산·마감) — 위 두 코드와 같은 **종결 상태**다.
        // 재조회 없이 두면 이미 정산된 회차에 「참여 취소」 버튼이 계속 떠서 같은 실패를
        // 반복해 누르게 된다. 레거시 경로(doLeaveBet·doCancelBet)는 조건이 깨진 응답이 오면
        // 버튼이 스스로 사라지는 구조라 자연 재조회에 맡기지만, v2 예약/당일 취소는 버튼 노출이
        // 서버 스냅샷(nextSessionJoined·myLeaveDeadlineAt)에 묶여 있어 재조회가 유일한 해소다.
        case BET_NOT_OPEN:
          show({ message: '이미 정산됐거나 닫힌 날이라 참여 취소를 못 했어요', tone: 'error' });
          onBetChanged?.();
          break;
        default:
          showGatedAlert.afterSlot('참여 취소를 못 했어요', '잠시 후 다시 시도해 주세요.');
      }
    } finally {
      leaveLock.current = false;
      setLeaveBusy(false);
    }
  }

  function confirmLeaveToday(sessionId: string, stake: number) {
    showGatedAlert('참여 취소', `참가비 ${stake}코인을 돌려받고 오늘 참여를 취소할까요?`, [
      { text: '아니요', style: 'cancel' },
      { text: '참여 취소', style: 'destructive', onPress: () => doLeaveToday(sessionId) },
    ]);
  }

  // 확인 한 겹 — 버튼 문구는 「참여 취소」다(N27 — 돈이 걸린 행동이라 무엇을 취소하는지 드러낸다).
  function confirmLeaveNext(stake: number) {
    if (nextDate === null) return;
    showGatedAlert(
      '참여 취소',
      `${fmtMonthDayDow(nextDate)} 참여를 취소하고 참가비 ${stake}코인을 돌려받을까요?`,
      [
        { text: '아니요', style: 'cancel' },
        { text: '참여 취소', style: 'destructive', onPress: () => doLeaveNext() },
      ],
    );
  }

  // 철회 실행 — 검증은 서버가 정본이다(레이스로 조건이 깨졌으면 에러 코드로 돌아온다).
  async function doLeaveBet(betId: string, stake: number, participantsCount: number) {
    // 같은 틱 연타 방지 — state(leaveBusy)는 리렌더 뒤에야 보인다(ComposeSheet.submitLock 관행).
    if (leaveLock.current) return;
    leaveLock.current = true;
    setLeaveBusy(true);
    const groupId = challengeGroupId(challenge.id);
    try {
      if (groupId === null) throw new Error('unknown groupId'); // 캐시 미적중 — 공통 문구로.
      await leaveBet(groupId, betId);
      // 마지막 참가자의 철회는 서버가 내기를 CANCELED로 닫는다 — 챌린지는 지우지 않고
      // 휴면으로 남긴다(GROMO-1201, 백엔드 테스트가 잠근다). 내기가 닫히는 그 경우에만 기존
      // '내기 취소' 계측을 발행한다(이벤트 의미 보존). 참가만 빠지는 철회는 대응 이벤트가 없다 —
      // analyticsEvents는 이 배치 소유권 밖이라 신설하지 않는다(성공 시에만 발행 규칙은 동일).
      if (participantsCount === 1) {
        logGroupBetCanceled({ stake, participants_count: participantsCount });
      }
      // 환불 반영은 서버가 정본이라 잔액을 다시 받는다.
      refreshCoins();
      setClosedBet({ betId, kind: 'leave' });
      // 부모 재조회 — 마지막 참가자의 철회는 내기가 CANCELED로 닫히고 챌린지가 휴면이 되므로
      // 재조회해야 카드가 최신 상태(닫힌 내기·휴면 배지)로 갈아 끼워진다. 남은 참가자가 있으면
      // 낙관 반영과 같은 결과가 돌아온다.
      onBetChanged?.();
    } catch (e) {
      switch (groupErrorCode(e)) {
        // 세 코드 모두 이 카드 상태로는 재시도해도 같은 결과다 — 사실만 알리고, 화면 정리는
        // 다음 자연 재조회에 맡긴다(버튼은 조건이 깨진 최신 응답이 오면 스스로 사라진다).
        // 문구는 v2 경로(doLeaveToday·doLeaveNext)와 같은 동사('참여 취소')를 쓴다 — 같은 행동을
        // 되돌리는 실패인데 화면마다 다른 이름으로 부르면 유저는 다른 기능이라고 읽는다(N27).
        case BET_LEAVE_CLOSED:
          show({ message: '내기가 시작된 뒤라 참여 취소를 못 했어요', tone: 'error' });
          break;
        // ❌ 유지 — '화면을 새로고침해 주세요'는 사용자 조치를 요구한다(정책 D19).
        case BET_NOT_JOINED:
          showGatedAlert.afterSlot(
            '참여 취소를 못 했어요',
            '참가 중인 내기가 아니에요. 화면을 새로고침해 주세요.',
          );
          break;
        case BET_NOT_OPEN:
          show({ message: '이미 정산됐거나 닫힌 내기라 참여 취소를 못 했어요', tone: 'error' });
          break;
        default:
          showGatedAlert.afterSlot('참여 취소를 못 했어요', '잠시 후 다시 시도해 주세요.');
      }
    } finally {
      leaveLock.current = false;
      setLeaveBusy(false);
    }
  }

  // 확인 한 겹 — 돈이 되돌아오는 동작이라도 참가가 사라지므로 삭제와 같은 규격을 쓴다.
  // 문구는 「참여 취소」로 통일한다(N27) — 레거시 '철회'는 같은 행동의 옛 이름일 뿐이라,
  // v2 경로와 다른 동사를 쓰면 유저에겐 서로 다른 두 기능으로 읽힌다.
  function confirmLeaveBet() {
    if (!leavable || bet === null) return;
    showGatedAlert('참여 취소', `참가비 ${bet.stake}코인을 돌려받고 내기에서 빠질까요?`, [
      { text: '아니요', style: 'cancel' },
      {
        text: '참여 취소',
        style: 'destructive',
        onPress: () => doLeaveBet(bet.betId, bet.stake, betMembers),
      },
    ]);
  }

  // 취소 실행(carve-out 전용) — 검증은 서버가 정본이다. 철회와 달리 cancelBet은 시작 여부를
  // 보지 않고 '개설자 단독 OPEN'만 본다(계약 §4 — 구버전 호환으로 유지된 엔드포인트).
  async function doCancelBet(betId: string, stake: number, participantsCount: number) {
    if (leaveLock.current) return;
    leaveLock.current = true;
    setLeaveBusy(true);
    const groupId = challengeGroupId(challenge.id);
    try {
      if (groupId === null) throw new Error('unknown groupId'); // 캐시 미적중 — 공통 문구로.
      await cancelBet(groupId, betId);
      // 내기가 통째로 닫히는 동작이라 항상 '내기 취소' 계측이다(성공 시에만 발행 규칙 동일).
      logGroupBetCanceled({ stake, participants_count: participantsCount });
      refreshCoins();
      setClosedBet({ betId, kind: 'cancel' });
      // 철회와 같은 이유로 부모 재조회를 태운다 — 내기가 닫힌 최신 상태로 갈아 끼운다.
      onBetChanged?.();
    } catch (e) {
      switch (groupErrorCode(e)) {
        // 재시도해도 같은 결과다 — 사실만 알리고 화면 정리는 다음 자연 재조회에 맡긴다(위와 동일).
        // 취소 실패는 사유만 말한다 — 실패했다는 사실은 방금 누른 「참여 취소」 버튼 문맥이 준다.
        case BET_CANCEL_FORBIDDEN:
          show({ message: '내기를 연 사람만 취소할 수 있어요', tone: 'error' });
          break;
        case BET_CANCEL_HAS_OTHERS:
          show({ message: '다른 참가자가 있어 취소할 수 없어요', tone: 'error' });
          break;
        case BET_NOT_OPEN:
          show({ message: '이미 정산됐거나 닫힌 내기라 참여 취소를 못 했어요', tone: 'error' });
          break;
        default:
          showGatedAlert.afterSlot('참여 취소를 못 했어요', '잠시 후 다시 시도해 주세요.');
      }
    } finally {
      leaveLock.current = false;
      setLeaveBusy(false);
    }
  }

  // 확인 한 겹 — 제목·CTA는 「참여 취소」로 통일(N27)하되, 질문은 그대로 '내기를 닫을까요'다.
  // 단독 참가자라 내 참여를 무르면 내기 자체가 닫힌다 — 그 결과를 묻는 문장에서 지우면 안 된다.
  function confirmCancelBet() {
    if (!cancelable || bet === null) return;
    showGatedAlert('참여 취소', `참가비 ${bet.stake}코인을 돌려받고 내기를 닫을까요?`, [
      { text: '아니요', style: 'cancel' },
      {
        text: '참여 취소',
        style: 'destructive',
        onPress: () => doCancelBet(bet.betId, bet.stake, betMembers),
      },
    ]);
  }
  // 지난 결과 1건 — v2 lastSettledSession 우선, 없으면 구서버 lastSettledBet 폴백(#570 codex ①).
  // 선택·정규화는 lastSettledView가 단독으로 쥔다(시트는 A2 소유라 표시 계약을 최소로만 넓혔다 —
  // 무효화 사유 optional prop 하나, 미전달 시 종전 동작).
  const lastSettled = pickLastSettled(challenge);
  const lastBet = lastSettled?.bet ?? null;
  const lastResults = lastBet?.results ?? [];
  // achieved는 3상이다(계약 §3) — null(미판정)을 미달성으로 세면 달성 인원이 과소 집계된다.
  const lastAchieved = lastResults.filter((r) => r.achieved === true).length;
  // 무산·삭제 무효화 회차의 카드 한 줄 요약 — 달성 집계 대신 사유를 적는다(#570 codex ①).
  const lastVoidSummary = voidSummary(lastSettled?.voidReason ?? null);

  // 확인 Alert 형식은 앱 관행대로 (동작명, 질문) — 대상에 인용부호를 쓰지 않는다.
  // 진행 중(OPEN 회차 없음)이 아닐 땐 여기서 끝난다 — 안 위험할 때도 두 번 물으면 경고가
  // 의미를 잃는다(N29).
  // revalidate=true면 확정 시점에 프리뷰를 **다시** 받는다 — 이 Alert가 떠 있는 동안 다른
  // 멤버가 join-next·join-week로 참가하면, 걸린 돈을 한 번도 안 보여준 채 조건 없는 삭제가
  // 나간다(#570 codex ③). 새 참여가 생겼으면 삭제하지 않고 **수치 경고(2단계)로 전환**한다.
  // 구서버(프리뷰 엔드포인트 없음)는 revalidate=false로 종전 동작 그대로다.
  //
  // 물러나는 버튼은 `그만두기`다(policy §A8) — 여기서 `취소`를 쓰면 같은 카드의 **참여 취소**와
  // 겹쳐, 돈을 무르는 버튼과 창을 닫는 버튼이 같은 단어가 된다.
  //
  // ⚠️ **이 함수는 두 성질을 겸한다** — 부르는 자리가 둘이고 그 앞에 창이 있는지가 다르다.
  //   · 구서버 분기(`confirmDelete`의 `repeatDays === null`) — 탭 핸들러에서 **동기로** 부른다.
  //     `await`가 없어 전면 모달이 떠 있을 수 없다(조정자 헤더의 A축) → 자리를 새로 안 잡는다.
  //   · 0건 분기(`confirmDelete`의 프리플라이트 응답 뒤) — **`await` 뒤**다(B축). 기다리는 사이
  //     결과 모달이 노출될 수 있어, 그대로 띄우면 그 위를 덮고 사용자가 못 읽은 채 seen·ack이
  //     나간다. 형제 분기(`openSessions > 0`)는 이미 승인을 받는다 — **한쪽만 두면 막은 것이
  //     아니다.** 그래서 "어떻게 띄울지"를 호출부가 `gated`로 정해 넘긴다.
  function confirmDeleteOneStep(revalidate: boolean, gated: boolean) {
    // 승인을 받고 띄운 경우에만 닫힘에서 그 자리를 돌려준다 — 경로 셋(그만두기·삭제·onDismiss)의
    // 단일 출구다. 언마운트 유예는 alertOverCardSlot이 함께 맡는다.
    let finished = false;
    const finish = () => {
      if (!gated || finished) return;
      finished = true;
      releaseSheetSlot();
    };
    const buttons: AlertButton[] = [
      { text: '그만두기', style: 'cancel', onPress: finish },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          // ⚠️ 확보한 자리를 **여기서 돌려준다.** 이어지는 재검증이 프리뷰를 **다시 조회**하므로
          //    (confirmDeleteZeroFinal) 여는 시점은 그 응답이 정한다 — 그 시점에 스스로 새로
          //    승인을 받는다. 지금 자리를 쥔 채로 넘기면 그 함수의 claim이 자기 자신과 겹친다.
          //    "승인을 받으면 반드시 연다"(:직렬화 계약)는 **열지 않을 거면 돌려주라**는 뜻이고,
          //    releaseSheetSlot이 그 반납 경로다 — 계약을 깨는 것이 아니라 그대로 따르는 것이다.
          finish();
          return revalidate ? confirmDeleteZeroFinal() : onDelete(challenge.id);
        },
      },
    ];
    if (gated) {
      alertOverCardSlot('챌린지 삭제', '이 챌린지를 삭제할까요?', buttons, { onDismiss: finish });
      return;
    }
    showGatedAlert('챌린지 삭제', '이 챌린지를 삭제할까요?', buttons);
  }

  // 0건 프리뷰의 확정 — 다시 받아 새 참여가 생겼는지 본다.
  async function confirmDeleteZeroFinal() {
    if (deleteLock.current) return;
    deleteLock.current = true;
    const seq = ++deleteSeqRef.current;
    try {
      if (cachedGroupId === null) throw new Error('unknown groupId');
      const fresh = await getChallengeDeletionPreview(cachedGroupId, challenge.id);
      if (seq !== deleteSeqRef.current) return; // 사용자가 그 사이 다른 동작을 했다 — 폐기.
      if (fresh.openSessions.length > 0) {
        // 프리플라이트가 끝난 지금이 실제로 여는 시점이다(위 openWeekSheet와 같은 근거).
        // ⚠️ 승인을 받으면 **반드시 연다** — 부모는 승인 한 건이 열림으로 마무리되기를 기다렸다
        //    다음 요청을 받으므로(직렬화), 여기서 조용히 빠져나가면 그 자리가 막힌다.
        //    승인 대기 중 다른 삭제 동작이 끼어들 수는 없다(deleteLock이 잡고 있다).
        if (!(await claimSheetSlot())) return;
        openSheet();
        setDeletePreview(fresh);
        // ⚠️ **이미 세운 등록(deletePreview) 위에 얹히는 Alert다.** 그냥 띄우면 카드가 사라질 때
        //    언마운트 정리의 열림 보고(false)가 살아 있는 등록을 꺼뜨린다 — 위 alertOverCardSlot.
        alertOverCardSlot('걸린 돈이 생겼어요', '방금 참여한 사람이 있어요. 내용을 확인해 주세요.');
        return;
      }
      await runDelete(false);
    } catch {
      // 성공 경로가 claimSheetSlot()을 지나므로 이 실패 경로도 승인을 받고 띄운다(위 훅 주석).
      await showGatedAlert.afterSlot(
        '삭제 영향을 확인하지 못했어요',
        '잠시 후 다시 시도해 주세요.',
      );
    } finally {
      deleteLock.current = false;
    }
  }

  // 삭제 진입(GROMO-1425) — 신서버(요일 반복 응답)에서는 deletion-preview 프리플라이트(N49)로
  // 걸린 돈을 먼저 확인한다. 참가비가 걸린 날이 있으면 1단계 확인 뒤 **수치 경고 시트**(2단계)를
  // 거친다(FR-12-1). 프리플라이트가 실패하면 삭제를 진행하지 않는다 — 수치 없는 경고는 경고가
  // 아니다. 구서버(repeatDays 부재 — 프리뷰 엔드포인트도 없다)는 종전 1단계 확인 그대로다.
  async function confirmDelete() {
    if (!isOwner) return;
    if (repeatDays === null) {
      // 동기 경로다 — 탭과 Alert 사이에 await가 없어 창이 없다(위 confirmDeleteOneStep 주석).
      confirmDeleteOneStep(false, false); // 프리뷰 엔드포인트가 없는 구서버 — 재검증할 수단이 없다.
      return;
    }
    if (deleteLock.current) return; // 프리플라이트가 도는 동안의 연타 방지(leaveLock 관행)
    deleteLock.current = true;
    try {
      if (cachedGroupId === null) throw new Error('unknown groupId'); // 캐시 미적중 — 공통 실패로.
      const preview = await getChallengeDeletionPreview(cachedGroupId, challenge.id);
      if (preview.openSessions.length === 0) {
        // ⚠️ 형제 분기(아래 `openSessions > 0`)와 **같은 창** 안에 있다 — 바로 위 `await`가 그
        //    창을 열었다. 한쪽 분기만 게이트를 두면 막은 것이 아니다: 프리플라이트를 기다리는
        //    사이 결과 모달이 노출되면 이 확인창이 그 위를 덮고 seen·ack이 나간다.
        if (!(await claimSheetSlot())) return;
        confirmDeleteOneStep(true, true);
        return;
      }
      // ⚠️ **확인 Alert를 띄우기 전에** slot을 확보하고, 닫힐 때까지 쥐고 있는다.
      //    버튼 콜백에서 확보하면 늦다: 네이티브 Alert는 RN Modal **위에** 떠서 그 아래에
      //    결과 모달이 마운트돼도 사용자는 못 보는데, 마운트되는 순간 seen 마커와 ack이
      //    나간다(둘 다 렌더 커밋 시점에 찍힌다). 그 상태로 앱이 종료되면 사용자는 결과를
      //    **못 본 채 재노출까지 막힌다.**
      //    이 배치에서 같은 뿌리가 네 번째다 — 코치마크 · 비동기 시트 · 비활성 구간 · 그리고
      //    이 Alert. OS 얼럿 일반은 앱이 막을 수 없지만, **우리가 띄우는 것**은 막을 수 있다.
      if (!(await claimSheetSlot())) return;
      // 확인 Alert가 닫히는 **모든 경로**의 단일 출구. 경로가 넷이라(그만두기 · 삭제 ·
      // onDismiss · 카드 언마운트) 각자 반납을 적으면 한 곳을 빠뜨린다 — 실제로 빠뜨렸다.
      // ⚠️ 자리를 붙들어 두는 일 자체는 alertOverCardSlot이 한다 — 여기서는 **확보한 승인을
      //    어떻게 마무리할지**(열거나 돌려주거나)만 정한다. 두 축이 다르다.
      let finished = false;
      const finishConfirm = (proceed: boolean) => {
        if (finished) return; // 한 Alert당 한 번만
        finished = true;
        // ⚠️ 카드가 이미 사라졌으면 **열림을 보고하면 안 된다.** 부모의 열림 집합에 죽은
        //    challengeId가 들어가고 그것을 false로 되돌릴 카드가 없어, 방을 떠날 때까지
        //    결과 모달이 영영 못 뜬다(부모 sheetOpenCardIds 주석의 바로 그 사고).
        if (!proceed || cardUnmountedRef.current) {
          releaseSheetSlot();
          return;
        }
        openSheet();
        setDeletePreview(preview);
      };
      // 물러나는 버튼은 위 1단계 확인과 같은 `그만두기`다(policy §A8).
      // ⚠️ **버튼을 안 거치고 닫히는 경로**가 있다(Android의 dismissExisting). 그 처리와
      //    "떠 있는 동안 카드가 사라져도 등록을 유지" 둘 다 alertOverCardSlot이 맡는다.
      alertOverCardSlot(
        '챌린지 삭제',
        '이 챌린지를 삭제할까요?',
        [
          // 물러나면 확보한 자리를 즉시 돌려준다 — 안 그러면 이 화면을 나갈 때까지 자리가 잠긴다.
          { text: '그만두기', style: 'cancel', onPress: () => finishConfirm(false) },
          {
            text: '삭제',
            style: 'destructive',
            // 이미 승인을 쥐고 있으므로 곧바로 연다(부모는 열림 보고로 승인을 마무리한다).
            onPress: () => finishConfirm(true),
          },
        ],
        { onDismiss: () => finishConfirm(false) },
      );
    } catch {
      // 성공 경로가 claimSheetSlot()을 지나므로 이 실패 경로도 승인을 받고 띄운다(위 훅 주석).
      await showGatedAlert.afterSlot(
        '삭제 영향을 확인하지 못했어요',
        '잠시 후 다시 시도해 주세요.',
      );
    } finally {
      deleteLock.current = false;
    }
  }

  // 두 회차 목록이 같은 영향 범위를 말하는가 — 날짜·인원·적립금·총 환불액 전부.
  function samePreview(
    a: ChallengeDeletionPreviewResponse,
    b: ChallengeDeletionPreviewResponse,
  ): boolean {
    if (a.totalRefund !== b.totalRefund || a.openSessions.length !== b.openSessions.length) {
      return false;
    }
    return a.openSessions.every((s1, i) => {
      const s2 = b.openSessions[i];
      return (
        s1.sessionDate === s2.sessionDate &&
        s1.participantCount === s2.participantCount &&
        s1.pot === s2.pot
      );
    });
  }

  // 2단계 시트의 최종 확정(GROMO-1425 · #570 codex ⑨) — 프리뷰를 받은 뒤 Alert·시트를 거치는
  // 동안 누가 더 참가하거나 회차가 정산될 수 있다. **낡은 수치로 확정하면 경고가 거짓말이 된
  // 상태로 돈이 움직인다** — 확정 직전에 다시 받아, 달라졌으면 삭제하지 않고 새 수치를 보여준다.
  // 재조회 실패도 삭제하지 않는다(프리플라이트 실패와 같은 규칙 — 수치 없는 경고는 경고가 아니다).
  async function confirmDeleteFinal(shown: ChallengeDeletionPreviewResponse) {
    if (deleteLock.current) return;
    deleteLock.current = true;
    // 이 확정의 신원 — 검증을 기다리는 동안 사용자가 시트를 닫으면(closeDeleteSheet) 값이 갈려
    // 아래 결과가 전부 폐기된다. **닫은 뒤에 삭제가 나가는 일**을 구조로 막는다(#570 codex ①).
    const seq = ++deleteSeqRef.current;
    try {
      if (cachedGroupId === null) throw new Error('unknown groupId');
      const fresh = await getChallengeDeletionPreview(cachedGroupId, challenge.id);
      if (seq !== deleteSeqRef.current) return; // 사용자가 그 사이 시트를 닫았다 — 아무 일도 없다.
      if (fresh.openSessions.length === 0) {
        // 그 사이 걸린 돈이 없어졌다 — 2단계 경고 자체가 불필요하다(N29). 바로 삭제한다.
        setDeletePreview(null);
        await runDelete(false);
        return;
      }
      if (!samePreview(shown, fresh)) {
        setDeletePreview(fresh);
        // 2단계 시트가 떠 있는 상태의 통보다 — 등록 위에 얹힌다(위 alertOverCardSlot).
        alertOverCardSlot('걸린 돈이 바뀌었어요', '바뀐 내용을 확인하고 다시 눌러 주세요.');
        return;
      }
      setDeletePreview(null);
      await runDelete(true);
    } catch {
      // ⚠️ 이 실패는 **2단계 시트가 떠 있는 채로** 난다(확정을 그 시트에서 눌렀다).
      //    등록 위에 얹히므로 같은 입구를 쓴다 — 승인이 필요 없다는 것과 별개 축이다.
      alertOverCardSlot('삭제 영향을 확인하지 못했어요', '잠시 후 다시 시도해 주세요.');
    } finally {
      deleteLock.current = false;
    }
  }

  // 삭제 실행 — 부모가 API 호출·재조회를 한다. **완료를 기다린 뒤** 잔액을 다시 받는다
  // (#570 codex ③): 삭제는 OPEN 회차를 무효화하고 전원 환불하는데(FR-12), 호출 전에 잔액을
  // 받으면 환불 전 값이 들어오고 삭제된 챌린지는 응답에서 사라져 정산 감지도 변화를 못 잡는다.
  async function runDelete(hadRefund: boolean) {
    await onDelete(challenge.id);
    if (hadRefund) refreshCoins();
  }

  // ── 이 카드가 소유한 시트 4종의 열림(GROMO-1578) ──
  // **아래 JSX의 마운트 조건을 그대로 이름만 붙인 것**이다 — 조건을 따로 적으면 한쪽만 고쳤을 때
  // 부모가 없는 시트를 있다고 믿거나(결과 모달이 영영 안 뜸) 있는 시트를 없다고 믿는다(딤 2겹).
  // 각 시트는 이 상수를 그대로 쓰므로 두 판정이 갈릴 수 없다.
  const lastResultSheetOpen = lastBetView?.kind === 'last' && lastBet !== null;
  const joinNextSheetOpen =
    betV2Sheet === 'next' && nextStake > 0 && nextDate !== null && cachedGroupId !== null;
  const joinWeekSheetOpen =
    weekSheetDates !== null && weekSheetDates.length > 0 && cachedGroupId !== null;
  const deleteSheetOpen = deletePreview !== null;
  const anySheetOpen =
    lastResultSheetOpen || joinNextSheetOpen || joinWeekSheetOpen || deleteSheetOpen;

  // 열림이 갈릴 때마다 부모에 올린다 — 부모는 이 값이 참인 동안 결과 모달을 미룬다.
  // ⚠️ **이 이펙트만으로는 늦다**(codex 사전 게이트 P2). 이펙트는 렌더가 커밋된 **뒤에** 도는데
  //    시트의 네이티브 Modal은 그 커밋에 이미 마운트된다. 같은 커밋에 부모의 결과 큐가 채워지면
  //    두 Modal이 함께 떠서, 이 배타 조건이 막으려던 딤 중첩이 그 한 프레임 동안 재현된다.
  //    그 창은 BET_RESULT 포그라운드 재조회(GROMO-1580)가 "화면에 머무는 중에도 큐가 채워지는"
  //    경로를 만들면서 실제로 넓어졌다. 그래서 **여는 순간**에도 openSheet()로 따로 보고한다.
  //    이 이펙트는 닫힘 보고와 안전망으로 남는다 — 낙관 보고가 어긋나면 여기서 정정된다.
  useEffect(() => {
    onSheetVisibilityChange?.(challenge.id, anySheetOpen);
  }, [onSheetVisibilityChange, challenge.id, anySheetOpen]);

  // 언마운트 정리 — 시트가 뜬 채로 카드가 사라지면(재조회로 챌린지가 목록에서 빠짐) 부모의
  // 열림 집합에 이 카드가 영원히 남아 결과 모달이 다시는 뜨지 않는다. 의존성은 신원뿐이라
  // (콜백은 부모가 useCallback으로 고정) 실제로 언마운트에서만 돈다.
  useEffect(() => {
    return () => {
      const cleanup = () => {
        onSheetVisibilityChange?.(challenge.id, false);
        onAbandonSheetSlot?.(challenge.id);
      };
      // ⚠️ **네이티브 Alert가 이 카드의 등록 위에 떠 있으면 정리를 통째로 미룬다**(위 주석).
      //    열림 보고(false)까지 미뤄야 한다 — 그 호출은 예전엔 무조건 나갔는데, 시트를 이미
      //    연 뒤에 뜬 Alert(걸린 돈이 생겼어요 · 바뀌었어요 · 확인 실패)에서는 **살아 있는
      //    등록을 실제로 꺼뜨린다.** 그러면 부모는 비었다고 믿고, 아직 떠 있는 Alert 뒤에서
      //    결과가 마운트·확인 처리된다 — 이 배치가 처음부터 막으려던 그 사고다.
      //    영구 점유가 아니다: 모든 Alert는 사용자가 닫아야 사라지고, 그 닫힘이 alertOverCardSlot의
      //    close()를 지나 여기 미뤄 둔 정리를 정확히 한 번 실행한다.
      if (openAlertCountRef.current > 0) {
        deferredCleanupRef.current = cleanup;
        return;
      }
      cleanup();
    };
  }, [onSheetVisibilityChange, onAbandonSheetSlot, challenge.id]);

  return (
    // 카드 자체는 더 이상 아무 제스처도 받지 않는다(GROMO-1101 — 롱프레스 삭제 제거).
    // 눌리는 자리는 전부 안쪽의 명시적 버튼이다.
    // 비활성 요일엔 카드 전체가 가라앉는다(FR-16-2) — 감추지는 않는다(그룹은 "우리가 지키기로
    // 한 것"의 전체 모습을 항상 봐야 한다). 오늘 도는 카드와 쉬는 카드가 한눈에 갈린다.
    <View
      style={[s.card, resting && s.cardResting]}
      testID={`group.challenge.card.${challenge.id}`}
    >
      <View style={s.head}>
        <View style={s.icon}>
          <Ionicons
            name={challenge.missionCategory === 'SCREEN_TIME' ? 'phone-portrait' : 'flag'}
            size={15}
            color={T.accent}
          />
        </View>
        <Text style={s.label} numberOfLines={1}>
          {/* 폴백은 문장이 아니라 세그먼트와 같은 '카테고리 명사' 자리다 — 고르는 자리의 명칭과 맞춘다.
              (문장 안에서는 `하루 60분 집중`처럼 짧은 쪽을 쓴다) */}
          {label ?? categoryLabel(challenge)}
        </Text>
        {/* 휴면 칩(GROMO-1201) — OPEN 내기가 없고 과거 내기 이력만 남은 챌린지. 서버가 지우는
            대신 표시로 가른다. undefined(휴면을 모르는 구서버)·false엔 아무것도 그리지 않는다.
            상태('참여 중')가 아니라 중립 표기라 '내일 시작' 칩 규격(betTomorrowTag)을 그대로 쓴다. */}
        {challenge.dormant === true && <Text style={s.betTomorrowTag}>휴면</Text>}
        {/* 방장 전용 삭제 X(GROMO-1101) — 서버도 방장 전용이라(NOT_OWNER 403) 비방장에겐
            그리지 않는다. 시각 28pt + hitSlop 8로 터치 타깃 44pt를 채운다 — 카드 본체가
            비터치라 확장 히트영역이 다른 버튼과 겹치지 않는다(내기 영역은 카드 하단이다). */}
        {isOwner && (
          <TouchableOpacity
            style={s.deleteBtn}
            activeOpacity={0.7}
            hitSlop={8}
            onPress={confirmDelete}
            accessibilityRole="button"
            accessibilityLabel="챌린지 삭제"
            testID={`group.challenge.delete.${challenge.id}`}
          >
            <Ionicons name="close" size={16} color={T.inkMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── 요일 배지 + 다음 회차(FR-16-1, GROMO-1274) — 미션 라벨 바로 아래(ux §02 위계 2번).
          repeatDays를 모르는 구서버 응답에는 그리지 않는다(종전 렌더 유지). 배지 3상:
          오늘이자 활성(accent 채움) · 활성(accentBg) · 쉬는 요일(track). */}
      {repeatDays !== null && (
        <View style={s.dowRow} accessible accessibilityLabel={dowA11y}>
          {REPEAT_DAY_ORDER.map((day, i) => {
            const on = repeatDays.includes(day);
            const isTodayCell = on && activeToday && day === todayRepeatDay;
            return (
              // 글자 배율 예외 — 22×22 고정 칩 7개가 한 줄에 들어가야 하고
              // overflow:'hidden'이라 커지면 글자가 잘린다(GROMO-1485).
              <Text
                key={day}
                style={[s.dow, on && s.dowOn, isTodayCell && s.dowToday]}
                allowFontScaling={false}
                testID={`group.challenge.dow.${challenge.id}.${day}`}
              >
                {REPEAT_DAY_LABELS[i]}
              </Text>
            );
          })}
          {nextLine !== null && (
            <Text
              style={s.dowNext}
              numberOfLines={1}
              testID={`group.challenge.next.${challenge.id}`}
            >
              {nextLine}
            </Text>
          )}
        </View>
      )}

      {/* SCREEN_TIME 뜻 한 줄 — 창(TIME_WINDOW) 카드는 라벨이 이미 시간대·목표를 말하므로
          '오늘 …' 문장 대신 측정 한계 고지(계약 필수 문구)를 세운다. */}
      {isScreenTime && !isWindow && <Text style={s.caption}>{SCREEN_TIME_CAPTION}</Text>}
      {isScreenTime && isWindow && <Text style={s.caption}>{WINDOW_MEASURE_CAPTION}</Text>}
      {!challenge.canParticipate && <Text style={s.warn}>{NO_PERMISSION_CAPTION}</Text>}

      {/* 쉬는 날엔 진행률을 재지 않는다(서버 memberProgress null) — '진행률을 표시하지 않는
          챌린지'로 오독되지 않게 사유를 갈아 끼운다(FR-16-2). */}
      {resting ? (
        <Text style={s.caption}>{REST_CAPTION}</Text>
      ) : (
        rows === null && <Text style={s.caption}>{NO_PROGRESS_CAPTION}</Text>
      )}

      {!resting && !!rows && rows.length > 0 && (
        <View style={s.progressList}>
          {rows.map((p) => {
            const isMe = !!myUserId && p.userId === myUserId;
            // 미집계는 '달성'으로 칠하지 않는다 — 서버가 계약을 어겨 achieved:true +
            // progressMinutes:null을 주면 '—'가 초록으로 칠해진다.
            const done = p.achieved === true && p.progressMinutes !== null;
            return (
              <View
                key={p.userId}
                style={[s.progressRow, isMe && s.progressRowMe]}
                accessible
                accessibilityLabel={progressA11y(p, challenge.durationMinutes)}
              >
                <Text style={[s.nickname, isMe && s.nicknameMe]} numberOfLines={1}>
                  {p.nickname}
                </Text>
                <Text
                  style={[
                    s.progress,
                    isMe && s.progressMe,
                    p.progressMinutes === null && s.progressNone,
                    done && s.progressDone,
                  ]}
                >
                  {progressText(p, challenge.durationMinutes)}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {!resting && hasUnmeasured && <Text style={s.caption}>{UNMEASURED_CAPTION}</Text>}

      {/* ── 내기 영역(3차 §1) — 진행 리스트 아래, 카드 하단 ──
          끝난 챌린지에 내기가 하나도 없으면 영역 자체를 두지 않는다 — 열 수 없는 자리에
          구분선만 남기면 무엇이 빠졌는지 알 수 없는 빈칸이 된다.
          ⚠️ v2 응답의 bet === null은 두 가지다 — **betConfig가 정본**이다(#572/B8):
            · betConfig.enabled === true  → 설정은 켜졌고 **오늘 회차만 없다**(쉬는 날·미개설).
              영역을 그리고 **예약 진입점만** 세운다(오늘 참가 버튼은 회차가 없으니 없다).
            · betConfig 없음(=꺼짐)      → "생성 시 내기를 껐다 = 불변"(N26·ux §05 분기 0).
              영역 자체를 두지 않는다 — 레거시 「내기 걸기」를 세우면 신서버에선 영구 실패
              버튼이고 브리지가 받아 주면 생성 시 선택을 거스른다(#570 codex ①).
          구서버(betConfig·repeatDays 모두 없음)는 종전 개설 플로우 그대로다. */}
      {betSupported && (bet !== null || (betOpenable && (!isV2 || betOn))) && (
        <View style={s.betArea}>
          {nextJoinable && nextDate !== null ? (
            // ⓪-v2 오늘 참가가 닫혔다(쉬는 날·회차 미개설·참가 마감 경과 — LLD §2.1 분기 1,
            //    GROMO-1419). 다음 활성일 시각·참가비를 보여주고 **1건**을 지금 예약하게 한다(N45).
            //    이미 예약했으면 버튼 대신 예약 상태 + 「참여 취소」 동선이다(N27·FR-31-1).
            //    참가비는 **다음 회차에 박제된 값**(nextStake)이다 — 회차가 이미 열려 있으면
            //    설정값과 갈릴 수 있고, 그때 차감되는 건 박제값이다(#572/B8).
            <>
              <View style={s.betRow}>
                <Text style={s.betText}>{nextDayPhrase(nextDate, todayKst, startHHmm)}</Text>
                <Text style={s.betTomorrowTag}>{nextStake}코인</Text>
              </View>
              <TouchableOpacity
                style={[s.joinNextBtn, betLocked && s.joinNextBtnOff]}
                activeOpacity={0.85}
                disabled={betLocked}
                onPress={openJoinNextSheet}
                accessibilityRole="button"
                testID={`group.bet.joinNext.${challenge.id}`}
              >
                <Text style={s.joinNextText}>{fmtMonthDayDow(nextDate)} 참여하기</Text>
              </TouchableOpacity>
            </>
          ) : leftByMe && !rejoinable && bet !== null ? (
            // ⓪ 방금 내가 빠졌는데 **다시 들어갈 자리가 없다** — 취소(내기를 통째로 닫았다)이거나
            //    마지막 참가자의 철회(서버가 내기를 CANCELED로 닫는다 — 챌린지는 휴면으로
            //    남는다, GROMO-1201)이거나 끝난 챌린지다. 영역을 비우면 방금 한 일이 사라진 것처럼 보이므로
            //    자리 캡션을 남긴다. 남은 인원이 있는(그러나 챌린지가 끝난) 경우에는 내기 정보도
            //    내 몫을 뺀 값으로 그린다(pot = stake × 인원 계약).
            //    재참여할 수 있는 철회는 이 분기로 오지 않는다 — 아래 ②가 참가 진입점을 세운다.
            <>
              {betMembers > 1 && (
                <View style={s.betRow}>
                  <Text style={[s.betText, s.betTextOff]}>
                    🪙 참가비 {displayStake} · 적립금 {displayPot - displayStake} · {betMembers - 1}
                    명 참여
                  </Text>
                  {isFutureBet && <Text style={s.betTomorrowTag}>내일 시작</Text>}
                </View>
              )}
              <Text style={s.caption}>
                {closedBet?.kind === 'cancel' ? BET_CANCELED_CAPTION : BET_LEFT_CAPTION}
              </Text>
            </>
          ) : bet === null && !isV2 ? (
            // ① 아직 내기가 없다(**구서버만**) — 아웃라인 소형 버튼. 카드 본체보다 약하게 둔다.
            //    이미 확정된 사람(FOCUS 달성·SCREEN_TIME 초과)은 개설도 서버가 거절하므로
            //    (BET_ALREADY_ACHIEVED · BET_ALREADY_FAILED) 미리 잠그고 사유를 적는다.
            //    v2엔 "내기 걸기"라는 행위가 없다(생성 시 1회 결정·불변 — N26).
            <>
              <TouchableOpacity
                style={[s.betCreateBtn, createBlocked && s.betCreateBtnOff]}
                activeOpacity={0.8}
                disabled={createBlocked}
                onPress={() => openBet('create')}
                accessibilityRole="button"
                testID={`group.bet.create.${challenge.id}`}
              >
                <Text style={[s.betCreateText, createBlocked && s.betCreateTextOff]}>
                  내기 걸기
                </Text>
              </TouchableOpacity>
              {myBlockedNow && <Text style={s.caption}>{blockedCreateCaption}</Text>}
            </>
          ) : bet === null ? (
            // ①-v2 내기는 켜져 있는데(betConfig) 오늘 회차가 없고 예약 진입점도 못 세우는 조합 —
            //    스크린타임 권한 없음(위 캡션이 사유를 말한다)·다음 활성일 미상(구·경계 응답).
            //    누를 자리 없이 설정만 적는다. 영역을 비우면 내기가 없는 챌린지로 읽힌다.
            <View style={s.betRow}>
              <Text style={[s.betText, s.betTextOff]}>🪙 참가비 {reserveStake}</Text>
            </View>
          ) : myJoinedNow && !rejoinable ? (
            // ③ 내가 참여 중 — 참가비·적립금·인원. '참여 중' 칩은 아직 열려 있는 내기에만 붙인다
            //    (정산이 끝난 내기에 '참여 중'을 달면 지금도 진행 중인 것으로 읽힌다).
            //    시작 전 OPEN 내기에는 참가 철회 진입점을 붙인다(계약 §4 — 개설자·단독 불문).
            //    방금 철회한 카드는 응답이 아직 myJoined=true라 rejoinable로 걸러 ②로 보낸다 —
            //    안 그러면 이미 빠진 내기에 '참여 중'과 철회 버튼이 다시 선다.
            <>
              <View style={s.betRow}>
                <Text style={s.betText}>
                  🪙 참가비 {displayStake} · 적립금 {displayPot} · {betMembers}명 참여
                </Text>
                {/* '내일 시작' — 서버가 내일 내기를 폴백으로 내려줄 수 있다(계약 §3). 표기가 없으면
                  오늘 내기로 읽힌다. 상태('참여 중')가 아니라 시점 표기라 중립 칩으로 가른다. */}
                {isFutureBet && <Text style={s.betTomorrowTag}>내일 시작</Text>}
                {sessionOpenNow && <Text style={s.betJoinedTag}>참여 중</Text>}
                {/* v2 오늘 회차 취소(N22·N27) — 서버 myLeaveDeadlineAt이 유일한 판정 근거다.
                  하루형 당일 참가자에겐 이 버튼이 **유일한 환불 창**이라(레거시 '시작 전' 판정은
                  영영 false) 없으면 오탭 참가를 되돌릴 방법이 사라진다(#570 codex ②).
                  회차 축을 아는 응답에서는 레거시 철회·취소 버튼을 세우지 않는다(배타 — 아래 조건). */}
                {todayLeavable && bet.session != null && (
                  <TouchableOpacity
                    style={[s.betLeaveBtn, leaveBusy && s.betLeaveBtnOff]}
                    activeOpacity={0.8}
                    disabled={leaveBusy}
                    onPress={() => confirmLeaveToday(bet.session!.sessionId, bet.session!.stake)}
                    accessibilityRole="button"
                    accessibilityLabel="오늘 참여 취소"
                    testID={`group.bet.leaveToday.${challenge.id}`}
                  >
                    <Text style={s.betLeaveText}>참여 취소</Text>
                  </TouchableOpacity>
                )}
                {leavable && bet.session === undefined && (
                  <TouchableOpacity
                    style={[s.betLeaveBtn, leaveBusy && s.betLeaveBtnOff]}
                    activeOpacity={0.8}
                    disabled={leaveBusy}
                    onPress={confirmLeaveBet}
                    accessibilityRole="button"
                    accessibilityLabel="참여 취소"
                    testID={`group.bet.leave.${challenge.id}`}
                  >
                    {/* 문구는 「참여 취소」다(N27) — 레거시 '철회'는 같은 행동의 옛 이름이라
                        v2 버튼과 다른 동사를 쓰면 두 기능처럼 읽힌다. 동작은 그대로 leaveBet. */}
                    <Text style={s.betLeaveText}>참여 취소</Text>
                  </TouchableOpacity>
                )}
                {/* 당일 단독 개설자 carve-out — cancelable이 !leavable을 품어 철회와 배타다.
                  회차 축을 아는 응답에는 세우지 않는다(취소는 회차 단위 leaveSession으로 통일 — §C8). */}
                {cancelable && bet.session === undefined && (
                  <TouchableOpacity
                    style={[s.betLeaveBtn, leaveBusy && s.betLeaveBtnOff]}
                    activeOpacity={0.8}
                    disabled={leaveBusy}
                    onPress={confirmCancelBet}
                    accessibilityRole="button"
                    accessibilityLabel="참여 취소"
                    testID={`group.bet.cancel.${challenge.id}`}
                  >
                    {/* 그냥 '취소'는 시트를 닫는 버튼과 헷갈린다 — 돈이 빠지는 행동이라
                        무엇을 취소하는지 버튼에 드러나야 한다(N27 · §9.3 A10). */}
                    <Text style={s.betLeaveText}>참여 취소</Text>
                  </TouchableOpacity>
                )}
              </View>
              {/* 남은 유예 초읽기 — 흐르는 걸 모르면 5분 유예는 없는 것과 같다(ux §05 ③).
                  매초 리렌더는 이 자식에 갇힌다(카드 본문·시트는 다시 그리지 않는다). */}
              {showLeaveCountdown && leaveDeadlineMs !== null && (
                <LeaveCountdown
                  deadlineMs={leaveDeadlineMs}
                  onExpire={onLeaveExpired}
                  testID={`group.bet.leaveCountdown.${challenge.id}`}
                />
              )}
            </>
          ) : sessionOpenNow && betOpenable && !todayJoinClosed ? (
            // ② 열려 있는데 나는 미참가 — 행 전체가 참가 진입점.
            //    ⚠️ 회차는 정산 전까지 OPEN으로 남지만 참가 마감(joinClosesAt)은 먼저 지난다 —
            //    그 구간을 여기로 흘리면 눌러도 항상 실패하는 「참가하기」가 선다(#570 codex ③).
            //    todayJoinClosed면 위 ⓪-v2(다음 활성일 예약)나 아래 정보 행으로 간다.
            //    이미 확정된 사람은 서버가 거절하므로(FOCUS는 BET_ALREADY_ACHIEVED,
            //    SCREEN_TIME은 BET_ALREADY_FAILED) 미리 잠근다.
            //    방금 철회한 카드(rejoinable)도 이 자리로 온다(GROMO-1112) — 철회 후 재참여 동선을
            //    따로 만들지 않고 **원래의 참가 진입점 그대로** 되살린다. 인원은 내 몫을 뺀
            //    joinMembers를 적고, 방금 빠졌다는 사실은 행 아래 캡션으로 남긴다.
            <>
              <TouchableOpacity
                style={[s.betRow, s.betJoinRow, (joinBlockedNow || betLocked) && s.betJoinRowOff]}
                activeOpacity={0.85}
                disabled={joinBlockedNow || betLocked}
                onPress={() => openBet('join')}
                accessibilityRole="button"
                testID={`group.bet.join.${challenge.id}`}
              >
                <Text style={[s.betText, (joinBlockedNow || betLocked) && s.betTextOff]}>
                  🪙 참가비 {displayStake} · {joinMembers}명 참여 중 — 참가하기
                </Text>
                {isFutureBet && <Text style={s.betTomorrowTag}>내일 시작</Text>}
              </TouchableOpacity>
              {joinBlockedNow && <Text style={s.caption}>{blockedCaption}</Text>}
              {rejoinable && <Text style={s.caption}>{BET_LEFT_CAPTION}</Text>}
            </>
          ) : (
            // 진입점을 열 수 없는 조합(마감·정산됐는데 나는 미참가 / 끝난 챌린지에 열린 내기가
            // 남아 있음) — 상태만 그대로 적고 누를 자리는 두지 않는다.
            <View style={s.betRow}>
              <Text style={[s.betText, s.betTextOff]}>
                🪙 참가비 {displayStake} · 적립금 {displayPot} · {betMembers}명 참여
              </Text>
              {isFutureBet && <Text style={s.betTomorrowTag}>내일 시작</Text>}
            </View>
          )}
          {/* 잡아 둔 다음 활성일 예약 — **분기와 무관하게** 항상 선다(#570 codex ①).
              오늘도 참여 중이면 위 분기는 오늘 행을 그리는데, 그 조건에 취소를 묶어 두면
              join-week으로 이미 낸 미래 예약을 무를 자리가 화면에서 사라진다. */}
          {nextReserved && nextDate !== null && (
            <View style={s.betRow}>
              <Text style={[s.betText, s.betTextOff]}>
                {nextDayPhrase(nextDate, todayKst, startHHmm)} · {nextStake}코인
              </Text>
              <Text style={s.betJoinedTag}>참여 중</Text>
              <TouchableOpacity
                style={[s.betLeaveBtn, leaveBusy && s.betLeaveBtnOff]}
                activeOpacity={0.8}
                disabled={leaveBusy}
                onPress={() => confirmLeaveNext(nextStake)}
                accessibilityRole="button"
                accessibilityLabel={`${fmtMonthDayDow(nextDate)} 참여 취소`}
                testID={`group.bet.leaveNext.${challenge.id}`}
              >
                <Text style={s.betLeaveText}>참여 취소</Text>
              </TouchableOpacity>
            </View>
          )}
          {/* 「이번 주 남은 날 전부」(GROMO-1276 — FR-31·N14) — 남은 참가 가능 날이 2개
              이상일 때만(1개면 단건 참여와 같아 의미가 없다 — LLD §2.2). 문구에 「회차」 금지(N28). */}
          {weekEligible && (
            <TouchableOpacity
              style={[s.weekBtn, betLocked && s.betLeaveBtnOff]}
              activeOpacity={0.8}
              disabled={betLocked}
              onPress={openWeekSheet}
              accessibilityRole="button"
              testID={`group.bet.week.${challenge.id}`}
            >
              <Text style={s.weekText}>이번 주 남은 날 전부</Text>
            </TouchableOpacity>
          )}
          {/* 휴면 사유 한 줄(GROMO-1201) — 칩만으로는 '휴면'이 왜인지 알 수 없다. 새 내기가
              서면 서버가 휴면을 해제하므로 개설 진입점('내기 걸기')은 그대로 살려 둔다. */}
          {challenge.dormant === true && <Text style={s.caption}>{DORMANT_CAPTION}</Text>}
        </View>
      )}

      {/* 지난 내기 1줄 — 탭하면 인별 결과 **바텀시트**(GROMO-1099가 '결과 전용 화면은 만들지
          않는다'(§0-4) 결정을 갱신했다 — 네이티브 Alert 나열이 '아이폰 알림창' 증상의 정체였다).
          전용 화면 대신 카드 위 시트다 — 네비게이션은 여전히 건드리지 않는다. */}
      {betSupported && lastBet !== null && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            openSheet();
            setLastBetView({ kind: 'last' });
          }}
          hitSlop={8}
          accessibilityRole="button"
          testID={`group.bet.last.${challenge.id}`}
        >
          <Text style={s.betLastCaption}>
            {/* 무산·삭제 무효화는 **판정을 한 적이 없다** — 「N명 중 0명 달성」으로 적으면 시트를
                열기도 전에 카드가 거짓을 말한다(#570 codex ①). 사유를 아는 회차는 사유로 적고,
                모르면(구서버·모르는 값) 종전 달성 집계 문장 그대로다. */}
            지난 내기({monthDay(lastBet.betDate)}):{' '}
            {lastVoidSummary ?? `${lastResults.length}명 중 ${lastAchieved}명 달성`}
          </Text>
        </TouchableOpacity>
      )}

      {lastResultSheetOpen && lastBet !== null && (
        <LastBetResultSheet
          lastBet={lastBet}
          myUserId={myUserId}
          // FOCUS 창의 5분 관용치 안내 판단용(GROMO-1207) — 결과 모달과 같은 조건.
          missionType={challenge.missionType}
          missionCategory={challenge.missionCategory}
          // 전체 이력 진입(GROMO-1221) — 시트를 걷고 push 대기로 전환한다(위 이펙트가 소비).
          onOpenHistory={() => setLastBetView({ kind: 'history' })}
          // 무효화 사유(#570 codex ④) — 무산·삭제 환불에 "달성한 사람이 없어"를 적지 않는다.
          voidReason={lastSettled?.voidReason ?? null}
          onClose={() => setLastBetView(null)}
        />
      )}

      {/* 다음 활성일 1건 예약 확인(GROMO-1419) — 성공하면 부모 재조회로 nextSessionJoined를
          갈아 끼운다(카드가 시트·API를 직접 쥐는 이유는 히스토리 push와 같다 — 부모는 형제
          워크스트림 전유라 배선을 늘리지 않는다). */}
      {/* ⚠️ 마운트 조건에 `bet !== null`을 두면 **회차 없는 날 버튼이 무반응**이 된다(#570 codex ①)
          — 그 날이 바로 이 시트가 필요한 날이다. 금액 축은 **박제값 우선**(nextStake)이다. */}
      {joinNextSheetOpen && nextDate !== null && cachedGroupId !== null && (
        <JoinNextSheet
          groupId={cachedGroupId}
          challengeId={challenge.id}
          label={label ?? categoryLabel(challenge)}
          sessionDate={nextDate}
          startTimeLabel={startHHmm}
          missionType={challenge.missionType}
          missionCategory={challenge.missionCategory}
          // 표시·잔액 부족 판정 모두 이 값 축이다 — join-next가 실제로 차감하는 금액.
          stake={nextStake}
          onClose={() => setBetV2Sheet(null)}
          onDone={() => {
            setBetV2Sheet(null);
            onBetChanged?.();
          }}
        />
      )}

      {/* 이번 주 남은 날 일괄 예약(GROMO-1276) — 대상 날짜는 열 때 예약 현황까지 반영해 확정한
          weekSheetDates다(위 openWeekSheet — #570 codex ②). */}
      {joinWeekSheetOpen && weekSheetDates !== null && cachedGroupId !== null && (
        <JoinWeekSheet
          groupId={cachedGroupId}
          challengeId={challenge.id}
          label={label ?? categoryLabel(challenge)}
          entries={weekSheetDates}
          startTimeLabel={startHHmm}
          missionType={challenge.missionType}
          missionCategory={challenge.missionCategory}
          onClose={() => setWeekSheetDates(null)}
          onDone={() => {
            setWeekSheetDates(null);
            onBetChanged?.();
          }}
        />
      )}

      {/* 진행 중 삭제 2단계 경고(GROMO-1425) — deletion-preview 수치가 도착한 뒤에만 열린다. */}
      {deleteSheetOpen && deletePreview !== null && (
        <ChallengeDeleteSheet
          label={label ?? categoryLabel(challenge)}
          preview={deletePreview}
          // 확정 직전 영향 범위 재검증 + 삭제 완료 후 잔액 갱신(#570 codex ⑨·③).
          onConfirm={() => confirmDeleteFinal(deletePreview)}
          onClose={closeDeleteSheet}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  // 카드 표면은 그룹방의 공지 카드와 같은 T.paperAlt — 같은 섹션 위계라 규격을 맞춘다.
  card: {
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    gap: T.space.xs,
  },
  // 비활성 요일 침강(FR-16-2) — 지우지 않고 옅게. 요일 배지·다음 회차는 그대로 읽힌다.
  cardResting: { opacity: 0.62 },
  head: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  // ── 요일 배지 행(GROMO-1274, ux §02) — 7칸 고정 + 오른쪽 다음 회차 문구. ──
  dowRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  dow: {
    ...T.text.caption,
    fontWeight: '600',
    color: T.inkFaint,
    backgroundColor: T.track,
    borderRadius: 6,
    width: 22,
    height: 22,
    textAlign: 'center',
    lineHeight: 22,
    overflow: 'hidden',
  },
  dowOn: { color: T.accentDeep, backgroundColor: T.accentBg },
  dowToday: { color: T.white, backgroundColor: T.accent },
  dowNext: {
    ...T.text.caption,
    fontWeight: '600',
    color: T.inkSub,
    marginLeft: 'auto',
    flexShrink: 1,
    fontVariant: ['tabular-nums'],
  },
  // 다음 활성일 참여 버튼(GROMO-1419) — 쉬는 날 카드의 유일한 행동이라 채운 와이드 버튼(ux §05 ①).
  joinNextBtn: {
    marginTop: T.space.sm,
    minHeight: 40,
    paddingVertical: T.space.sm,
    borderRadius: 12,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinNextBtnOff: { opacity: 0.5 },
  joinNextText: { ...T.text.label, color: T.white },
  // 「이번 주 남은 날 전부」 — 개설 버튼과 같은 소형 아웃라인 위계(주 동선은 단건 참여다).
  weekBtn: {
    marginTop: T.space.sm,
    alignSelf: 'flex-start',
    minHeight: 32,
    paddingVertical: T.space.xs,
    paddingHorizontal: T.space.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekText: { ...T.text.caption, color: T.accent },
  // 방장 삭제 X — 파괴 동작이지만 확인 Alert가 한 겹 있어 아이콘은 옅게(inkMuted) 둔다.
  // marginLeft:auto로 우측 끝 고정 — 라벨(flexShrink)이 길어도 자리를 뺏기지 않는다.
  deleteBtn: {
    marginLeft: 'auto',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accentBg,
  },
  label: { ...T.text.label, color: T.ink, flexShrink: 1 },
  caption: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  warn: { ...T.text.caption, color: T.dangerInk },

  // 진행 리스트 — 카드 안쪽이라 구분선 하나로 미션 라벨과 갈라 놓는다.
  progressList: {
    marginTop: T.space.xs,
    paddingTop: T.space.sm,
    borderTopWidth: 1,
    borderTopColor: T.divider,
    gap: T.space.xs,
  },
  // gap이 없으면 긴 닉네임의 줄임표와 진행 텍스트가 0px 간격으로 붙는다(nickname이 flexShrink).
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: T.space.sm,
  },
  // 내 행 — 배경 칩으로 띄운다. 카드 안쪽 여백을 파고들어야 행 폭이 리스트와 같아 보인다.
  progressRowMe: {
    backgroundColor: T.accentBg,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: T.space.sm,
    marginHorizontal: -T.space.sm,
  },
  nickname: { ...T.text.caption, fontWeight: '600', color: T.inkSub, flexShrink: 1 },
  nicknameMe: { color: T.accentDeep, fontWeight: '700' },
  progress: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
  },
  progressMe: { color: T.accentDeep },
  // 미집계 '—' — 실제 값과 같은 무게로 두면 0분과 구분되지 않는다.
  progressNone: { color: T.inkFaint, fontWeight: '500' },
  // 달성 — 색만으로는 미달성과 명도가 거의 같아(1.01:1) 색각 사용자에게 구분되지 않는다.
  // 배경 칩으로 형태 차이를 준다.
  progressDone: {
    color: T.successInk,
    backgroundColor: T.successBg,
    borderRadius: 8,
    paddingHorizontal: T.space.sm,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  // ── 내기 영역 — 진행 리스트와 같은 구분선 규격으로 한 칸 더 갈라 놓는다.
  betArea: {
    marginTop: T.space.xs,
    paddingTop: T.space.sm,
    borderTopWidth: 1,
    borderTopColor: T.divider,
  },
  // '내기 걸기' — 아웃라인 소형 버튼. 카드의 주 내용(진행 리스트)보다 약한 위계라 채우지 않는다.
  betCreateBtn: {
    alignSelf: 'flex-start',
    minHeight: 32,
    paddingVertical: T.space.xs,
    paddingHorizontal: T.space.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  betCreateBtnOff: { borderColor: T.border },
  betCreateText: { ...T.text.caption, color: T.accent },
  betCreateTextOff: { color: T.inkMuted },
  betRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  // 참가 진입 행 — 누를 수 있는 자리라 배경 칩으로 버튼임을 알린다.
  betJoinRow: {
    backgroundColor: T.accentBg,
    borderRadius: 10,
    paddingVertical: T.space.sm,
    paddingHorizontal: T.space.md,
  },
  betJoinRowOff: { backgroundColor: T.track },
  betText: { ...T.text.caption, color: T.inkSub, flexShrink: 1 },
  betTextOff: { color: T.inkMuted, fontWeight: '500' },
  // 참가 철회 — 소형 아웃라인. 돈이 되돌아와도 참가가 사라지는 파괴 동작이라 danger 잉크로 구분한다.
  betLeaveBtn: {
    minHeight: 26,
    paddingHorizontal: T.space.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  betLeaveBtnOff: { opacity: 0.5 },
  betLeaveText: { ...T.text.caption, color: T.dangerInk, fontWeight: '600' },
  // '내일 시작' 칩 — 내일 내기(계약 §3 폴백)의 시점 표기. '참여 중'(accent)과 같은 뱃지 규격이되
  // 상태가 아니라 시점이라 중립 색(chipBg/inkSub)으로 가른다 — BetSheet 참가비 칩의 기본색 관례.
  betTomorrowTag: {
    ...T.text.caption,
    color: T.inkSub,
    fontWeight: '700',
    backgroundColor: T.chipBg,
    borderRadius: 8,
    paddingHorizontal: T.space.sm,
    paddingVertical: 2,
  },
  // '참여 중' 칩 — GroupFindSheet의 같은 뱃지 규격(accent 칩).
  betJoinedTag: {
    ...T.text.caption,
    color: T.accentDeep,
    fontWeight: '700',
    backgroundColor: T.accentBg,
    borderRadius: 8,
    paddingHorizontal: T.space.sm,
    paddingVertical: 2,
  },
  // 지난 내기 1줄 — 지난 일이라 캡션보다 옅게, 그러나 탭 가능한 자리라 밑줄로 알린다.
  betLastCaption: {
    ...T.text.caption,
    fontWeight: '500',
    color: T.inkMuted,
    textDecorationLine: 'underline',
  },
});
