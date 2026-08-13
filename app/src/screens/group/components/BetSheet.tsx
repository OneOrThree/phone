import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { T } from '@/constants/theme';
import { SheetShell, useSheetClose } from '@/components/SheetShell';
import {
  BET_ALREADY_FAILED,
  BET_INSUFFICIENT_BALANCE,
  BET_SCREENTIME_PERMISSION_REQUIRED,
  BET_NOT_OPEN,
  BET_SESSION_CLOSED,
  BET_SESSION_NOT_FOUND,
  createBet,
  groupErrorCode,
  joinBet,
  joinSession,
} from '@/services/groupApi';
import {
  logCurrencyInsufficient,
  logGroupBetCreated,
  logGroupBetJoined,
  logGroupChallengeJoined,
} from '@/services/analyticsEvents';
import { useCoins } from '@/store/CoinContext';
import { useToast } from '@/store/ToastContext';
import { useUser } from '@/store/UserContext';
// KST 고정 버전을 쓴다 — bet_date는 서버가 KST로 판정하므로(계약 §1·§3) 기기 로컬 날짜를
// 보내면 비KST 기기에서 하루 어긋난다. 창 종료 판정(nowSecondsInZone('Asia/Seoul'))과 같은 축.
import { todayStrKst, tomorrowStrKst } from '@/utils/localDate';
import { nowSecondsInZone, timeStrToSeconds } from '@/utils/challengeTime';
import type { GroupChallengeResponse } from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';
import { fmtKoreanDuration } from '../challengeSchedule';
import type { BetSheetMode } from './ChallengeCard';
import BetBalanceRow from './BetBalanceRow';
import { categoryLabel, missionLabel } from './challengeLabel';
import {
  UNMEASURED,
  progressFraction,
  progressFractionA11y,
  unmeasuredA11y,
} from './progressFormat';

// 내기 시트(개설·참가) — 명세 docs/app/group-bet-plan.md §1, 계약 정본 docs/back/group-bet-plan.md §2.
//
// 한 컴포넌트가 두 모드를 겸한다 — 두 화면의 내용이 '판돈을 고르나, 정해진 판돈을 받아들이나'
// 하나만 다르고 나머지(챌린지 요약·내 코인·잔액 검사·에러 분기·CTA 규격)가 전부 같기 때문이다.
//
// ⚠️ 잔액은 CoinContext가 정본이다(§0-3). 시트를 열 때 refresh()로 서버 잔액을 다시 받는다 —
//    판돈 차감·정산 지급은 **서버가** 하므로 앱의 마운트 시점 잔액은 이미 낡아 있을 수 있고,
//    낡은 잔액으로 CTA를 열어 주면 INSUFFICIENT_CURRENCY로만 실패를 알게 된다.
// ⚠️ 성공·중복(BET_ALREADY_JOINED) 뒤에도 refresh() — 판돈이 빠진 잔액을 곧바로 맞춘다.
//
// 잔액 3상(3차 리뷰 F1·F3) — '모르는 값으로 사용자를 잠그지 않는다'가 원칙이다:
//   · coinsLoaded === false : **미상**. 잔액 자리는 '—', 부족 판정을 하지 않고 CTA는 열어 둔다.
//     판정은 서버에 맡긴다(서버가 400 INSUFFICIENT_CURRENCY로 확정해 준다). 인라인 재시도 한 줄을 둔다.
//   · coinsLoaded === true  : 그 값으로 부족분까지 계산해 **누르기 전에** 막는다.
//   · 서버가 부족을 확정(INSUFFICIENT_CURRENCY)하면 그 판정을 앱 상태로 승격해 CTA를 잠근다 —
//     refresh가 실패해 낡은 큰 잔액이 남아 있어도 "이 판돈으로는 안 된다"는 이미 확정이다.
//     판정은 **그 판돈 이상**에 유효하다(10이 안 되면 30·50·100도 안 된다) — 더 낮은 금액으로
//     내려갈 때만 근거가 사라진다(코덱스 리뷰). 해제 조건은 하나 더 있다: 판정 **이후에 도착한**
//     권위 있는 잔액이 낼 수 있다고 말하면 푼다(클로드 리뷰) — 시트를 열어 둔 사이 코인이 들어와도
//     참가 모드는 판돈을 바꿀 방법이 없어(칩이 없다) 영영 잠긴 채로 남기 때문이다.
//     '이후에 도착한'을 coinsVersion으로 판정하는 이유: 판정 직후의 잔액은 아직 낡은 값이라
//     크기만 보면 판정이 스스로를 즉시 풀어 버린다.
//
// 에러 표현(그룹 시트 3종 공통 규칙 + 이 시트의 예외):
//   · 다시 시도해 볼 만한 실패(잔액 부족·알 수 없는 오류)는 **인라인 문구**. 시트를 열어 둔다.
//   · 이 시트에서 재시도해도 영원히 같은 결과인 실패(이미 내기 있음·이미 달성·마감)는
//     **Alert + 시트 닫기 + 재조회**다. 카드가 쥔 상태가 이미 낡았다는 뜻이라 시트를 붙잡아 두면
//     같은 실패만 반복한다. Alert를 쓰는 이유는 인라인 문구가 시트와 함께 사라지기 때문이다
//     (ChallengeComposeSheet의 nonParticipants 안내와 같은 이유).

// 참가비 자유 입력(GROMO-1424 — N30·FR-29) — 상한 1,000 → **3,000**. 서버 검증(1~3,000)과
// 같은 범위를 클라에서도 민다. 범위 밖·빈 값이면 확인 버튼을 잠그고 인라인으로 알린다.
const STAKE_MIN = 1;
const STAKE_MAX = 3000;
// 빠른 선택 프리셋 — 절대값이 아니라 **상한 대비 비율(10/30/50/100%)**로 정의한다(N30).
// 상한이 또 바뀌어도 프리셋의 정의는 그대로고 값만 따라온다. 현 상한 3,000 기준 300/900/1,500/3,000.
// 칩 탭 = 입력 필드에 값 반영(단일 소스는 입력 필드다 — 칩의 '선택됨'은 파생 표시일 뿐이다).
const STAKE_RATIOS = [0.1, 0.3, 0.5, 1] as const;
const STAKE_OPTIONS = STAKE_RATIOS.map((r) => Math.round(STAKE_MAX * r));
// 기본 선택은 **가장 낮은 프리셋**. 돈이 걸린 선택의 기본값은 사용자가 아무 생각 없이 눌러도
// 가장 덜 잃는 쪽이어야 한다(챌린지 목표분 칩의 '가운데 기본값'과 기준이 다른 이유).
const STAKE_DEFAULT = STAKE_OPTIONS[0];
// 범위 안내 — 서버 BET_INVALID_STAKE 메시지와 같은 문장(같은 사실을 두 자리에서 달리 말하지 않는다).
const STAKE_RANGE_CAPTION = '참가비는 1~3,000코인 사이로 입력해 주세요';

// 시간대 마감 후 내일 적용(계약 §3, GROMO-1103) — 실패 모달 대신 처음부터 내일 내기로 연다.
// 시트 안 안내(열 때 이미 마감을 안 경우)와 토스트(경합 재시도로 내일 내기가 된 경우 — 시트가
// 닫히므로 인라인 자리가 없다)가 같은 사실을 말한다.
const TOMORROW_NOTE = '오늘 시간대가 끝나 내일 시간대부터 적용돼요';
// 토스트는 한 줄(numberOfLines=2)이라 제목·본문을 나눌 수 없다 — 개설 결과와 그 이유를
// 한 문장에 담는다(옛 Alert: '내일 내기로 열었어요' / '오늘 시간대가 끝나 내일 시간대부터 적용돼요.').
const TOMORROW_TOAST_MESSAGE = '오늘 시간대가 끝나 내일 내기로 열었어요';

// 몰수 룰(계약 확정 정책) — 승자 0명이면 환불이 아니라 **전액 소멸**이다. 돈이 걸리는 자리라
// 개설·참가 양쪽 모두에서 고지한다(구 문구 '전액 환불돼요'는 V19 룰 — 그대로 두면 거짓말이 된다).
const CREATE_NOTE =
  '오늘 목표를 달성한 사람끼리 적립금을 나눠 가져요. 아무도 달성하지 못하면 참가비는 사라져요.';
const JOIN_NOTE =
  '참가하면 참가비가 바로 빠져나가요. 오늘 목표를 달성해야 적립금을 나눠 가져요. 아무도 달성하지 못하면 참가비는 사라져요.';
// SCREEN_TIME 내기의 측정 한계 고지(계약 §2 "카드·시트 안내 문구 필수") — 15분 눈금 측정 위로
// 코인이 움직인다는 사실을 돈이 나가기 전에 알린다.
const SCREEN_TIME_BET_NOTE =
  '스크린타임은 15분 단위로 집계돼 오차가 있을 수 있어요. 집계가 늦거나 누락되면 미달성으로 판정될 수 있어요.';

// 잔액 미상 — 값 자리는 '—'(진행 리스트의 미집계 표기와 같은 규칙), 사유와 재시도는 한 줄로 둔다.
const BALANCE_UNKNOWN = '—';
const BALANCE_FAILED_CAPTION = '잔액을 불러오지 못했어요';
// 이미 달성 — 카드의 진입 차단 사유와 **같은 문장**을 쓴다(같은 사실을 두 자리에서 달리 말하지 않는다).
const BET_ACHIEVED_CAPTION = '이미 오늘 목표를 달성해서 참가할 수 없어요';
// 개설도 같은 사실로 막히지만(개설자는 자동 참가라 서버가 BET_ALREADY_ACHIEVED로 거절한다)
// 막히는 동작이 달라 문장을 따로 둔다 — 카드의 BET_ACHIEVED_CREATE_CAPTION과 같은 문장이다.
const BET_ACHIEVED_CREATE_CAPTION = '이미 오늘 목표를 달성해서 내기를 열 수 없어요';
// SCREEN_TIME은 차단 방향이 반대다(계약 §2 참가 가드 행 — BET_ALREADY_FAILED) —
// '이미 달성'이 아니라 '이미 목표 초과(확정 패배)'가 막는다. 카드와 같은 문장이다.
const BET_FAILED_CAPTION = '이미 목표를 초과해서 참가할 수 없어요';
const BET_FAILED_CREATE_CAPTION = '이미 목표를 초과해서 내기를 열 수 없어요';
// 전송 중 — 딤 탭·백을 막는 대신(F10) 멈춘 화면이 아님을 한 줄로 알린다.
const SUBMITTING_CAPTION = '처리 중이에요…';

// 잔액 부족 — CTA 라벨이 부족분을 직접 들고 있다(legacy ShopScreen의 '부족 (N 더 필요)' 규격).
function shortageLabel(shortage: number): string {
  return `코인이 부족해요 (${shortage} 필요)`;
}

// 하루형 진행분 공개(GROMO-1275)의 출발선 안내 — 정보를 주고 결정은 맡긴다(§C4).
function dayHeadstartNote(goalMinutes: number): string {
  return `먼저 시작한 사람이 유리해요. 지금 들어가면 남은 시간 안에 ${goalMinutes}분을 채워야 해요.`;
}

// 진행 바 채움 비율 — 목표를 모르거나 미집계면 0(지어내지 않는다). 초과분은 100에서 자른다.
function dayBarPercent(progressMinutes: number | null, goalMinutes: number | null): number {
  if (progressMinutes === null || !goalMinutes) return 0;
  return Math.min(100, Math.round((progressMinutes / goalMinutes) * 100));
}

// 하루형 진행 행 — 참가자 + '나'(아직 참가 전이지만 출발선 비교의 기준)를 한 리스트로 접는다.
interface DayProgressRow {
  userId: string;
  nickname: string;
  progressMinutes: number | null;
  achieved: boolean | null;
  isMe: boolean;
}

export interface BetSheetProps {
  groupId: string;
  // 내기를 걸 챌린지 — 요약 라벨·challengeId·현재 내기(참가 모드의 판돈·팟·참가자)를 여기서 읽는다.
  challenge: GroupChallengeResponse;
  mode: BetSheetMode;
  // 내가 오늘 목표를 이미 달성했는가 — **개설 모드**의 잠금 근거다.
  // 참가 모드는 서버가 준 bet.myAchievedNow를 쓰지만, 내기가 없는 챌린지엔 bet 자체가 없어
  // 이 사실을 실어 올 자리가 없다. 부모(GroupRoomScreen)가 challenge.memberProgress에서
  // 파생해 내려준다 — 카드의 개설 진입점이 쓰는 근거와 같은 값이다.
  myAchieved: boolean;
  // 딤 탭·취소 — 부모가 시트를 내린다.
  onClose: () => void;
  // 성공(또는 성공과 같게 취급하는 상태) — 부모가 시트를 내리고 챌린지를 재조회한다.
  onDone: () => void;
}

export default function BetSheet({
  groupId,
  challenge,
  mode,
  myAchieved,
  onClose,
  onDone,
}: BetSheetProps) {
  const { coins, coinsLoaded, coinsVersion, latestCoinsVersion, refresh } = useCoins();
  const { show } = useToast();
  // SCREEN_TIME의 차단 판정(이미 목표 초과)은 부모가 내려주지 않아 — myAchieved prop은 FOCUS
  // 의미(이미 달성)로 이미 배선돼 있고 부모(GroupRoomScreen)는 A3 전유다 — 내 진행 행을
  // 시트가 직접 읽는다. 카드의 myBlockedNow와 같은 근거·같은 3상 규칙이다.
  const { userId } = useUser();
  // 참가비는 **입력 필드가 단일 소스**다(GROMO-1097) — 칩은 이 값을 쓰는 원터치 프리셋일 뿐이다.
  // 문자열로 쥐는 이유: 지우는 중의 빈 값·앞자리 0 같은 입력 중간 상태를 숫자로 뭉개면
  // 타이핑이 뜻대로 되지 않는다. 검증·전송은 파생값(stakeValue)이 맡는다.
  const [stakeText, setStakeText] = useState<string>(String(STAKE_DEFAULT));
  // 시간대 챌린지의 '오늘 창이 이미 끝났나'(계약 §3, GROMO-1103) — 시트를 연 시점에 한 번만
  // 판정해 고정한다. 열어 둔 사이 마감·자정을 넘겨도 화면의 안내와 전송 날짜가 어긋나지 않는다.
  // 자정 걸침 창(start > end)은 제외 — 그 창의 실질 마감은 자정(서버 날짜 게이트)이라
  // '오늘 창이 끝났다'가 성립하지 않는다(서버 PR #446과 같은 해석).
  // 시각 비교는 Asia/Seoul 벽시계다(계약 §1 — 서버 today()·창 해석 모두 KST).
  const [betForTomorrow] = useState<boolean>(() => {
    if (mode !== 'create' || challenge.missionType !== 'TIME_WINDOW') return false;
    const start = timeStrToSeconds(challenge.windowStart);
    const end = timeStrToSeconds(challenge.windowEnd);
    return start <= end && nowSecondsInZone('Asia/Seoul') >= end;
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 서버가 확정한 잔액 부족(F3). 잔액을 다시 못 받아도 이 판돈이 안 된다는 사실은 이미 정해졌다.
  // '어느 판돈에서, 어느 잔액 버전에서' 확정됐는지까지 쥔다 — 해제 조건이 그 둘로 갈린다(위 주석).
  const [insufficientVerdict, setInsufficientVerdict] = useState<{
    stake: number;
    coinsVersion: number;
  } | null>(null);
  // 구서버가 아직 GUEST_FORBIDDEN을 반환하는 배포 공백에서도 재시도 안내 대신 로그인 경로를
  // 보여준다. 현재 서버에서는 도달하지 않지만, 앱을 먼저 배포해도 오도하지 않기 위한 방어선이다.
  const [guestBlocked, setGuestBlocked] = useState(false);
  const bet = challenge.bet ?? null;
  const label = missionLabel(challenge) ?? categoryLabel(challenge);
  const isCreate = mode === 'create';
  // 오늘 회차(신서버 — LLD §2.1 bet.session). undefined(구서버)와 null(오늘 회차 없음)은 둘 다
  // '회차로 참가할 수 없다'라 여기서는 null로 접는다 — 그 경우 참가는 종전 joinBet(betId) 경로다.
  const session = bet?.session ?? null;
  // 입력값 검증(1~1000 정수) — 입력이 digits만 통과하므로 남는 실패는 빈 값·범위 밖뿐이다.
  const stakeValue = stakeText === '' ? NaN : Number(stakeText);
  const stakeValid =
    Number.isInteger(stakeValue) && stakeValue >= STAKE_MIN && stakeValue <= STAKE_MAX;
  // 참가 모드의 판돈은 개설자가 이미 정했다 — 고를 수 없다. 개설 모드의 무효 입력은 0으로 둔다 —
  // 어차피 CTA가 잠기고(stakeValid), 부족분 계산이 NaN으로 번지지 않게 하기 위해서다.
  const amount = isCreate ? (stakeValid ? stakeValue : 0) : (bet?.stake ?? 0);
  const shortage = amount - coins;
  // 잔액을 모르면 부족 판정 자체를 하지 않는다 — 모르는 값으로 사용자를 잠그지 않는다(F1).
  const insufficient = coinsLoaded && shortage > 0;
  const insufficientLoggedRef = useRef<number | null>(null);
  // 판정 이후에 도착한 잔액이 '낼 수 있다'고 말하는가 — 그때만 서버 판정을 푼다.
  const balanceOverridesVerdict =
    insufficientVerdict !== null &&
    coinsLoaded &&
    coinsVersion > insufficientVerdict.coinsVersion &&
    shortage <= 0;
  const serverInsufficient =
    insufficientVerdict !== null && amount >= insufficientVerdict.stake && !balanceOverridesVerdict;
  // 시트를 연 뒤 상태가 확정됐다면(부모가 살아 있는 challenge를 갈아 끼운다) 참가도 개설도 반드시
  // 거절된다 — 카드가 진입 시점에 쓰는 기준을 시트도 끝까지 민다. 시트를 닫지는 않는다:
  // 팟·참가자(개설은 고른 판돈)를 보고 있는 화면을 걷을 이유는 없어 CTA만 잠그고 사유를 적는다.
  // 근거는 카테고리·모드별로 갈린다(카드 myBlockedNow·joinBlockedNow와 동일):
  //   FOCUS 개설  : 부모가 진행률에서 파생해 준 myAchieved(이미 달성 — BET_ALREADY_ACHIEVED)
  //   FOCUS 참가  : 서버가 준 내기의 myAchievedNow(같은 가드)
  //   SCREEN_TIME : 내 진행 행의 achieved === false(이미 목표 초과 — BET_ALREADY_FAILED).
  //                 myAchievedNow·myAchieved는 '잠정 달성'이라 차단 근거로 쓰지 않는다 —
  //                 하루가 끝나야 확정되는 값으로 잠그면 사실상 전원이 잠긴다(계약 §2).
  const isScreenTime = challenge.missionCategory === 'SCREEN_TIME';
  const isWindowChallenge = challenge.missionType === 'TIME_WINDOW';
  // ── 하루형 진행분 공개(GROMO-1275 — N16·§C4·FR-34) ──
  // 하루형은 출발선이 없어 늦게 들어올수록 불리하다 — 기존 참가자의 현재 진행분을 그대로
  // 보여주고, 불리한 판인 걸 **알고** 들어가게 한다(모르고 당하는 일을 없앤다).
  // 창형은 창 시작 전 마감이라 전원이 같은 출발선(§C3) — 이 블록이 서지 않는다.
  const daySession = !isCreate && !isWindowChallenge && session !== null ? session : null;
  // 판정 목표는 **회차에 박제된 값**이 정본(ux §04) — 없으면 챌린지 목표로 폴백.
  const dayGoal =
    daySession !== null ? (daySession.goalMinutes ?? challenge.durationMinutes) : null;
  // 오늘 남은 시간(KST 자정까지) — 시트를 연 시점에 고정한다(betForTomorrow와 같은 관행:
  // 열어 둔 사이 흐른 시간으로 화면 안내와 전송이 어긋나지 않는다). 서버 판정 축과 같은 KST 벽시계.
  const [remainMinutes] = useState<number>(() =>
    Math.max(0, Math.floor((86_400 - nowSecondsInZone('Asia/Seoul')) / 60)),
  );
  // 내 진행분 — 카드 진행 리스트와 같은 소스(memberProgress). FOCUS는 값 없음 = 0분이 사실이다.
  const myProgressRow = userId
    ? challenge.memberProgress?.find((p) => p.userId === userId)
    : undefined;
  // 남은 시간 부족 경고(N23·FR-35-1) — **차단하지 않고 경고만** 한다. 확정(이미 초과)과
  // 불리(시간 부족)는 다르다: 40분 남았는데 60분 목표는 무리일 뿐 불가능이 아니다.
  // SCREEN_TIME은 시간을 채우는 미션이 아니라 이 경고 자체가 성립하지 않는다.
  const timeShort =
    daySession !== null &&
    !isScreenTime &&
    dayGoal !== null &&
    dayGoal > 0 &&
    remainMinutes < dayGoal - (myProgressRow?.progressMinutes ?? 0);
  // 진행분 공개 리스트(나 포함 — ux §08 '나 0/60분'). 3상은 카드 진행 리스트와 같은 규칙:
  // FOCUS는 값 없음 = '0분 집중'이 사실이라 0으로 접고(FR-15), SCREEN_TIME 미집계는 null('—')을
  // 유지한다(FR-16 — 0으로 접으면 미보고가 '0분 사용'으로 뒤집힌다).
  const dayRows: DayProgressRow[] =
    daySession !== null
      ? [
          ...daySession.participants.map(
            (p): DayProgressRow => ({
              userId: p.userId,
              nickname: p.nickname,
              progressMinutes: p.progressMinutes ?? null,
              achieved: p.achieved ?? null,
              isMe: !!userId && p.userId === userId,
            }),
          ),
          ...(userId && !daySession.participants.some((p) => p.userId === userId)
            ? [
                {
                  userId,
                  nickname: '나',
                  progressMinutes: isScreenTime
                    ? (myProgressRow?.progressMinutes ?? null)
                    : (myProgressRow?.progressMinutes ?? 0),
                  achieved: myProgressRow?.achieved ?? null,
                  isMe: true,
                },
              ]
            : []),
        ]
      : [];
  const myFailedNow = isScreenTime && myProgressRow?.achieved === false;
  const achievedBlocked = isScreenTime
    ? myFailedNow
    : isCreate
      ? myAchieved
      : bet?.myAchievedNow === true;
  // 참가 모드인데 내기가 없다 = 카드가 열어 줄 수 없는 조합(부모가 막는다). 방어적으로 CTA만 잠근다.
  const disabled =
    submitting ||
    insufficient ||
    serverInsufficient ||
    achievedBlocked ||
    (isCreate && !stakeValid) ||
    (!isCreate && bet === null);

  useEffect(() => {
    if ((!insufficient && !serverInsufficient) || !stakeValid) return;
    if (insufficientLoggedRef.current === amount) return;
    insufficientLoggedRef.current = amount;
    logCurrencyInsufficient({
      context: 'bet',
      required: amount,
      shortfall: Math.max(0, amount - coins),
    });
  }, [amount, coins, insufficient, serverInsufficient, stakeValid]);

  // 시트를 열 때 서버 잔액을 다시 받는다(§0-3).
  useEffect(() => {
    refresh();
  }, [refresh]);

  // 재시도해도 같은 결과인 실패 — 알리고, 닫고, 부모가 재조회한다.
  function failAndReload(title: string, message: string) {
    Alert.alert(title, message);
    onDone();
  }

  // 개설 요청 + 성공 계측 — 최초 시도와 BET_CLOSED 재시도(내일 날짜)가 같은 경로를 탄다.
  async function requestCreate(date: string) {
    await createBet(groupId, challenge.id, { stake: amount, date });
    logGroupBetCreated({
      stake: amount,
      mission_type: challenge.missionType,
      mission_category: challenge.missionCategory,
    });
    logGroupChallengeJoined({
      session_count: 1,
      mission_type: challenge.missionType,
      mission_category: challenge.missionCategory,
    });
  }

  async function submit() {
    if (disabled) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      if (isCreate) {
        // 오늘 창이 이미 끝난 시간대 챌린지는 처음부터 내일 내기로 연다(계약 §3) —
        // 서버 409(BET_CLOSED) 실패 모달 대신 시트의 '내일 시간대부터 적용' 안내가 선다.
        await requestCreate(betForTomorrow ? tomorrowStrKst() : todayStrKst());
      } else {
        // 신서버(회차 모델)는 회차 단위 참여 경로를 쓴다(LLD §2.2) — 레거시 joinBet은 브리지
        // 주기 동안 구서버 응답에서만 남는다(N36).
        if (session !== null) {
          await joinSession(groupId, session.sessionId);
        } else {
          // 도달할 수 없는 조합이지만(위 disabled 가드), 도달하면 공통 문구로 떨어뜨린다 —
          // 그냥 return하면 submitting이 true로 남아 시트가 영영 잠긴다(F12).
          if (bet === null) throw new Error('bet is missing');
          await joinBet(groupId, bet.betId);
        }
        logGroupBetJoined({
          stake: amount,
          mission_type: challenge.missionType,
          mission_category: challenge.missionCategory,
        });
        logGroupChallengeJoined({
          session_count: 1,
          mission_type: challenge.missionType,
          mission_category: challenge.missionCategory,
        });
      }
      // 판돈이 빠진 잔액을 곧바로 맞춘다(응답을 기다리지 않는다 — 시트는 이미 닫힌다).
      refresh();
      onDone();
    } catch (e) {
      // 경합·마감 직후 대비(계약 §3): 오늘 날짜로 보냈는데 그 사이 창이 닫혔다면(BET_CLOSED)
      // 내일 날짜로 정확히 1회 재시도한다. 성공하면 같은 '내일 적용' 안내를 토스트로 세운다 —
      // 시트는 곧 닫히므로 인라인 안내는 설 자리가 없다(선택지 없는 결과 통보라 정책 D8/D19 —
      // docs/prd/motion-v2/policy.md, 상위 정본 병합 전까지 여기가 정본).
      if (isCreate && isWindowChallenge && !betForTomorrow && groupErrorCode(e) === 'BET_CLOSED') {
        try {
          await requestCreate(tomorrowStrKst());
          refresh();
          // ⚠️ 순서 주의 — 이 시트는 SheetShell asModal(RN Modal)이라 토스트가 그 **아래**에
          //    깔린다(Toast.tsx 헤더 주석). onDone()으로 먼저 닫고 나서 알린다.
          onDone();
          show({ message: TOMORROW_TOAST_MESSAGE, tone: 'success' });
          return;
        } catch (retryError) {
          // 재시도 실패는 원래 에러 분기로 보낸다 — 내일 날짜를 모르는 구서버는 BET_CLOSED를
          // 그대로 돌려주고(기존 '시간이 지났어요' 문구가 여전히 사실이다 — 내일이 되면 다시
          // 열 수 있다), 남이 먼저 연 내일 내기는 BET_ALREADY_EXISTS로 각자 분기를 탄다.
          // 이 실패는 **내일 날짜**로 보낸 요청의 것이다 — 문구가 '오늘'이라고 말하면 거짓이 된다.
          await handleSubmitError(retryError, true);
          return;
        }
      }
      await handleSubmitError(e, betForTomorrow);
    }
  }

  // 실패 분기 — 시트를 닫는 경로(failAndReload 등)는 return으로 빠져 submitting을 되돌리지 않고
  // (시트가 사라진다), 시트에 남는 경로만 마지막의 setSubmitting(false)에 닿는다.
  // sentTomorrow = 이 실패를 만든 요청이 실제로 보낸 날짜가 내일인가 — 날짜가 걸린 문구
  // (BET_ALREADY_EXISTS)를 사실대로 분기하는 근거다(PR #473 리뷰).
  async function handleSubmitError(e: unknown, sentTomorrow: boolean) {
    switch (groupErrorCode(e)) {
      // 이미 참가한 상태 = 원하던 결과다. 새 참가가 아니므로 계측은 발행하지 않는다
      // (GroupFindSheet의 ALREADY_MEMBER와 같은 규칙).
      case 'BET_ALREADY_JOINED':
        refresh();
        onDone();
        return;
      // 누가 먼저 열었는지는 앱이 알 수 없다 — 내 성공 직후의 재진입일 수도 있다(F6).
      // 사실 범위 안에서만 말한다.
      // 그 '내가 먼저 열었을' 가능성 때문에 잔액도 다시 받는다(코덱스 리뷰) — 응답만 타임아웃되고
      // 서버에선 개설이 성립했다면 판돈은 이미 빠졌는데 전역 잔액은 차감 전 값으로 남는다.
      // 남이 먼저 연 경우라면 재조회는 같은 값을 다시 확인할 뿐이라 무해하다.
      // 취소(CANCELED)된 내기는 신서버(1201/#498)에선 이 코드를 만들 수 없다 — 유니크가
      // CANCELED를 제외해 같은 날 재개설이 실제로 성공한다. 그 세계에선 이 409 = "활성 내기
      // 존재"라 '이미 열려 있어요'가 사실이다.
      // ⚠️ 단, V28 이전 구서버는 취소 행으로도 이 409를 내면서 카드에선 그 내기를 걸러 준다 —
      //    '참가할 수 있어요'를 약속하면 새로고침 후 참가할 내기가 없는 조합이 생긴다(codex
      //    리뷰). 그래서 본문은 존재 사실 + 새로고침 안내까지만 말한다(양쪽 서버에서 참).
      // ⚠️ 내일 날짜로 보낸 요청(마감 후 개설·재시도)의 충돌은 **내일** 내기 이야기다 —
      //    '오늘' 문구를 그대로 내면 거짓이 된다(PR #473 리뷰). 정책 설명 금지 — 계약 §2.
      case 'BET_ALREADY_EXISTS':
        refresh();
        failAndReload(
          sentTomorrow ? '이미 내일 내기가 열려 있어요' : '이미 오늘 내기가 열려 있어요',
          sentTomorrow
            ? '이미 내일 내기가 있어요. 새로고침해서 최신 상태를 확인해 주세요.'
            : '이미 오늘 내기가 있어요. 새로고침해서 최신 상태를 확인해 주세요.',
        );
        return;
      case 'BET_ALREADY_ACHIEVED':
        failAndReload('참가할 수 없어요', '이미 오늘 목표를 달성해서 참가할 수 없어요');
        return;
      // SCREEN_TIME의 반대 방향 가드(계약 §2) — 이미 목표를 초과해 확정 패배한 사람의 판돈
      // 투입을 서버가 막는다. 이 시트에서 재시도해도 오늘은 영원히 같은 실패다 — 닫고 재조회한다.
      case BET_ALREADY_FAILED:
        failAndReload(
          isCreate ? '내기를 열 수 없어요' : '참가할 수 없어요',
          isCreate ? BET_FAILED_CREATE_CAPTION : BET_FAILED_CAPTION,
        );
        return;
      // 같은 코드가 세 뜻이다(계약 §2·§4) — 참가는 '이미 마감', 개설은 'date가 오늘(KST)이
      // 아님', **창 내기의 개설·참가는 '오늘 창이 이미 끝남'**(now ≥ 오늘 창 endAt).
      // 아직 만들지도 않은 내기에 "이미 마감돼 참가할 수 없어요"는 뜻이 통하지 않는다(F4).
      case 'BET_CLOSED':
        failAndReload(
          isCreate
            ? isWindowChallenge
              ? '내기를 열 수 있는 시간이 지났어요'
              : '오늘 내기만 열 수 있어요'
            : '마감된 내기예요',
          isCreate
            ? isWindowChallenge
              ? '오늘 시간대가 끝나 내기를 열 수 없어요. 내일 다시 열 수 있어요.'
              : '날짜가 바뀌었어요. 새로고침 후 다시 시도해 주세요.'
            : '이미 마감돼 참가할 수 없어요.',
        );
        return;
      // 챌린지가 이미 비활성이다(GROMO-1025) — 시트의 마지막 성공 조회 이후 종료됐거나,
      // 재조회 실패로 낡은 ACTIVE 스냅샷을 보고 있던 경우다. 이 시트에서 재시도해도 영원히
      // 같은 실패라 닫고 재조회한다. 문구는 staleBetSheetAlert의 같은 사실 분기와 같은 문장이다.
      // ⚠️ 현재 서버는 이 코드를 **개설(createBet)에서만** 던진다 — joinBet은 챌린지 상태를
      //    보지 않는다(GroupBetService). 참가 분기는 도달 불가능한 선제 방어다: switch가 모드
      //    공용이고, 서버가 참가에도 같은 검사를 추가하면 그대로 대비된다(클로드 리뷰).
      case 'BET_CHALLENGE_INACTIVE':
        failAndReload(
          '끝난 챌린지예요',
          isCreate
            ? '종료된 챌린지에는 내기를 열 수 없어요.'
            : '종료된 챌린지의 내기에는 참가할 수 없어요.',
        );
        return;
      // 사라진 챌린지에 계속 걸어 봐야 결과는 같다 — 닫고 부모가 목록을 다시 받는다.
      case 'NOT_FOUND':
        failAndReload('사라진 챌린지예요', '방장이 챌린지를 없앴을 수 있어요.');
        return;
      // 챌린지가 아니라 **내기 자체**가 없다(계약 §2-2의 BET_NOT_FOUND — 404, 참가 경로).
      // 공통 문구('잠시 후 다시 시도')로 떨어뜨리면 영원히 같은 실패를 재시도하게 된다.
      // 회차 경로의 404(BET_SESSION_NOT_FOUND — 삭제·무산 경합)도 같은 사실·같은 처방이다.
      case 'BET_NOT_FOUND':
      case BET_SESSION_NOT_FOUND:
        failAndReload('사라진 내기예요', '이미 없어진 내기예요. 최신 상태로 새로고침할게요.');
        return;
      // 회차 참가 마감(신서버 — now ≥ joinClosesAt). 창형은 창이 열리는 순간 잠긴다(§C3) —
      // 이 시트에서 재시도해도 오늘은 같은 결과라 닫고 재조회한다.
      case BET_SESSION_CLOSED:
        failAndReload('마감됐어요', '이미 마감돼 참가할 수 없어요.');
        return;
      // 시트를 연 뒤 정산·무효화가 먼저 끝났다(#570 codex ⑦) — 들어갈 회차 자체가 닫혔으므로
      // 재시도해도 영원히 같은 실패다. 공통 문구('잠시 후 다시 시도')는 여기서 거짓이 된다.
      case BET_NOT_OPEN:
        failAndReload('이미 끝난 날이에요', '결과가 나왔거나 닫힌 날이라 참가할 수 없어요.');
        return;
      // SCREEN_TIME 권한 가드(N50) — 권한 없이 돈부터 받지 않는다. 재시도로 안 풀린다.
      case BET_SCREENTIME_PERMISSION_REQUIRED:
        failAndReload('참가할 수 없어요', '스크린타임 권한을 허용해야 참여할 수 있어요.');
        return;
      // 그룹에서 빠졌다 — 재시도로 풀리지 않는다. 부모가 재조회하면서 방 자체를 정리한다.
      case 'MEMBER_ONLY':
        failAndReload('그룹원만 이용할 수 있어요', '그룹에서 나갔거나 더 이상 멤버가 아니에요.');
        return;
      // 서버 게스트 허용 전 버전과의 배포 순서가 어긋나도 알 수 없는 오류로 숨기지 않는다.
      case 'GUEST_FORBIDDEN':
        setGuestBlocked(true);
        break;
      // 서버가 센 잔액이 앱과 다르다 — 다시 받아 부족분을 적고, 판정 자체는 서버 것을 그대로 쓴다.
      // 판정 시점의 잔액 버전을 함께 남긴다 — 이 판정을 푸는 건 그보다 **나중에 도착한** 잔액뿐이다.
      // 버전은 클로저(coinsVersion)가 아니라 CoinContext의 latestCoinsVersion()에서 읽는다.
      // 클로저는 제출을 시작한 렌더의 값이라, 요청이 나가 있는 사이 도착한 잔액(시트 오픈 때
      // 시작한 조회가 늦게 끝난 경우 — 차감 전이라 '낼 수 있다'고 말한다)이 판정보다 **먼저**
      // 도착했는데도 '판정 이후'로 세어져 CTA를 즉시 다시 열고 같은 400만 반복한다.
      // 이 시트가 effect로 미러링한 ref도 같은 문제가 남는다 — 잔액이 적용된 직후 다음 렌더·
      // passive effect 전에 이 catch가 돌면 한 틱 낡은 값을 쓴다. 그래서 응답 적용과 **동시에**
      // 오르는 정본을 직접 읽는다(코덱스 리뷰).
      // 회차 경로의 잔액 부족(BET_INSUFFICIENT_BALANCE — 409)도 같은 사실·같은 처방이다.
      case 'INSUFFICIENT_CURRENCY':
      case BET_INSUFFICIENT_BALANCE:
        // 서버 판정 이후 잔액을 먼저 재조회한다. 성공하면 아래 이벤트가 최신 잔액을
        // 기준으로 shortfall을 계산하고, 실패해도 서버가 부족하다고 확정한 사실은 보존한다.
        await refresh();
        setInsufficientVerdict({ stake: amount, coinsVersion: latestCoinsVersion() });
        break;
      // 게이트 확대(전 조합 허용)가 아직 배포되지 않은 서버는 FOCUS×DURATION 밖의 내기를
      // 이 코드로 거절한다(구 GroupBetService). 앱이 진입점을 먼저 열어 둔 배포 공백기의
      // 실존 경로라 분기를 둔다 — default의 '잠시 후 다시 시도'는 이 서버에선 영원히 거짓이다
      // (클로드 리뷰). 게이트 확대 배포 후엔 자연히 도달 불가가 된다.
      case 'BET_FOCUS_ONLY':
        failAndReload(
          '아직 내기를 걸 수 없는 챌린지예요',
          '지금은 하루 목표 집중 챌린지에만 내기를 걸 수 있어요. 서버 업데이트 후 열 수 있어요.',
        );
        return;
      // 계약의 나머지 코드는 앱이 보내는 조합에서 도달할 수 없어 분기를 두지 않는다:
      // BET_INVALID_STAKE는 클라가 같은 범위(1~1000)를 먼저 잠그기 때문이다(stakeValid).
      // 도달했다면 서버 계약이 바뀐 것이라 '알 수 없는 오류'로 말하는 편이 사실에 가깝다.
      default:
        setErrorMsg(
          isCreate
            ? '내기를 열지 못했어요. 잠시 후 다시 시도해 주세요.'
            : '참가하지 못했어요. 잠시 후 다시 시도해 주세요.',
        );
    }
    setSubmitting(false);
  }

  if (guestBlocked) {
    return <GuestBlockedView onClose={onClose} />;
  }

  return (
    // 전송 중에는 딤 탭·그랩바 드래그로 닫히지 않게 막는다(요청이 떠 있는 상태에서의 언마운트 방지).
    <SheetShell onClose={submitting ? () => {} : onClose} asModal dismissible={!submitting}>
      <Text style={s.title}>{isCreate ? '내기 걸기' : '내기 참가'}</Text>
      {/* 하루형 참가는 '오늘 남은 시간'이 곧 의사결정 정보다(N16) — KST 자정까지. */}
      <Text style={s.sub}>
        {daySession !== null
          ? `${label} · 오늘 남은 시간 ${fmtKoreanDuration(remainMinutes)}`
          : label}
      </Text>

      <View style={s.balance}>
        <Text style={s.balanceLabel}>내 코인</Text>
        {/* 미상이면 숫자를 지어내지 않는다 — 0을 적으면 화면이 사용자의 재산을 거짓으로 말한다(F1). */}
        <Text style={[s.balanceValue, !coinsLoaded && s.balanceUnknown]} testID="group.bet.balance">
          {coinsLoaded ? coins : BALANCE_UNKNOWN}
        </Text>
      </View>

      {/* 잔액을 못 받았다 — 사유와 재시도를 한 줄로. CTA는 잠그지 않고 서버 판정에 맡긴다. */}
      {!coinsLoaded && (
        <View style={s.balanceRetryRow}>
          <Text style={s.balanceRetryText}>{BALANCE_FAILED_CAPTION}</Text>
          <TouchableOpacity
            onPress={() => refresh()}
            hitSlop={12}
            activeOpacity={0.7}
            accessibilityRole="button"
            testID="group.bet.balance.retry"
          >
            <Text style={s.balanceRetryLink}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      )}

      {isCreate ? (
        <>
          <Text style={s.label}>참가비</Text>
          {/* 전송 중에는 참가비를 못 바꾼다(코덱스 리뷰) — 10을 보낸 뒤 100을 누르면 서버엔 10이
              간 채 화면의 선택만 100이 되어, 사용자는 자기가 100을 걸었다고 오인한다.
              고른 칩만 남기고 나머지를 흐려 '지금 나간 금액'이 무엇인지 화면에 못 박는다. */}
          <View style={s.chips}>
            {STAKE_OPTIONS.map((v) => {
              // 칩의 '선택됨'은 입력 필드 값의 파생 표시다 — 직접 입력으로 같은 값을 쳐도 켜진다.
              const on = stakeValid && stakeValue === v;
              return (
                <TouchableOpacity
                  key={v}
                  style={[s.chip, on ? s.chipOn : null, submitting && !on ? s.chipOff : null]}
                  activeOpacity={0.8}
                  disabled={submitting}
                  onPress={() => setStakeText(String(v))}
                  // 숫자만 읽히면 무엇을 고르는 자리인지·무엇이 골라졌는지 알 수 없다(F9).
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: submitting }}
                  accessibilityLabel={`참가비 ${v}코인`}
                  testID={`group.bet.stake.${v}`}
                >
                  <Text style={[s.chipText, on ? s.chipTextOn : null]}>{v}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* 직접 입력(1~1000) — 칩 탭도 여기로 흘러드는 단일 소스다. digits만 남겨 음수·소수·
              문자를 입력 단계에서 차단하고, 범위 검증은 stakeValid가 CTA·인라인 안내로 잠근다. */}
          <View style={s.stakeInputRow}>
            <TextInput
              style={s.stakeInput}
              value={stakeText}
              onChangeText={(t) => setStakeText(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              editable={!submitting}
              maxLength={4}
              placeholder={`${STAKE_MIN}~${STAKE_MAX}`}
              placeholderTextColor={T.inkFaint}
              accessibilityLabel="참가비 직접 입력"
              testID="group.bet.stake.input"
            />
            <Text style={s.stakeUnit}>코인</Text>
          </View>
          {/* 범위 밖·빈 값 — 모달이 아니라 인라인으로, CTA 잠금과 같은 근거를 같은 자리에서 말한다. */}
          {!stakeValid && <Text style={s.error}>{STAKE_RANGE_CAPTION}</Text>}
        </>
      ) : (
        <>
          <View style={s.statRow}>
            <View style={s.stat}>
              <Text style={s.statLabel}>참가비</Text>
              <Text style={s.statValue}>{bet?.stake ?? 0}</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statLabel}>현재 적립금</Text>
              <Text style={s.statValue}>{bet?.pot ?? 0}</Text>
            </View>
          </View>

          {daySession !== null ? (
            <>
              {/* 하루형 — 기존 참가자의 현재 진행분 공개(GROMO-1275, N16·FR-34). 진행 바 +
                  n/m분, 나 포함. 3상 준수(SCREEN_TIME 미집계 '—'). 스크롤 상한은 참가자 칩과
                  같은 이유(작은 화면에서 CTA·잔액이 밀리면 안 된다). */}
              <Text style={s.label}>지금 참여 중인 사람</Text>
              <ScrollView
                style={s.participantsScroll}
                contentContainerStyle={s.dayRows}
                nestedScrollEnabled
                testID="group.bet.dayProgress"
              >
                {dayRows.map((r) => {
                  // 미집계를 '달성'으로 칠하지 않는다 — 카드 진행 리스트와 같은 방어.
                  const done = r.achieved === true && r.progressMinutes !== null;
                  return (
                    <View
                      key={r.userId}
                      style={s.dayRow}
                      accessible
                      accessibilityLabel={
                        r.progressMinutes === null
                          ? unmeasuredA11y(r.nickname)
                          : done
                            ? `${r.nickname} 달성`
                            : progressFractionA11y(r.nickname, r.progressMinutes, dayGoal)
                      }
                    >
                      <Text style={[s.dayNick, r.isMe && s.dayNickMe]} numberOfLines={1}>
                        {r.nickname}
                      </Text>
                      <View style={s.dayBar}>
                        <View
                          style={[
                            s.dayBarFill,
                            // RN DimensionValue의 퍼센트 리터럴 타입으로 좁힌다(값은 0~100 정수).
                            {
                              width:
                                `${dayBarPercent(r.progressMinutes, dayGoal)}%` as `${number}%`,
                            },
                          ]}
                        />
                      </View>
                      <Text
                        style={[
                          s.dayVal,
                          r.progressMinutes === null && s.dayValNone,
                          done && s.dayValDone,
                        ]}
                      >
                        {r.progressMinutes === null
                          ? UNMEASURED
                          : done
                            ? '달성 ✓'
                            : progressFraction(r.progressMinutes, dayGoal)}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
              {/* 남은 시간 부족 — **경고만, 버튼은 살아 있다**(N23·FR-35-1). 차단하면 사람마다
                  참가 마감이 달라져 설명할 수 없는 화면이 된다. */}
              {timeShort && dayGoal !== null && (
                <Text style={s.error} testID="group.bet.timeShort">
                  남은 {fmtKoreanDuration(remainMinutes)}으로 {dayGoal}분을 채우기는 어려워요
                </Text>
              )}
            </>
          ) : (
            <>
              <Text style={s.label}>참가자 {bet?.participants?.length ?? 0}명</Text>
              {/* 참가자는 최대 10명이고 닉네임 길이·접근성 글꼴에 따라 줄 수가 늘어난다. 시트 패널은
                  하단 고정 absolute라 높이 제한이 없으면 작은 화면에서 제목·내 코인 같은 위쪽 내용이
                  화면 밖으로 밀려 확인할 수 없게 된다(코덱스 리뷰) — 이 영역만 스크롤로 가둔다.
                  시트 본문 전체가 아니라 참가자 영역만 가두는 이유: 판돈·팟·CTA는 항상 보여야 한다. */}
              <ScrollView
                style={s.participantsScroll}
                contentContainerStyle={s.participants}
                // 시트 자체는 스크롤 뷰가 아니지만, 안드로이드에서 중첩 제스처를 막지 않게 함께 켠다.
                nestedScrollEnabled
                testID="group.bet.participants"
              >
                {(bet?.participants ?? []).map((p) => (
                  <Text key={p.userId} style={s.participant} numberOfLines={1}>
                    {p.nickname}
                  </Text>
                ))}
              </ScrollView>
            </>
          )}
        </>
      )}

      {/* 마감 후 개설(계약 §3) — 이 내기가 '내일' 것임을 돈이 나가기 전에 못 박는다. */}
      {betForTomorrow && (
        <View style={s.note} testID="group.bet.tomorrowNote">
          <Ionicons name="time-outline" size={15} color={T.accent} style={s.noteIcon} />
          <Text style={s.noteText}>{TOMORROW_NOTE}</Text>
        </View>
      )}

      <View style={s.note}>
        <Ionicons name="information-circle-outline" size={15} color={T.accent} style={s.noteIcon} />
        <Text style={s.noteText}>
          {/* 하루형 FOCUS 참가는 출발선 안내(§C4)를 몰수 룰 앞에 잇는다 — 불리한 판인 걸 알고
              들어가는 건 본인 선택이지만, 모르고 당하는 일은 없앤다. */}
          {isCreate
            ? CREATE_NOTE
            : daySession !== null && !isScreenTime && dayGoal
              ? `${dayHeadstartNote(dayGoal)}\n${JOIN_NOTE}`
              : JOIN_NOTE}
          {/* SCREEN_TIME은 측정 한계 고지를 한 줄 잇는다(계약 필수 문구) — 돈이 나가기 전이 마지막 고지 자리다. */}
          {isScreenTime ? `\n${SCREEN_TIME_BET_NOTE}` : ''}
        </Text>
      </View>

      {/* 참가 시트 잔액 표기(GROMO-1424 — N46 단독 소유 컴포넌트) — 「참가비 30 · 내 잔액 240」
          까지다. 차감 후 값 병기 금지. 잔액 부족 차단은 아래 CTA 잠금이 그대로 유지한다(FR-32). */}
      {!isCreate && <BetBalanceRow amount={amount} coins={coinsLoaded ? coins : null} />}

      {/* 서버가 확정한 부족. 잔액을 다시 받아 부족분(N)까지 알게 되면 CTA 라벨이 규격대로
          `코인이 부족해요 (N 필요)`를 말하므로(§1), 같은 문장을 두 번 적지 않는다. */}
      {serverInsufficient && !insufficient && <Text style={s.error}>코인이 부족해요</Text>}
      {/* 잠긴 CTA에는 사유가 붙어야 한다 — 카드가 쓰는 문장 그대로(카테고리·모드별로 갈린다). */}
      {achievedBlocked && (
        <Text style={s.error}>
          {isScreenTime
            ? isCreate
              ? BET_FAILED_CREATE_CAPTION
              : BET_FAILED_CAPTION
            : isCreate
              ? BET_ACHIEVED_CREATE_CAPTION
              : BET_ACHIEVED_CAPTION}
        </Text>
      )}
      {errorMsg !== null && <Text style={s.error}>{errorMsg}</Text>}

      <TouchableOpacity
        style={[s.submitBtn, disabled && s.submitBtnOff]}
        activeOpacity={0.85}
        disabled={disabled}
        onPress={submit}
        testID="group.bet.submit"
      >
        {submitting ? (
          <ActivityIndicator color={T.white} />
        ) : (
          <Text style={s.submitText}>
            {insufficient ? shortageLabel(shortage) : isCreate ? '내기 열기' : '참가하기'}
          </Text>
        )}
      </TouchableOpacity>

      {/* 전송 중엔 CTA도 딤 탭도 막혀 있다 — 최대 15초(axios 타임아웃) 동안 멈춘 화면으로
          보이지 않게 한 줄 세운다. 닫기를 열어 주는 쪽은 AbortController가 필요해 더 두껍다(F10). */}
      {submitting && <Text style={s.submittingCaption}>{SUBMITTING_CAPTION}</Text>}
    </SheetShell>
  );
}

function DismissCta() {
  const close = useSheetClose();
  return (
    <TouchableOpacity style={s.ghostBtn} activeOpacity={0.7} onPress={close}>
      <Text style={s.ghostText}>다음에 할게요</Text>
    </TouchableOpacity>
  );
}

function GuestBlockedView({ onClose }: { onClose: () => void }) {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  return (
    <SheetShell onClose={onClose} asModal>
      <Text style={s.title}>로그인하면 내기에 참여할 수 있어요</Text>
      <Text style={s.sub}>게스트는 코인을 쓸 수 없어요.</Text>
      <TouchableOpacity
        style={s.submitBtn}
        activeOpacity={0.85}
        onPress={() => {
          onClose();
          navigation.navigate('SettingsAccount');
        }}
        testID="group.bet.login"
      >
        <Text style={s.submitText}>로그인하러 가기</Text>
      </TouchableOpacity>
      <DismissCta />
    </SheetShell>
  );
}

const s = StyleSheet.create({
  // 제목·부제·라벨·칩·노트·CTA 규격은 ChallengeComposeSheet와 같다 — 같은 섹션의 형제 시트다.
  title: { ...T.text.body, fontWeight: '800', color: T.ink },
  sub: { ...T.text.label, fontWeight: '500', color: T.inkMuted, marginTop: 2 },

  // 내 코인 — 앱에서 재화를 처음 노출하는 자리라(§0-2) 강조 칩 하나로 못 박는다.
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: T.accentBg,
    borderRadius: 12,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.lg,
  },
  balanceLabel: { ...T.text.label, color: T.inkSub },
  balanceValue: {
    ...T.text.subtitle,
    color: T.accentDeep,
    fontVariant: ['tabular-nums'],
  },
  // 미상 '—' — 실제 값과 같은 무게로 두면 0코인과 구분되지 않는다(진행 리스트 progressNone과 같은 규칙).
  balanceUnknown: { color: T.inkFaint },

  // 잔액 조회 실패 한 줄 — 문구는 danger, 재시도는 accent 링크(그룹 화면 공통 배너 규격).
  balanceRetryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: T.space.sm,
  },
  balanceRetryText: { ...T.text.caption, color: T.dangerInk },
  balanceRetryLink: { ...T.text.caption, color: T.accent },

  label: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    marginTop: T.space.lg,
    marginBottom: T.space.sm,
  },

  chips: { flexDirection: 'row', gap: T.space.sm },
  chip: {
    flex: 1,
    minHeight: 44,
    paddingVertical: T.space.md,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.chipBg,
    borderWidth: 1,
    borderColor: T.chipBorder,
  },
  chipOn: { backgroundColor: T.accentBg, borderColor: T.accent },
  // 전송 중 — 고르지 않은 칩만 흐려서 '이미 확정된 금액'을 남긴다(CTA off와 같은 0.5).
  chipOff: { opacity: 0.5 },
  chipText: { ...T.text.label, color: T.inkSub, fontVariant: ['tabular-nums'] },
  chipTextOn: { color: T.accentDeep, fontWeight: '700' },

  // 직접 입력 — 칩과 같은 44 높이·같은 면 처리(같은 값을 다루는 형제 컨트롤이라 규격을 맞춘다).
  stakeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    marginTop: T.space.sm,
  },
  // TextInput 본체라 세로 패딩을 안 준다 — 안드는 includeFontPadding 때문에 라인박스가
  // iOS보다 두꺼워 44 - 24 = 20pt 안에 한 줄이 아슬아슬하게 들어간다. minHeight만으로 충분.
  stakeInput: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.chipBorder,
    backgroundColor: T.chipBg,
    paddingHorizontal: T.space.lg,
    ...T.text.label,
    color: T.ink,
    fontVariant: ['tabular-nums'],
  },
  stakeUnit: { ...T.text.label, color: T.inkSub },

  // 참가 모드의 판돈·팟 — 고를 수 없는 값이라 칩이 아니라 읽기용 타일로 둔다.
  statRow: { flexDirection: 'row', gap: T.space.sm, marginTop: T.space.lg },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 12,
    paddingVertical: T.space.md,
  },
  statLabel: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  statValue: { ...T.text.subtitle, color: T.ink, fontVariant: ['tabular-nums'] },

  // 참가자 칩 3줄분(칩 높이 26 × 3 + 줄 간격 2 × 8)이 기본 상한 — 그 이상은 스크롤한다.
  // flexGrow:0을 함께 두는 이유: ScrollView는 기본이 flex:1이라 시트 안에서 남은 높이를
  // 다 차지해 버려, 참가자가 한 줄뿐일 때도 빈 공간이 생긴다.
  participantsScroll: { maxHeight: 94, flexGrow: 0 },
  participants: { flexDirection: 'row', flexWrap: 'wrap', gap: T.space.sm },
  // ── 하루형 진행분 공개(GROMO-1275) — 닉네임 · 진행 바 · n/m분 한 행. ──
  dayRows: { gap: T.space.xs },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  dayNick: { ...T.text.caption, fontWeight: '600', color: T.inkSub, width: 64 },
  dayNickMe: { color: T.accentDeep, fontWeight: '700' },
  // 진행 바 — 카드 3상과 같은 결: 미집계는 0으로 채우지 않는다(지어내지 않는다).
  dayBar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: T.track, overflow: 'hidden' },
  dayBarFill: { height: 6, borderRadius: 3, backgroundColor: T.accent },
  dayVal: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
    minWidth: 56,
    textAlign: 'right',
  },
  dayValNone: { color: T.inkFaint, fontWeight: '500' },
  dayValDone: { color: T.successInk },
  participant: {
    ...T.text.caption,
    color: T.inkSub,
    backgroundColor: T.chipBg,
    borderRadius: 8,
    paddingHorizontal: T.space.sm,
    paddingVertical: 3,
    maxWidth: 140,
  },

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: T.space.sm,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    marginTop: T.space.md,
  },
  noteIcon: { marginTop: 2 },
  noteText: { ...T.text.caption, fontWeight: '500', color: T.inkSub, flex: 1, lineHeight: 19 },

  error: { ...T.text.caption, color: T.dangerInk, marginTop: T.space.md },

  // 시트 CTA = 52 / r16 (그룹 시트 공통 규격).
  submitBtn: {
    minHeight: 52,
    paddingVertical: T.space.md,
    borderRadius: 16,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: T.space.lg,
  },
  submitBtnOff: { opacity: 0.5 },
  submitText: { ...T.text.subtitle, color: T.white },
  ghostBtn: { alignItems: 'center', marginTop: T.space.md, paddingVertical: T.space.sm },
  ghostText: { ...T.text.label, color: T.inkMuted },
  // 전송 중 안내 — CTA 바로 아래 가운데 한 줄.
  submittingCaption: {
    ...T.text.caption,
    fontWeight: '500',
    color: T.inkMuted,
    textAlign: 'center',
    marginTop: T.space.sm,
  },
});
