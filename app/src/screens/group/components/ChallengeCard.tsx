import { useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import {
  BET_CANCEL_FORBIDDEN,
  BET_CANCEL_HAS_OTHERS,
  BET_NOT_OPEN,
  cancelBet,
  challengeGroupId,
  groupErrorCode,
} from '@/services/groupApi';
import { logGroupBetCanceled } from '@/services/analyticsEvents';
import { useCoins } from '@/store/CoinContext';
import type { ChallengeMemberProgress, GroupChallengeResponse } from '@/types/dto/group';
import { categoryLabel, missionLabel } from './challengeLabel';

// 챌린지 카드(그룹방 챌린지 섹션 1장) — 명세 docs/app/group-plan-2.md §3-2.
//
// 미션 라벨 + 멤버별 진행 리스트. 방장은 롱프레스로 삭제한다(행 안에 버튼을 두면
// 진행 리스트의 시선을 뺏고, 오탭 시 되돌릴 방법이 없다 — 확인 Alert를 한 겹 둔다).
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
// 롱프레스 삭제는 발견 가능성이 0이다 — 방장에게만 한 줄로 알린다.
const DELETE_HINT_CAPTION = '길게 눌러 삭제';
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
// 취소 직후의 자리 표시 — 영역을 그냥 비우면 방금 한 일이 사라진 것처럼 보인다(betLocked와 같은 이유).
const BET_CANCELED_CAPTION = '내기를 취소했어요. 참가비는 잔액으로 돌아왔어요';

// 'YYYY-MM-DD' → '7월 31일'. 연도는 넣지 않는다 — '지난 내기'는 늘 최근 며칠이다.
// '7/31' 축약은 날짜인지 비율인지 한눈에 안 읽혀 단위를 붙인다(ChallengeResultModal과 같은 표기).
// 형식이 다르면 원문을 그대로 둔다(서버가 다른 포맷을 주면 깨진 날짜보다 원문이 낫다).
function monthDay(betDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(betDate);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : betDate;
}

// 멤버 한 명의 진행 표기 — 위 3상 규칙 그대로.
function progressText(p: ChallengeMemberProgress, durationMinutes: number | null): string {
  if (p.progressMinutes === null) return '—';
  if (p.achieved) return '달성 ✓';
  return durationMinutes ? `${p.progressMinutes}/${durationMinutes}분` : `${p.progressMinutes}분`;
}

// 행 전체를 한 덩어리로 읽히게 한다 — 안 묶으면 VoiceOver가 닉네임과 진행을 따로 읽고
// '—'를 "대시"로 발음해 미집계라는 뜻이 전달되지 않는다.
function progressA11y(p: ChallengeMemberProgress, durationMinutes: number | null): string {
  if (p.progressMinutes === null) return `${p.nickname} 아직 집계되지 않음`;
  if (p.achieved) return `${p.nickname} 달성`;
  return durationMinutes
    ? `${p.nickname} ${durationMinutes}분 중 ${p.progressMinutes}분`
    : `${p.nickname} ${p.progressMinutes}분`;
}

// 내기 시트를 어떤 모드로 열 것인가 — 개설(아직 내기 없음) / 참가(OPEN 내기에 합류).
export type BetSheetMode = 'create' | 'join';

export interface ChallengeCardProps {
  challenge: GroupChallengeResponse;
  // 내가 방장인가 — 롱프레스 삭제 진입점을 여는 조건.
  isOwner: boolean;
  // 내 userId — 진행 리스트에서 내 행을 맨 위로 올리고 강조하는 데만 쓴다.
  // 카드를 순수 표현 컴포넌트로 두려고 Context 대신 부모(GroupRoomScreen)가 내려준다.
  myUserId?: string | null;
  // 삭제 확인까지 끝난 뒤 호출 — 부모(GroupRoomScreen)가 API를 부르고 재조회한다.
  onDelete: (challengeId: string) => void;
  // 내기 시트 진입 — 시트 상태·API·재조회는 전부 부모가 쥔다(카드는 표현만).
  // 미전달이면 내기 영역 자체를 그리지 않는다 — 눌러도 아무 일이 없는 버튼을 세우지 않기 위해서다.
  onOpenBet?: (mode: BetSheetMode) => void;
  // 내기 진입점 잠금 — 부모가 성공 직후 재조회하는 동안 켠다. 그 창에서 카드는 아직 '내기 이전'
  // 모습이라 다시 누르면 같은 내기를 또 열려 하고, 서버가 BET_ALREADY_EXISTS로 튕긴다(3차 리뷰 F6).
  // 영역 자체는 그대로 둔다 — 사라졌다 나타나면 방금 한 일이 취소된 것처럼 보인다.
  betLocked?: boolean;
}

export default function ChallengeCard({
  challenge,
  isOwner,
  myUserId,
  onDelete,
  onOpenBet,
  betLocked,
}: ChallengeCardProps) {
  // 내기 취소(개설자 단독·OPEN)의 API·잔액 갱신을 카드가 직접 쥔다 — 시트(BetSheet)는 참가자
  // 상태에선 부모(GroupRoomScreen)의 stale 검사가 즉시 닫아 버려 진입 자체가 불가능하고,
  // 부모는 A3 전유라 이 배치에서 콜백을 늘릴 수 없다(README §파일 소유권). groupId도 같은 이유로
  // prop이 아니라 groupApi의 조회 캐시(challengeGroupId)에서 역참조한다.
  const { refresh: refreshCoins } = useCoins();
  const [cancelBusy, setCancelBusy] = useState(false);
  // 취소 성공의 낙관 반영 — 부모 재조회를 트리거할 콜백이 없어(위 주석) 다음 자연 재조회(포커스
  // 복귀·당겨서 새로고침)까지는 카드가 스스로 '취소됨'을 그린다. betId를 쥐므로 재조회가 늦게
  // 도착해 같은(이미 취소된) 내기를 다시 내려줘도 표시가 되돌아가지 않는다.
  const [canceledBetId, setCanceledBetId] = useState<string | null>(null);
  const cancelLock = useRef(false);

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
  const betKnown = challenge.bet !== undefined;
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
  // 참가 진입점 잠금 — FOCUS는 서버가 준 bet.myAchievedNow(이미 달성), SCREEN_TIME은 내 진행
  // 행의 확정 패배다. 스크린타임의 myAchievedNow는 표시용 잠정값이라 잠금에 쓰지 않는다(DTO 주석).
  const joinBlockedNow = isScreenTime ? myBlockedNow : bet?.myAchievedNow === true;
  // 서버가 participants를 빠뜨려도 카드가 죽지 않게 — 인원 수는 표시용일 뿐이다.
  const betMembers = bet?.participants?.length ?? 0;
  // 내가 방금 취소한 내기인가 — 낙관 반영(위 state 주석).
  const betCanceledByMe = bet !== null && bet.betId === canceledBetId;
  // 취소 가능 조건(계약 §2) — 내가 개설자 && 참가자가 나(개설자) 1명뿐 && OPEN.
  // creatorUserId가 없으면(구서버) 개설자를 알 수 없으므로 진입점을 그리지 않는다 —
  // 눌러 봐야 404/403으로 끝나는 버튼을 세우지 않는다(betKnown과 같은 원칙).
  const cancelable =
    bet !== null &&
    !betCanceledByMe &&
    bet.status === 'OPEN' &&
    bet.myJoined &&
    bet.creatorUserId !== undefined &&
    !!myUserId &&
    bet.creatorUserId === myUserId &&
    betMembers === 1;

  // 취소 실행 — 검증은 서버가 정본이다(레이스로 조건이 깨졌으면 에러 코드로 돌아온다).
  async function doCancelBet(betId: string, stake: number, participantsCount: number) {
    // 같은 틱 연타 방지 — state(cancelBusy)는 리렌더 뒤에야 보인다(ComposeSheet.submitLock 관행).
    if (cancelLock.current) return;
    cancelLock.current = true;
    setCancelBusy(true);
    const groupId = challengeGroupId(challenge.id);
    try {
      if (groupId === null) throw new Error('unknown groupId'); // 캐시 미적중 — 공통 문구로.
      await cancelBet(groupId, betId);
      // 성공 시에만 발행(내기 계측 공통 규칙) — 환불 반영은 서버가 정본이라 잔액을 다시 받는다.
      logGroupBetCanceled({ stake, participants_count: participantsCount });
      refreshCoins();
      setCanceledBetId(betId);
    } catch (e) {
      switch (groupErrorCode(e)) {
        // 세 코드 모두 이 카드 상태로는 재시도해도 같은 결과다 — 사실만 알리고, 화면 정리는
        // 다음 자연 재조회에 맡긴다(취소 버튼은 조건이 깨진 최신 응답이 오면 스스로 사라진다).
        case BET_CANCEL_FORBIDDEN:
          Alert.alert('취소할 수 없어요', '내기를 연 사람만 취소할 수 있어요.');
          break;
        case BET_CANCEL_HAS_OTHERS:
          Alert.alert('취소할 수 없어요', '다른 참가자가 있어 취소할 수 없어요.');
          break;
        case BET_NOT_OPEN:
          Alert.alert('취소할 수 없어요', '이미 정산됐거나 닫힌 내기예요.');
          break;
        default:
          Alert.alert('내기를 취소하지 못했어요', '잠시 후 다시 시도해주세요.');
      }
    } finally {
      cancelLock.current = false;
      setCancelBusy(false);
    }
  }

  // 확인 한 겹 — 돈이 되돌아오는 동작이지만 내기 자체가 사라지므로 삭제와 같은 규격을 쓴다.
  function confirmCancelBet() {
    if (!cancelable || bet === null) return;
    Alert.alert('내기 취소', `참가비 ${bet.stake}코인을 돌려받고 내기를 닫을까요?`, [
      { text: '아니요', style: 'cancel' },
      {
        text: '취소하기',
        style: 'destructive',
        onPress: () => doCancelBet(bet.betId, bet.stake, betMembers),
      },
    ]);
  }
  const lastBet = challenge.lastSettledBet ?? null;
  const lastResults = lastBet?.results ?? [];
  // achieved는 3상이다(계약 §3) — null(미판정)을 미달성으로 세면 달성 인원이 과소 집계된다.
  const lastAchieved = lastResults.filter((r) => r.achieved === true).length;

  // 지난 내기 결과 상세 — 카드 안에 인별 표를 펼치면 오늘 진행 리스트와 뒤엉킨다.
  // payout은 '받은 금액'이라 그대로 쓰면 판돈을 낸 사실이 지워진다 → 손익(payout - stake)으로 적는다.
  function showLastBet() {
    if (!lastBet) return;
    const lines = lastResults.map((r) => {
      // 미판정(정산 전·부분 실패) — 0으로 뭉개면 '판돈을 잃었다'로 읽힌다(진행 리스트 '—'와 같은 규칙).
      if (r.payout === null || r.achieved === null) return `${r.nickname} · 미판정`;
      const delta = r.payout - lastBet.stake;
      return `${r.nickname} · ${r.achieved ? '달성' : '미달성'} · ${delta > 0 ? '+' : ''}${delta}`;
    });
    // 승자 0명의 결말이 상태로 갈린다 — 구 룰(V19 이전)은 전원 환불(REFUNDED), 현 룰은 전액
    // 몰수(FORFEITED, 계약 확정 정책). '0명 달성 · 전원 미달성'만 보면 어느 쪽인지 알 수 없어
    // 첫 줄에 못 박는다(F8). CANCELED는 서버가 lastSettledBet에서 걸러 준다 — 모르는 상태는
    // 머리글 없이 인별 줄만 그대로 그린다(else 강하).
    const head =
      lastBet.status === 'REFUNDED'
        ? ['달성한 사람이 없어 전원 환불됐어요']
        : lastBet.status === 'FORFEITED'
          ? ['아무도 달성하지 못해 참가비가 소멸됐어요']
          : ([] as string[]);
    Alert.alert(
      `지난 내기 (${monthDay(lastBet.betDate)})`,
      [...head, `참가비 ${lastBet.stake} · 적립금 ${lastBet.pot}`, ...lines].join('\n'),
    );
  }

  // 확인 Alert 형식은 앱 관행대로 (동작명, 질문) — 대상에 인용부호를 쓰지 않는다.
  function confirmDelete() {
    if (!isOwner) return;
    Alert.alert('챌린지 삭제', '이 챌린지를 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => onDelete(challenge.id) },
    ]);
  }

  return (
    <TouchableOpacity
      style={s.card}
      // 탭에는 아무 동작이 없다 — 방장에게만 눌림 피드백을 주면 뭔가 열릴 것처럼 보인다(false affordance).
      activeOpacity={1}
      onLongPress={confirmDelete}
      // 공지 카드와 같은 임계값 — 같은 화면 안에서 같은 제스처가 다른 시간을 요구하면 안 된다.
      delayLongPress={300}
      // 방장이 아니면 롱프레스가 아무것도 하지 않으므로 접근성 트리에서도 버튼으로 보이지 않게 한다.
      accessibilityRole={isOwner ? 'button' : undefined}
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
      </View>

      {/* SCREEN_TIME 뜻 한 줄 — 창(TIME_WINDOW) 카드는 라벨이 이미 시간대·목표를 말하므로
          '오늘 …' 문장 대신 측정 한계 고지(계약 필수 문구)를 세운다. */}
      {isScreenTime && !isWindow && <Text style={s.caption}>{SCREEN_TIME_CAPTION}</Text>}
      {isScreenTime && isWindow && <Text style={s.caption}>{WINDOW_MEASURE_CAPTION}</Text>}
      {!challenge.canParticipate && <Text style={s.warn}>{NO_PERMISSION_CAPTION}</Text>}

      {rows === null && <Text style={s.caption}>{NO_PROGRESS_CAPTION}</Text>}

      {!!rows && rows.length > 0 && (
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

      {hasUnmeasured && <Text style={s.caption}>{UNMEASURED_CAPTION}</Text>}

      {/* ── 내기 영역(3차 §1) — 진행 리스트 아래, 방장 힌트 위 ──
          끝난 챌린지에 내기가 하나도 없으면 영역 자체를 두지 않는다 — 열 수 없는 자리에
          구분선만 남기면 무엇이 빠졌는지 알 수 없는 빈칸이 된다. */}
      {betSupported && (bet !== null || betOpenable) && (
        <View style={s.betArea}>
          {betCanceledByMe ? (
            // ⓪ 방금 내가 취소했다(낙관 반영) — 영역을 비우면 방금 한 일이 사라진 것처럼 보인다.
            //    다음 자연 재조회가 서버 상태(내기 없음)로 갈아 끼운다.
            <Text style={s.caption}>{BET_CANCELED_CAPTION}</Text>
          ) : bet === null ? (
            // ① 아직 내기가 없다 — 아웃라인 소형 버튼. 카드 본체(진행 리스트)보다 약하게 둔다.
            //    이미 확정된 사람(FOCUS 달성·SCREEN_TIME 초과)은 개설도 서버가 거절하므로
            //    (BET_ALREADY_ACHIEVED · BET_ALREADY_FAILED) 미리 잠그고 사유를 적는다.
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
          ) : bet.myJoined ? (
            // ③ 내가 참여 중 — 참가비·적립금·인원. '참여 중' 칩은 아직 열려 있는 내기에만 붙인다
            //    (정산이 끝난 내기에 '참여 중'을 달면 지금도 진행 중인 것으로 읽힌다).
            //    내가 개설자이고 아직 나 혼자인 OPEN 내기에만 취소 진입점을 붙인다(계약 §2).
            <View style={s.betRow}>
              <Text style={s.betText}>
                🪙 참가비 {bet.stake} · 적립금 {bet.pot} · {betMembers}명 참여
              </Text>
              {bet.status === 'OPEN' && <Text style={s.betJoinedTag}>참여 중</Text>}
              {cancelable && (
                <TouchableOpacity
                  style={[s.betCancelBtn, cancelBusy && s.betCancelBtnOff]}
                  activeOpacity={0.8}
                  disabled={cancelBusy}
                  onPress={confirmCancelBet}
                  accessibilityRole="button"
                  accessibilityLabel="내기 취소"
                  testID={`group.bet.cancel.${challenge.id}`}
                >
                  <Text style={s.betCancelText}>취소</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : bet.status === 'OPEN' && betOpenable ? (
            // ② 열려 있는데 나는 미참가 — 행 전체가 참가 진입점.
            //    이미 확정된 사람은 서버가 거절하므로(FOCUS는 BET_ALREADY_ACHIEVED,
            //    SCREEN_TIME은 BET_ALREADY_FAILED) 미리 잠근다.
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
                  🪙 참가비 {bet.stake} · {betMembers}명 참여 중 — 참가하기
                </Text>
              </TouchableOpacity>
              {joinBlockedNow && <Text style={s.caption}>{blockedCaption}</Text>}
            </>
          ) : (
            // 진입점을 열 수 없는 조합(마감·정산됐는데 나는 미참가 / 끝난 챌린지에 열린 내기가
            // 남아 있음) — 상태만 그대로 적고 누를 자리는 두지 않는다.
            <View style={s.betRow}>
              <Text style={[s.betText, s.betTextOff]}>
                🪙 참가비 {bet.stake} · 적립금 {bet.pot} · {betMembers}명 참여
              </Text>
            </View>
          )}
        </View>
      )}

      {/* 지난 내기 1줄 — 탭하면 인별 결과 Alert(§0-4). 결과 전용 화면은 만들지 않는다. */}
      {betSupported && lastBet !== null && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={showLastBet}
          hitSlop={8}
          accessibilityRole="button"
          testID={`group.bet.last.${challenge.id}`}
        >
          <Text style={s.betLastCaption}>
            지난 내기({monthDay(lastBet.betDate)}): {lastResults.length}명 중 {lastAchieved}명 달성
          </Text>
        </TouchableOpacity>
      )}

      {isOwner && <Text style={s.hint}>{DELETE_HINT_CAPTION}</Text>}
    </TouchableOpacity>
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
  head: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
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
    height: 32,
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
  // 내기 취소 — 소형 아웃라인. 돈이 되돌아오는 파괴 동작이라 danger 잉크로 구분한다.
  betCancelBtn: {
    height: 26,
    paddingHorizontal: T.space.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  betCancelBtnOff: { opacity: 0.5 },
  betCancelText: { ...T.text.caption, color: T.dangerInk, fontWeight: '600' },
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

  // 방장 전용 삭제 힌트 — 카드 하단 한 줄. 캡션보다 더 옅게 둬 내용과 섞이지 않게 한다.
  hint: { ...T.text.caption, fontWeight: '500', color: T.inkFaint },
});
