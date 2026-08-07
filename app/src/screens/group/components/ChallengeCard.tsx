import { useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import {
  BET_CANCEL_FORBIDDEN,
  BET_CANCEL_HAS_OTHERS,
  BET_LEAVE_CLOSED,
  BET_NOT_JOINED,
  BET_NOT_OPEN,
  cancelBet,
  challengeGroupId,
  groupErrorCode,
  leaveBet,
} from '@/services/groupApi';
import { logGroupBetCanceled } from '@/services/analyticsEvents';
import { useCoins } from '@/store/CoinContext';
import { todayStr } from '@/utils/localDate';
import { nowSecondsInZone, timeStrToSeconds } from '@/utils/challengeTime';
import type { ChallengeMemberProgress, GroupChallengeResponse } from '@/types/dto/group';
import { categoryLabel, missionLabel } from './challengeLabel';
import {
  UNMEASURED,
  progressFraction,
  progressFractionA11y,
  unmeasuredA11y,
} from './progressFormat';
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
const BET_LEFT_CAPTION = '내기에서 빠졌어요. 참가비는 잔액으로 돌아왔어요';
// 취소(당일 단독 개설자 carve-out) 직후의 자리 표시 — 누른 버튼('취소')과 같은 동사로 말한다.
const BET_CANCELED_CAPTION = '내기를 취소했어요. 참가비는 잔액으로 돌아왔어요';
// 휴면 챌린지(GROMO-1201) — OPEN 내기가 없고 과거 내기 이력만 남았다. 서버는 마지막 참가자가
// 철회해도 챌린지를 지우지 않고 남겨 두므로(백엔드 테스트가 잠근다) 카드가 사유를 한 줄로 말한다.
// 배지 문구 '휴면'은 계약 §2 고정 — '비활성'은 INACTIVE 노출 대비 예약어라 쓰지 않는다.
const DORMANT_CAPTION = '참가자가 없어요';
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
  // 카드가 서버 상태를 바꾼 직후(철회·취소 성공) 호출 — 부모가 챌린지 목록을 재조회한다.
  // 마지막 참가자가 철회해도 서버는 내기만 CANCELED로 닫고 챌린지는 남긴다(GROMO-1201 휴면) —
  // 재조회 없이는 닫힌 내기·휴면 표시가 다음 자연 재조회(포커스 복귀·당겨서 새로고침)까지
  // 낡은 모습으로 남는다.
  // ⚠️ 미전달이면 낙관 반영만으로 버틴다 — 다음 자연 재조회가 도착하면 그 응답이 낙관을 덮는다
  //    (아래 seenChallengeRef). 늦게 도착해도 표시가 어긋나지 않는다.
  onBetChanged?: () => void;
}

export default function ChallengeCard({
  challenge,
  isOwner,
  myUserId,
  onDelete,
  onOpenBet,
  betLocked,
  onBetChanged,
}: ChallengeCardProps) {
  // 내기 참가 철회의 API·잔액 갱신을 카드가 직접 쥔다 — 시트(BetSheet)는 참가자
  // 상태에선 부모(GroupRoomScreen)의 stale 검사가 즉시 닫아 버려 진입 자체가 불가능하고,
  // 부모는 다른 워크스트림이 동시에 만지는 파일이라 이 배치에서도 배선을 늘리지 않았다
  // (재조회는 선택 콜백 onBetChanged로만 열어 둔다). groupId도 같은 이유로
  // prop이 아니라 groupApi의 조회 캐시(challengeGroupId)에서 역참조한다.
  const { refresh: refreshCoins } = useCoins();
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
  // 지난 내기 결과 시트(GROMO-1099) — 데이터는 challenge.lastSettledBet 그대로, 열림만 카드가 쥔다.
  const [lastBetOpen, setLastBetOpen] = useState(false);

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
  // 내기 기준일 — 'YYYY-MM-DD'는 사전순이 곧 시간순이다. 철회의 '시작 전' 판정·'내일 시작' 배지·
  // 미래 내기 잠금 해제가 같이 쓴다. 서버가 오늘 내기가 없으면 내일 내기를 폴백으로 내려줄 수
  // 있고(계약 §3 응답 보수, W2), bet.date가 없으면(구서버) 조회일(오늘) 내기로 간주한다(DTO 주석).
  const betDate = bet?.date ?? todayStr();
  const isFutureBet = betDate > todayStr();
  // 참가 진입점 잠금 — FOCUS는 서버가 준 bet.myAchievedNow(이미 달성), SCREEN_TIME은 내 진행
  // 행의 확정 패배다. 스크린타임의 myAchievedNow는 표시용 잠정값이라 잠금에 쓰지 않는다(DTO 주석).
  // ⚠️ 미래(내일) 내기는 오늘 진행률 스냅샷으로 잠그지 않는다(#473 리뷰) — 내일의 집중·사용량은
  //    미지수라 오늘 '이미 달성/초과'는 차단 근거가 못 된다. 서버도 폴백 내기의
  //    myAchievedNow=false를 보장하지만 구서버·경합 대비 앱에서도 방어적으로 끊는다.
  const joinBlockedNow =
    !isFutureBet && (isScreenTime ? myBlockedNow : bet?.myAchievedNow === true);
  // 서버가 participants를 빠뜨려도 카드가 죽지 않게 — 인원 수는 표시용일 뿐이다.
  const betMembers = bet?.participants?.length ?? 0;

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
  //                 (betDate·todayStr의 날짜축이 기기 로컬인 이슈는 후속 — 여기선 축만 맞춘다)
  //   DURATION   → 내기 날짜가 내일 이후일 때만(당일은 하루 집계가 이미 진행 중이라 불가)
  // 판정이 어긋난 레이스는 서버가 정본으로 끝낸다(BET_LEAVE_CLOSED로 돌아온다).
  // 경계는 서버와 같은 strict `<`다(서버 !isBefore와 대우) — 창 시작 정각은 이미 시작이다.
  const isPastBet = betDate < todayStr();
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
        // 다음 자연 재조회에 맡긴다(철회 버튼은 조건이 깨진 최신 응답이 오면 스스로 사라진다).
        case BET_LEAVE_CLOSED:
          Alert.alert('철회할 수 없어요', '내기가 시작된 뒤에는 뺄 수 없어요.');
          break;
        case BET_NOT_JOINED:
          Alert.alert('철회할 수 없어요', '참가 중인 내기가 아니에요. 화면을 새로고침해 주세요.');
          break;
        case BET_NOT_OPEN:
          Alert.alert('철회할 수 없어요', '이미 정산됐거나 닫힌 내기예요.');
          break;
        default:
          Alert.alert('내기에서 빠지지 못했어요', '잠시 후 다시 시도해주세요.');
      }
    } finally {
      leaveLock.current = false;
      setLeaveBusy(false);
    }
  }

  // 확인 한 겹 — 돈이 되돌아오는 동작이라도 참가가 사라지므로 삭제와 같은 규격을 쓴다.
  function confirmLeaveBet() {
    if (!leavable || bet === null) return;
    Alert.alert('참가 철회', `참가비 ${bet.stake}코인을 돌려받고 내기에서 빠질까요?`, [
      { text: '아니요', style: 'cancel' },
      {
        text: '철회하기',
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
        // 재시도해도 같은 결과다 — 사실만 알리고 화면 정리는 다음 자연 재조회에 맡긴다(철회와 동일).
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
      leaveLock.current = false;
      setLeaveBusy(false);
    }
  }

  // 확인 한 겹 — 옛 취소 버튼의 문구 관례 그대로(내기 자체가 닫히므로 '닫을까요'로 묻는다).
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

  // 확인 Alert 형식은 앱 관행대로 (동작명, 질문) — 대상에 인용부호를 쓰지 않는다.
  function confirmDelete() {
    if (!isOwner) return;
    Alert.alert('챌린지 삭제', '이 챌린지를 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => onDelete(challenge.id) },
    ]);
  }

  return (
    // 카드 자체는 더 이상 아무 제스처도 받지 않는다(GROMO-1101 — 롱프레스 삭제 제거).
    // 눌리는 자리는 전부 안쪽의 명시적 버튼이다.
    <View style={s.card} testID={`group.challenge.card.${challenge.id}`}>
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

      {/* ── 내기 영역(3차 §1) — 진행 리스트 아래, 카드 하단 ──
          끝난 챌린지에 내기가 하나도 없으면 영역 자체를 두지 않는다 — 열 수 없는 자리에
          구분선만 남기면 무엇이 빠졌는지 알 수 없는 빈칸이 된다. */}
      {betSupported && (bet !== null || betOpenable) && (
        <View style={s.betArea}>
          {leftByMe && !rejoinable && bet !== null ? (
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
                    🪙 참가비 {bet.stake} · 적립금 {bet.pot - bet.stake} · {betMembers - 1}명 참여
                  </Text>
                  {isFutureBet && <Text style={s.betTomorrowTag}>내일 시작</Text>}
                </View>
              )}
              <Text style={s.caption}>
                {closedBet?.kind === 'cancel' ? BET_CANCELED_CAPTION : BET_LEFT_CAPTION}
              </Text>
            </>
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
          ) : bet.myJoined && !rejoinable ? (
            // ③ 내가 참여 중 — 참가비·적립금·인원. '참여 중' 칩은 아직 열려 있는 내기에만 붙인다
            //    (정산이 끝난 내기에 '참여 중'을 달면 지금도 진행 중인 것으로 읽힌다).
            //    시작 전 OPEN 내기에는 참가 철회 진입점을 붙인다(계약 §4 — 개설자·단독 불문).
            //    방금 철회한 카드는 응답이 아직 myJoined=true라 rejoinable로 걸러 ②로 보낸다 —
            //    안 그러면 이미 빠진 내기에 '참여 중'과 철회 버튼이 다시 선다.
            <View style={s.betRow}>
              <Text style={s.betText}>
                🪙 참가비 {bet.stake} · 적립금 {bet.pot} · {betMembers}명 참여
              </Text>
              {/* '내일 시작' — 서버가 내일 내기를 폴백으로 내려줄 수 있다(계약 §3). 표기가 없으면
                  오늘 내기로 읽힌다. 상태('참여 중')가 아니라 시점 표기라 중립 칩으로 가른다. */}
              {isFutureBet && <Text style={s.betTomorrowTag}>내일 시작</Text>}
              {bet.status === 'OPEN' && <Text style={s.betJoinedTag}>참여 중</Text>}
              {leavable && (
                <TouchableOpacity
                  style={[s.betLeaveBtn, leaveBusy && s.betLeaveBtnOff]}
                  activeOpacity={0.8}
                  disabled={leaveBusy}
                  onPress={confirmLeaveBet}
                  accessibilityRole="button"
                  accessibilityLabel="내기 참가 철회"
                  testID={`group.bet.leave.${challenge.id}`}
                >
                  <Text style={s.betLeaveText}>철회</Text>
                </TouchableOpacity>
              )}
              {/* 당일 단독 개설자 carve-out — cancelable이 !leavable을 품어 철회와 배타다. */}
              {cancelable && (
                <TouchableOpacity
                  style={[s.betLeaveBtn, leaveBusy && s.betLeaveBtnOff]}
                  activeOpacity={0.8}
                  disabled={leaveBusy}
                  onPress={confirmCancelBet}
                  accessibilityRole="button"
                  accessibilityLabel="내기 취소"
                  testID={`group.bet.cancel.${challenge.id}`}
                >
                  <Text style={s.betLeaveText}>취소</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : bet.status === 'OPEN' && betOpenable ? (
            // ② 열려 있는데 나는 미참가 — 행 전체가 참가 진입점.
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
                  🪙 참가비 {bet.stake} · {joinMembers}명 참여 중 — 참가하기
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
                🪙 참가비 {bet.stake} · 적립금 {bet.pot} · {betMembers}명 참여
              </Text>
              {isFutureBet && <Text style={s.betTomorrowTag}>내일 시작</Text>}
            </View>
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
          onPress={() => setLastBetOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          testID={`group.bet.last.${challenge.id}`}
        >
          <Text style={s.betLastCaption}>
            지난 내기({monthDay(lastBet.betDate)}): {lastResults.length}명 중 {lastAchieved}명 달성
          </Text>
        </TouchableOpacity>
      )}

      {lastBetOpen && lastBet !== null && (
        <LastBetResultSheet
          lastBet={lastBet}
          myUserId={myUserId}
          // FOCUS 창의 5분 관용치 안내 판단용(GROMO-1207) — 결과 모달과 같은 조건.
          missionType={challenge.missionType}
          missionCategory={challenge.missionCategory}
          onClose={() => setLastBetOpen(false)}
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
  head: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
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
  // 참가 철회 — 소형 아웃라인. 돈이 되돌아와도 참가가 사라지는 파괴 동작이라 danger 잉크로 구분한다.
  betLeaveBtn: {
    height: 26,
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
