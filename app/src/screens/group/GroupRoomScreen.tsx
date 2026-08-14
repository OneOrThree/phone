import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { useOverlayAlert } from '@/store/useOverlayAlert';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
import { useUser } from '@/store/UserContext';
import { useCoins } from '@/store/CoinContext';
import {
  deleteChallenge,
  getAnnouncements,
  getChallenges,
  getGroupDetail,
  groupErrorCode,
} from '@/services/groupApi';
import { USER_NOT_FOUND } from '@/services/sessionErrors';
import { subscribeBetResultPush } from '@/services/betResultSignal';
import { logGroupInviteShared, logGroupRoomViewed } from '@/services/analyticsEvents';
import {
  OVERLAY_PRIORITY,
  useOverlaySlot,
  useOverlaySlotActions,
} from '@/store/OverlaySlotContext';
import { issueInviteLink } from '@/services/inviteLinkApi';
import {
  consumeCardInteraction,
  invalidateCardInteraction,
  normalizeFocusEntrySource,
  ROOM_ATTRIBUTION_TTL_MS,
  type FocusEntrySource,
} from '@/services/cardInteraction';
import { todayStrKst } from '@/utils/localDate';
import type {
  GroupAnnouncementResponse,
  GroupChallengeResponse,
  GroupDetailMemberResponse,
  GroupDetailResponse,
  GroupSummaryResponse,
} from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';
import { buildInviteShareMessage } from './inviteShare';
import { fmtNoticeDate } from './noticeDate';
import { settledSignatureOf } from './lastSettledView';
import {
  getChallengeResultGate,
  requestChallengeResultRefresh,
  subscribeChallengeResultGate,
} from './challengeResultGate';
import BetSheet from './components/BetSheet';
import ChallengeCard, { type BetSheetMode } from './components/ChallengeCard';
import ChallengeComposeSheet from './components/ChallengeComposeSheet';
import MemberTile from './components/MemberTile';
import { GroupRoomBottomBar, GROUP_BOTTOM_BAR_SPACE } from './components/GroupRoomBottomBar';
import { resolveGroupRoomNotFound } from './groupRoomNotFound';

// 그룹방 — 명세 docs/app/group-plan.md §6-4.
//
// 형태: 탭 셸 없는 단일 ScrollView. 라우트 진입 전용이다 — 목록(GroupScreen)에서 그룹을 고르면
//      GroupRoom 라우트로 push 되고 GroupRoomRouteScreen이 이 컴포넌트를 감싼다
//      (A-9: 소속 수와 무관하게 목록이 기본 화면, 1건 내장 렌더는 폐지).
// 레이아웃: 헤더(이름 · 비공개 자물쇠 · n/m · ⋯) → 공지(최근 3건 + 모두보기)
//          → 챌린지(2차 §3-2) → 멤버 3열 그리드(MemberTile + '＋ 초대' 타일)
//          (⋯ 는 팝업 메뉴 없이 그룹 설정 화면으로 직행한다.)
//
// ❌ detail.code · codeExpiresAt은 읽지 않는다 — 코드 개념 폐기(§3-1-5).

// 멤버 그리드 열 수
const COLS = 3;
// 공지 섹션에 노출하는 최근 공지 수(나머지는 '모두보기')
const NOTICE_PREVIEW = 3;

// ── 최초 로딩 자리표시자 치수 ── (GROMO-1381)
// 도착할 화면과 같은 자리를 잡아야 데이터가 왔을 때 레이아웃이 튀지 않는다. 값은 전부 아래
// StyleSheet의 실제 규격에서 계산한 것이라, 규격을 바꾸면 이 상수도 같이 고쳐야 한다.
// 섹션 라벨 한 줄(T.text.label 15pt)
const SK_LABEL_H = 18;
// ⚠️ 공지 카드 자리표시자 상수는 두지 않는다 — 한 장의 높이는 상수로 확정되지만 **몇 장이
//    올지**를 로딩 시점에 알 방법이 없다. 자세한 근거는 아래 skeletonBody 주석.
// 멤버 타일 한 칸: paddingVertical 12×2 + border 1×2 + 아바타 44 + gap 4×3 + 텍스트 3줄(16×3)
const SK_TILE_H = 130;

// 멤버 그리드 한 칸 — 멤버 타일 또는 마지막의 '＋ 초대' 타일.
type GridCell =
  | { kind: 'member'; member: GroupDetailMemberResponse; rank: number }
  | { kind: 'invite' };

// 리스트를 n개씩 잘라 행 배열로 만든다(3열 그리드 — flexWrap 대신 행 단위로 그려
// 마지막 행에도 같은 폭이 유지되게 한다).
function chunk<Item>(items: Item[], size: number): Item[][] {
  const rows: Item[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

// 열어 둔 내기 시트가 **최신 챌린지에서도 성립하는가**. 성립하지 않으면 알림 문구를 돌려준다
// (닫는 판단은 호출부). betId만 비교하면 같은 내기가 마감되거나(SETTLED·REFUNDED) 다른 기기에서
// 내가 참가한 전이를 놓쳐, 시트는 계속 돈을 쓰는 CTA를 세운 채 BET_CLOSED·BET_ALREADY_JOINED를
// 받는다. 개설 시트가 열린 사이 남이 내기를 연 경우(BET_ALREADY_EXISTS)도 같다(코덱스 리뷰).
// ⚠️ myAchievedNow 전이는 여기서 닫지 않는다 — 참가는 막아야 하지만 팟·참가자를 보고 있는
//    시트를 통째로 걷을 이유는 없어, 시트가 CTA만 잠그고 사유를 적는다(BetSheet.achievedBlocked).
function staleBetSheetAlert(
  sheet: { mode: BetSheetMode; betId: string | null },
  challenge: GroupChallengeResponse,
): [string, string] | null {
  const live = challenge.bet ?? null;
  // 개설 시트의 진입 조건은 세 가지다(ChallengeCard의 betKnown · betOpenable · bet === null) —
  // 하나라도 최신 챌린지에서 깨지면 닫는다.
  if (sheet.mode === 'create') {
    // 이 서버가 내기를 아는가 — 필드가 **아예 없는** 응답은 '내기가 없다'가 아니라 구버전
    // 서버다(ChallengeCard.betKnown과 같은 판정). 순차 배포 중 신버전 응답으로 시트를 연 뒤
    // 구버전에 붙으면 undefined가 null로 뭉개져 시트가 그대로 남고, 없는 엔드포인트로
    // 개설 요청만 나간다 — 카드는 이미 진입점을 숨긴 상태다(코덱스 리뷰).
    if (challenge.bet === undefined) {
      return ['내기를 열 수 없어요', '지금은 내기를 이용할 수 없어요. 잠시 후 다시 시도해 주세요.'];
    }
    // 끝난 챌린지에는 새로 돈을 걸 수 없다 — 카드가 진입점을 막는 기준과 같다.
    // 서버 개설 경로는 상태를 보지 않아 그대로 열리므로, 여기서 막지 않으면 앱이 종료로
    // 취급하는 챌린지에 판돈만 빠져나간 내기가 생긴다.
    if (challenge.status !== 'ACTIVE') {
      return ['끝난 챌린지예요', '종료된 챌린지에는 내기를 열 수 없어요.'];
    }
    if (live === null) return null;
    // 서버는 오늘 내기가 없으면 **내일** OPEN 내기를 폴백으로 내려줄 수 있다(계약 §3 응답 보수) —
    // 그때 '오늘'이라고 말하면 거짓이다. bet.date와 KST 오늘을 비교해 문구를 가른다(GROMO-1219,
    // BetSheet.sentTomorrow와 같은 결). date가 없으면(구서버) 조회일(오늘) 내기로 간주한다(DTO 주석).
    const liveTomorrow = (live.date ?? todayStrKst()) > todayStrKst();
    return [
      liveTomorrow ? '이미 내일 내기가 열려 있어요' : '이미 오늘 내기가 열려 있어요',
      '최신 상태예요. 참가하려면 다시 열어 주세요.',
    ];
  }
  // 참가 모드에서는 구버전 응답(undefined)도 이 검사에 함께 걸린다 — live가 null로 뭉개지면서
  // '내기가 바뀌었어요'로 닫히기 때문에 따로 분기를 두지 않는다.
  if (live === null || live.betId !== sheet.betId) {
    return ['내기가 바뀌었어요', '최신 내기로 다시 열어 주세요.'];
  }
  // 참가 진입점도 카드에서 betOpenable을 함께 요구한다(bet.status === 'OPEN' && betOpenable) —
  // 내기만 OPEN인 채 챌린지가 INACTIVE로 바뀌면 카드의 참가 행은 사라지는데 열린 시트만 판돈
  // 차감 요청을 보낼 수 있다. 개설 쪽 상태 검사와 대칭으로 막는다(코덱스 리뷰).
  if (challenge.status !== 'ACTIVE') {
    return ['끝난 챌린지예요', '종료된 챌린지의 내기에는 참가할 수 없어요.'];
  }
  if (live.status !== 'OPEN') return ['마감된 내기예요', '이미 마감돼 참가할 수 없어요.'];
  if (live.myJoined) return ['이미 참가한 내기예요', '최신 상태로 새로고침했어요.'];
  return null;
}

// '내가 참가한 내기가 정산됐다'는 사건을 챌린지 목록에서 읽어낸다 — 정산은 서버(04:00 배치)가
// 하므로 앱이 알 수 있는 신호는 lastSettledBet이 새로 생기거나 다른 내기로 바뀌는 것뿐이다.
// 앱을 켜 둔 채 정산이 돌면 카드엔 결과가 뜨는데 전역 잔액은 정산 전 값으로 남아, 지급된 코인을
// 상점에서 쓰지 못한다(CoinContext.buyItem이 클라 잔액으로 먼저 막는다 — 코덱스 리뷰).
// 내 결과가 없는 정산은 잔액을 건드리지 않으므로 서명에 넣지 않는다(불필요한 재조회 방지).
// ⚠️ 서명에 **내 결과의 achieved·payout까지** 넣는다(코덱스 리뷰). 계약상 payout은 null일 수 있어
//    (부분 정산 실패) 같은 내기가 'payout 없음 → 있음'으로 두 번 도착할 수 있는데, 챌린지·날짜·
//    상태만 서명하면 두 응답이 같은 사건으로 뭉개져 지급이 확정된 순간을 놓친다 — 카드엔 지급액이
//    떠도 전역 잔액과 상점의 선행 검사는 정산 전 값에 머문다.
function settledBetSignature(challenges: GroupChallengeResponse[], userId: string | null): string {
  // 서명 산출은 lastSettledView가 단독으로 쥔다 — v2(lastSettledSession)·구서버(lastSettledBet)
  // 어느 쪽 응답에서도 같은 사건을 같은 글자로 만든다(#570 codex ①). v2 응답만 오는 서버에서
  // 이 함수가 구 필드만 보면 첫 정산 이후 잔액 재동기화가 영영 돌지 않는다.
  return challenges.map((c) => settledSignatureOf(c, userId)).join('|');
}

export interface GroupRoomScreenProps {
  groupId: string;
  entrySource?: FocusEntrySource;
  interactionId?: string;
  interactionAcceptedAt?: number;
  // ⚠️ 챌린지 종료 푸시가 지목한 챌린지(focusChallengeId)는 **이 화면의 관심사가 아니다**
  //    (GROMO-1576). 결과 모달의 소유자가 루트 호스트(ChallengeResultHost)로 옮겨 갔고,
  //    호스트가 GroupRoom 라우트 파라미터의 challengeId를 직접 읽는다. 라우트 파라미터
  //    자체는 그대로 남아 있다(navigation/types.ts).
  // 탭 진입점이 가진 요약(getMyGroups[0]) — 상세 응답 도착 전 헤더를 먼저 그리는 용도(선택).
  summary?: GroupSummaryResponse;
  // 환불 푸시(refund=1)로 열린 진입인가(GROMO-1579) — 멤버십 부재가 확정돼도 목록으로
  // 되돌리지 않고 환불 안내를 세운다. 자세한 근거는 아래 convergeMembershipAbsence 주석.
  refundNotice?: boolean;
  // 그룹 나가기 성공 시 호출 — 부모(GroupScreen)가 재조회해 빈 상태로 되돌린다.
  onLeft: () => void;
  // 라우트로 push된 경우에만 전달 — 헤더 좌측에 원형 백버튼을 세운다.
  // 루트 스택이 headerShown:false라 네이티브 헤더가 없고, 탭바도 없어
  // 미전달이면 목록으로 돌아갈 명시 경로가 0개가 된다(앱 관행: 스택 화면은 백버튼 자가 렌더).
  onBack?: () => void;
}

// 공유 시트가 떠 있는 동안 점유할 자리의 이름.
const SHARE_SLOT_ID = 'groupRoom.shareSheet';

export default function GroupRoomScreen({
  groupId,
  entrySource: rawEntrySource,
  interactionId: rawInteractionId,
  interactionAcceptedAt: rawInteractionAcceptedAt,
  summary,
  refundNotice,
  onLeft,
  onBack,
}: GroupRoomScreenProps) {
  // 네이티브 Alert는 RN Modal **위에** 뜬다 — 떠 있는 동안 결과 모달이 그 아래에서
  // 마운트되면 사용자는 못 봤는데 seen 마커와 ack이 찍힌다. 이 훅이 Alert 수명 동안
  // 조정자 slot을 점유해 그걸 막는다(store/useOverlayAlert 헤더).
  const showAlert = useOverlayAlert('groupRoom.alert');
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { userId } = useUser();
  // 잔액은 CoinContext가 정본이다 — 여기서는 '서버가 정산했다'를 감지했을 때만 다시 받는다.
  const { refresh: refreshCoins } = useCoins();
  const entrySource = normalizeFocusEntrySource(rawEntrySource);
  const interactionId = entrySource === 'group_card' ? rawInteractionId : undefined;
  const interactionAcceptedAt = entrySource === 'group_card' ? rawInteractionAcceptedAt : undefined;

  const [detail, setDetail] = useState<GroupDetailResponse | null>(null);
  // null = 아직 한 번도 못 받음. '공지 없음(빈 배열)'과 '공지 조회 실패'를 구분한다 —
  // 실패를 []로 뭉개면 이미 있는 공지가 사라진 자리에 '아직 공지가 없어요'가 떠서 같은 공지를 또 쓴다.
  const [notices, setNotices] = useState<GroupAnnouncementResponse[] | null>(null);
  // 공지와 같은 규격 — null = 아직 한 번도 못 받음. '챌린지 없음'과 '조회 실패'를 구분한다.
  const [challenges, setChallenges] = useState<GroupChallengeResponse[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [noticeError, setNoticeError] = useState(false);
  const [challengeError, setChallengeError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  // 내기 시트(3차) — 어떤 챌린지를 어떤 모드로 열었나. 내기 데이터는 challenges 응답에 이미
  // 실려 있으므로(계약 §2-3) 시트를 열려고 추가 조회를 하지 않는다.
  // ⚠️ challenge **객체를 쥐지 않는다**(3차 리뷰 F2) — 포커스·포그라운드 복귀가 돌린 load()가
  //    challenges를 통째로 갈아도 시트의 복사본은 열었을 때 값 그대로 남아, 낡은 팟·참가자를 보고
  //    돈을 걸게 된다. id만 쥐고 렌더 시점에 **살아 있는 배열에서** 파생한다.
  //    betId는 '열었을 때의 그 내기인가'를 보기 위한 것이다(자정을 넘겨 다른 날짜 내기로 갈리는 경우).
  const [betSheet, setBetSheet] = useState<{
    challengeId: string;
    mode: BetSheetMode;
    betId: string | null;
  } | null>(null);
  // 내기 성공 직후 재조회가 도는 동안 카드의 내기 진입점을 잠근다(F6) — 그 창의 카드는 아직
  // '내기 이전' 모습이라 다시 누르면 같은 내기를 또 열려 한다. 시트가 한 번에 하나뿐이라
  // 챌린지별 플래그 대신 화면 단위 하나로 둔다.
  const [betBusy, setBetBusy] = useState(false);
  // 챌린지 카드가 스스로 연 시트(지난 결과·다음 활성일·주간·삭제)가 떠 있는 카드들(GROMO-1578).
  // 카드는 이 시트들을 자기 state로 여닫으므로 부모가 알 방법이 콜백밖에 없다 — 넷 다
  // SheetShell asModal(RN 네이티브 Modal)이라 다른 전면 오버레이와 겹치면 딤이 포개지고
  // 표시 순서가 플랫폼 재량이 된다.
  // boolean 하나가 아니라 챌린지 id 집합인 이유: 카드가 여럿이라 한 카드가 닫을 때 다른 카드의
  // 시트까지 닫힌 것으로 뭉개면 안 된다.
  const [sheetOpenCardIds, setSheetOpenCardIds] = useState<string[]>([]);
  // 환불 푸시 착지에서 멤버십 부재가 확정된 상태(GROMO-1579) — 목록으로 튕기는 대신 안내를 세운다.
  const [refundBlocked, setRefundBlocked] = useState(false);

  // 요청 시퀀스 — 당겨서 새로고침 중 '다시 시도'를 누르거나 연타하면 reload()·onRefresh()가
  // 같은 load()를 각자 부른다. 늦게 도착한 이전 응답이 최신 응답을 덮지 않게 최신 것만 반영한다
  // (useFriends.ts의 requestSeqRef와 같은 패턴). 포커스 cleanup·언마운트에서도 올려 무효화한다.
  const requestSeqRef = useRef(0);
  // 화면이 포커스돼 있는가 — 포그라운드 복귀 시 재조회 여부 판정에 쓴다(탭 화면은 언마운트되지 않는다).
  const focusedRef = useRef(false);
  // 마지막으로 성공한 조회의 기준 날짜. 자정을 넘겨 복귀하면 '오늘 집중분'이 전날 값이라 강제 재조회한다.
  const loadedDateRef = useRef<string | null>(null);
  // 직전 조회에서 본 '내 정산 내기' 서명(settledBetSignature). null = 아직 한 번도 못 받음 —
  // 첫 조회는 비교 대상이 없어 재조회하지 않는다(마운트 시 CoinContext가 이미 잔액을 받는다).
  const settledSigRef = useRef<string | null>(null);
  // 그룹방 방문 결과의 view episode — 같은 route의 새로고침·비카드 source 갱신에는 재발행하지 않는다.
  // 같은 그룹이라도 새 카드 CTA ID라면 별도 episode이고, ID 소비는 전역 exact-once 가드가 맡는다.
  const roomViewedRef = useRef<{ groupId: string; interactionId?: string } | null>(null);
  // 탈퇴 감지(MEMBER_ONLY 또는 NOT_FOUND scope 재확인 완료) 시 이탈(onLeft)을 **결과 소비 뒤로**
  // 미루는 플래그(PR #566 리뷰 ② — 탈퇴자도 자기 정산 결과는 본다, N53·C8).
  //
  // ⚠️ 결과 큐는 이제 이 화면이 쥐고 있지 않다(GROMO-1576 — 루트 ChallengeResultHost). 그래서
  //    "지금 보여줄 결과가 있는가"는 호스트가 공표하는 신호(challengeResultGate)로만 안다.
  //    이 화면이 결과를 **다시 조회하지 않는** 이유: 같은 엔드포인트를 두 곳에서 부르면 두
  //    판정이 갈려, 호스트가 모달을 띄우는 사이 방이 "결과 0건"으로 판단해 스스로 내려간다.
  const pendingLeaveRef = useRef(false);
  // 구독을 신원 고정으로 유지하려고 onLeft를 ref에 담는다(가장 최근 콜백을 쓴다).
  const onLeftRef = useRef(onLeft);
  onLeftRef.current = onLeft;
  // 이탈은 **이 그룹에 대해 한 번뿐**이다. 이제 이탈을 부를 수 있는 입구가 둘이라
  // (직접 판정 · gate 구독) 같은 사건으로 두 번 부를 수 있는데, 프로덕션의 onLeft는
  // goBack이라 두 번 부르면 스택을 두 장 팝한다.
  const leftRef = useRef(false);
  const leaveRoom = useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;
    pendingLeaveRef.current = false;
    onLeftRef.current();
  }, []);

  // ── 이 화면이 띄우는 전면 오버레이를 조정자에 알린다(GROMO-1576) ──
  // 대상은 지금 이 화면 위에 **RN Modal로** 뜰 수 있는 것 전부다:
  //  · 이 화면이 쥔 것 — 챌린지 만들기(composeOpen) · 내기 개설/참가(betSheet)
  //  · 챌린지 카드가 스스로 쥔 것 — 지난 결과·다음 활성일·주간·삭제 시트(sheetOpenCardIds,
  //    GROMO-1578). 카드 state라 콜백(onCardSheetVisibilityChange) 없이는 부모가 알 수 없다.
  // 이 시트들은 **status를 보지 않고 그대로 렌더한다**(useOverlayBlocker) — 사용자가 방금 손으로
  // 연 것이라 뜨는 것이 옳고, 등록의 목적은 그 위에 결과 모달이 마운트되는 것을 막는 데 있다.
  // ⚠️ '⋯'는 모달이 아니다 — GroupSettings 라우트 push라 이 화면이 가려질 뿐 겹치지 않는다.
  //    초대 시트도 대상이 아니다: 그룹방이 별도 라우트가 된 뒤로는 목록(GroupScreen)이 소유한
  //    그 시트와 이 화면이 동시에 뜰 수 없다.
  //
  // ⚠️ 카드 시트 중 **await 뒤에 열리는 것**(주간 예약·삭제 프리플라이트)은 blocker 등록만으로
  //    부족하다. 여는 시점을 응답이 정하므로 그 사이 루트의 결과 모달이 slot을 얻어 노출까지
  //    갈 수 있고, 조정자는 보유자를 뺏지 않으니 그대로 마운트하면 두 Modal이 겹친다. 그러면
  //    결과 모달이 **사실상 안 보인 채** seen 마커와 ack이 나간다(둘 다 렌더 커밋 시점에
  //    찍힌다 — 사용자가 인지한 시점이 아니다). 그래서 그 시트들은 아래 requestCardSheetSlot로
  //    승인을 받고 연다. 동기로 열리는 시트는 종전대로 등록만 한다.

  // 지금 **실제로 떠 있는** 시트가 있는가. slot 보유 여부와 다르다 — slot은 이 화면 전체가
  // 공유하는 하나뿐이라, 그것이 granted라는 사실만으로는 "지금 새 시트를 하나 더 열어도
  // 된다"가 되지 않는다.
  // 공유 시트처럼 **명령형으로 여는** 네이티브 오버레이가 자리를 잡을 때 쓴다.
  const overlayActions = useOverlaySlotActions();
  const sheetOpen = betSheet !== null || composeOpen || sheetOpenCardIds.length > 0;

  const [sheetSlotRequested, setSheetSlotRequested] = useState(false);
  const sheetSlot = useOverlaySlot('groupRoom:sheet', {
    priority: OVERLAY_PRIORITY.sheet,
    active: sheetOpen || sheetSlotRequested,
  });

  // 승인을 기다리는 카드들 — **한 번에 한 요청만** 깨운다(아래 grantOneSheetWaiter).
  // ⚠️ 요청은 **카드 신원(challengeId)에 묶는다.** 카드가 사라진 뒤에도 resolver가 큐에 남으면,
  //    나중에 slot이 풀렸을 때 **언마운트된 카드**의 비동기 함수가 true를 받아 openSheet()로
  //    사라진 challengeId를 열림 집합에 넣는다. 그걸 false로 되돌릴 카드가 없으니
  //    `sheetOpen`과 overlay slot이 **영구히 잠긴다.**
  const sheetSlotWaitersRef = useRef<{ id: string; resolve: (granted: boolean) => void }[]>([]);
  const sheetSlotRef = useRef(sheetSlot);
  sheetSlotRef.current = sheetSlot;
  const sheetOpenRef = useRef(sheetOpen);
  sheetOpenRef.current = sheetOpen;
  // 승인은 했는데 아직 열림 보고가 오지 않은 카드 — 그 사이에 다음 요청을 승인하면 두 시트가
  // 함께 마운트된다. 그 카드가 열지 못하고 사라질 수도 있어 **신원으로** 들고 있는다.
  const sheetGrantInFlightRef = useRef<string | null>(null);

  // 대기열이 바뀔 때마다 올린다 — 대기열은 ref라, 아래 "요청 해제" 이펙트가 다시 돌 계기가
  // 필요하다.
  const [sheetWaiterRevision, setSheetWaiterRevision] = useState(0);
  const bumpSheetWaiters = useCallback(() => setSheetWaiterRevision((n) => n + 1), []);

  const settleSheetSlotWaiters = useCallback(
    (granted: boolean) => {
      const waiters = sheetSlotWaitersRef.current;
      if (waiters.length === 0) return;
      sheetSlotWaitersRef.current = [];
      waiters.forEach((waiter) => waiter.resolve(granted));
      bumpSheetWaiters();
    },
    [bumpSheetWaiters],
  );

  // 요청을 접은 카드(사라졌거나 스스로 포기했다)의 대기를 거절하고, 그 카드가 쥐고 있던
  // 승인 자리도 푼다.
  const cancelSheetWaitersFor = useCallback(
    (challengeId: string) => {
      const heldGrant = sheetGrantInFlightRef.current === challengeId;
      if (heldGrant) sheetGrantInFlightRef.current = null;
      const waiters = sheetSlotWaitersRef.current;
      const canceled = waiters.filter((waiter) => waiter.id === challengeId);
      if (canceled.length > 0) {
        sheetSlotWaitersRef.current = waiters.filter((waiter) => waiter.id !== challengeId);
        canceled.forEach((waiter) => waiter.resolve(false));
      }
      if (heldGrant || canceled.length > 0) bumpSheetWaiters();
    },
    [bumpSheetWaiters],
  );

  // ⚠️ **비어 버린 요청은 반드시 해제한다.** 취소가 waiter만 걷어내고 `sheetSlotRequested`를
  //    true로 남기면, 기존 보유자가 놓았을 때 **빈 `groupRoom:sheet` 등록이 slot을 영구 점유**해
  //    방을 나갈 때까지 결과 모달도 코치마크도 못 뜬다. 이번 라운드가 고치려던 것과 같은 증상이
  //    "빈 승인"에서 "빈 등록"으로 한 칸 옮겨간 것뿐이다.
  // 남은 조건이 하나도 없을 때만 내린다: 열린 시트 없음 · 대기 없음 · 진행 중 승인 없음.
  useEffect(() => {
    if (!sheetSlotRequested) return;
    if (sheetOpen) return;
    if (sheetSlotWaitersRef.current.length > 0) return;
    if (sheetGrantInFlightRef.current !== null) return;
    setSheetSlotRequested(false);
  }, [sheetSlotRequested, sheetOpen, sheetWaiterRevision]);

  // 승인 마무리 — **열림이 실제로 커밋된 뒤에만** 진행 중 승인을 푼다(위 onCardSheetVisibilityChange
  // 주석). 이 시점에는 `sheetOpen`도 이미 true라, 다음 요청은 그 시트가 닫힐 때까지 계속 막힌다.
  useEffect(() => {
    const holder = sheetGrantInFlightRef.current;
    if (holder === null) return;
    if (!sheetOpenCardIds.includes(holder)) return;
    sheetGrantInFlightRef.current = null;
    bumpSheetWaiters();
  }, [sheetOpenCardIds, bumpSheetWaiters]);

  // ⚠️ **한 요청씩 직렬화한다.** slot이 granted라는 이유로 모든 대기자를 한꺼번에 깨우면,
  //    서로 다른 카드의 프리플라이트가 겹치거나 이미 열린 시트가 있는 상태에서 늦은 응답이
  //    도착했을 때 RN Modal이 여럿 함께 마운트된다. 승인 조건은 셋이다:
  //    slot 보유 · **실제로 떠 있는 시트 없음** · 앞선 승인이 열림으로 마무리됨.
  const grantOneSheetWaiter = useCallback(() => {
    if (sheetGrantInFlightRef.current !== null) return;
    if (sheetOpenRef.current) return;
    if (sheetSlotRef.current !== 'granted') return;
    const next = sheetSlotWaitersRef.current.shift();
    if (next === undefined) return;
    sheetGrantInFlightRef.current = next.id;
    next.resolve(true);
    bumpSheetWaiters();
  }, [bumpSheetWaiters]);

  useEffect(() => {
    grantOneSheetWaiter();
  }, [sheetSlot, sheetOpen, grantOneSheetWaiter]);

  // 화면을 벗어나거나 언마운트되면 대기를 접는다 — 안 그러면 결과 모달이 닫히는 순간
  // **이미 떠난 화면의** 시트가 새 화면 위로 뜬다(시트는 RN Modal이라 라우트를 넘어 보인다).
  useEffect(
    () => () => {
      sheetGrantInFlightRef.current = null;
      settleSheetSlotWaiters(false);
    },
    [settleSheetSlotWaiters],
  );

  const requestCardSheetSlot = useCallback(
    (challengeId: string) => {
      setSheetSlotRequested(true);
      return new Promise<boolean>((resolve) => {
        sheetSlotWaitersRef.current.push({ id: challengeId, resolve });
        bumpSheetWaiters();
        // 지금 바로 가능한 경우를 위해 한 번 본다 — 이펙트를 기다리며 한 프레임 늦추지 않는다.
        grantOneSheetWaiter();
      });
    },
    [bumpSheetWaiters, grantOneSheetWaiter],
  );

  // 이 화면이 지금 그리고 있는 그룹. 이미 스택에 있는 'GroupRoom' 라우트로 다시 navigate 하면
  // (React Navigation이 params만 병합해) **같은 인스턴스를 재사용**해 groupId만 갈아 끼운다
  // (A 방을 보다 B 방 초대/딥링크로 같은 라우트에 재진입한 경우 등) — 그러면 A의 챌린지·시트가 남은 채
  // mutation만 B의 groupId로 나가 NOT_FOUND 같은 영구 실패가 되고, B 조회가 실패하면 A의
  // 화면이 그대로 유지된다(코덱스 리뷰).
  // 이펙트가 아니라 **렌더 중에** 되돌리는 이유: 이펙트는 커밋 뒤라 'A의 데이터 + B의 groupId'가
  // 한 프레임 실제로 그려지고, 그 프레임의 시트에서 누른 요청이 곧 이 버그다. React가 공식으로
  // 허용하는 '프롭이 바뀌면 렌더 중 상태 조정' 패턴이다(자식은 커밋되지 않고 즉시 다시 렌더된다).
  const renderedGroupIdRef = useRef(groupId);
  if (renderedGroupIdRef.current !== groupId) {
    renderedGroupIdRef.current = groupId;
    // 진행 중인 이전 그룹의 응답을 무효화한다 — 늦게 도착해 새 그룹의 화면을 덮지 않게.
    requestSeqRef.current++;
    loadedDateRef.current = null;
    // 새 그룹의 첫 서명은 비교 대상이 없다 — 이전 그룹의 서명과 비교하면 남의 정산으로 잔액을 다시 받는다.
    settledSigRef.current = null;
    pendingLeaveRef.current = false; // 이전 그룹의 이탈 유예도 함께 접는다(새 그룹 판단은 새로)
    leftRef.current = false; // 이탈 1회 래치도 그룹 단위다
    // 이전 그룹 카드들의 시트 열림도 함께 접는다 — 그 카드들은 곧 언마운트되며 false를
    // 보고하지만, 그 사이 대기하던 전면 오버레이가 이전 방의 열림 때문에 계속 막히면 안 된다.
    setSheetOpenCardIds([]);
    // ⚠️ **승인을 기다리던 시트 요청도 여기서 거절한다.** 그룹 전환은 언마운트가 아니다 —
    //    같은 인스턴스가 살아 있어서 blur·언마운트 정리가 걸리지 않는다. 그대로 두면 나중에
    //    slot이 풀렸을 때 **이미 언마운트된 A 카드**가 true를 받아 openSheet()로 A의 id를
    //    B 화면의 sheetOpenCardIds에 다시 넣고, 그것을 false로 되돌릴 카드가 없어
    //    **결과 오버레이가 영구히 차단**된다.
    sheetGrantInFlightRef.current = null;
    settleSheetSlotWaiters(false);
    setSheetSlotRequested(false);
    setRefundBlocked(false); // 환불 안내는 그 진입의 판단이다 — 새 그룹으로 옮기지 않는다
    setDetail(null);
    setNotices(null);
    setChallenges(null);
    setBetSheet(null);
    setBetBusy(false);
    setComposeOpen(false);
    setError(false);
    setNoticeError(false);
    setChallengeError(false);
    setLoading(true);
  }

  // 상세 + 공지 + 챌린지 병렬 조회. 세 요청의 실패를 **각각** 다룬다(allSettled) —
  // 상세 실패는 기존 방 데이터를 보존한 채 배너로, 공지·챌린지 실패는 각 섹션에서만 알린다.
  // date는 멤버 '오늘 집중분'과 챌린지 진행률의 기준일이라 여기서 직접 만들어 보관까지 한다(§3-1-1).
  // ⚠️ getChallenges는 date를 **넘길 때만** memberProgress가 실려 온다(2차 배관 결정 1) —
  //    진행 리스트가 이 섹션의 본체라 반드시 넘긴다.
  // 반환값: 이 호출이 아직 최신인가(늦게 끝난 요청이 로딩 플래그를 되돌리지 않게).
  const load = useCallback(async (): Promise<boolean> => {
    // 전환 **전** 렌더에서 캡처된 클로저가 늦게 실행되면(내기 onDone·챌린지 생성/삭제의 응답 후
    // 재조회) 이 groupId는 이전 그룹이다 — 그대로 진행하면 seq만 올려 새 그룹의 진행 중 조회를
    // 무효화하고 이전 그룹 데이터를 새 화면에 되씌운다. 시작조차 하지 않는다(코덱스 리뷰).
    if (renderedGroupIdRef.current !== groupId) return false;
    const seq = ++requestSeqRef.current;
    // 기준일은 서버 판정 축과 같은 KST다(GROMO-1219) — 진행률·내기·결과의 날짜 판정이 전부
    // 서버 KST 고정이라, 기기 로컬 날짜를 보내면 비KST 기기에서 하루 어긋난 조회가 된다.
    const date = todayStrKst();
    setError(false);
    // ⚠️ /me/challenge-results 는 **여기서 부르지 않는다**(GROMO-1576). 결과 큐의 소유자는 루트
    //    ChallengeResultHost 하나이고, 이 화면은 그 판정(challengeResultGate)만 읽는다. 같은
    //    엔드포인트를 두 곳에서 부르면 두 판정이 갈려, 호스트가 모달을 띄우는 사이 이 방이
    //    "결과 0건"으로 판단해 스스로 내려가는 경합이 생긴다.
    const [detailResult, noticeResult, challengeResult] = await Promise.allSettled([
      getGroupDetail(groupId, date),
      getAnnouncements(groupId),
      getChallenges(groupId, date),
    ]);
    if (seq !== requestSeqRef.current) return false;

    let resolvedDetail: GroupDetailResponse | null =
      detailResult.status === 'fulfilled' ? detailResult.value : null;

    // 멤버십 부재가 확정돼도 참가자 스코프 결과가 남아 있으면 먼저 소비한다(N53·C8).
    // 결과 유무를 모르는 회차에는 성공 이탈로 단정하지 않고 호스트의 다음 판정에 남긴다.
    const convergeMembershipAbsence = (): boolean => {
      // 환불 푸시로 들어온 착지는 **어떤 경우에도 튕기지 않는다**(GROMO-1579 · GROMO-1421).
      // 삭제·무산 환불 회차는 결과 큐에서 빠지므로(challengeResult의 voidReason 필터 — N48이
      // 정한 이중 통지 금지의 구현체) 탈퇴자에겐 "보여줄 결과 0건"이 되어 아래 onLeft가 즉시
      // 발화했다 — 사용자는 알림을 눌렀는데 그룹 목록으로 되돌아갔다. 착지점은 "해당 그룹
      // 화면(결과 모달은 띄우지 않는다)"이 계약이므로, 여기서 환불 안내로 수렴한다.
      // 큐에 다른 결과가 남아 있으면 그 모달은 이 안내 위에 그대로 뜬다(아래 refundNoticeView).
      if (refundNotice) {
        pendingLeaveRef.current = false; // 이탈 자체를 예약하지 않는다 — 모달을 닫아도 안 나간다
        setRefundBlocked(true);
        setError(true);
        return true;
      }
      // 호스트가 "보여줄 것이 없다"를 **확정했을 때만** 방을 내린다.
      // 'pending'(아직 남았다)과 'unknown'(조회·가드 읽기 실패, 아직 조회 전)은 둘 다 유예다 —
      // 모르는 채로 탈퇴자를 내보내면 다른 소속 그룹이 없는 사용자는 정산 결과를 영영 못 본다.
      // 유예를 걸어 두면 호스트가 큐를 비우는 순간(마지막 모달을 닫거나, 성공 조회가 0건을
      // 확정하는 순간) 아래 구독이 onLeft로 잇는다.
      if (getChallengeResultGate() === 'none') {
        leaveRoom();
        return false;
      }
      pendingLeaveRef.current = true;
      setError(true);
      return true;
    };

    if (detailResult.status === 'rejected') {
      const code = groupErrorCode(detailResult.reason);
      if (code === 'MEMBER_ONLY') {
        // 서버가 활성 인증 뒤 멤버십 부재를 확인한 사후조건이라 직접 수렴할 수 있다.
        if (!convergeMembershipAbsence()) return false;
      } else if (code === 'NOT_FOUND' || code === USER_NOT_FOUND) {
        // NOT_FOUND는 활성 사용자 부재와 그룹 부재가 같은 code다. 인증을 재확인하고, 유효한
        // 세션이면 최신 detail/전체 목록 scope가 결론을 낼 때만 방 유지 또는 이탈로 수렴한다.
        // USER_NOT_FOUND(GROMO-1247)도 같은 재확인으로 보낸다 — 세션 이상은 resolver가
        // session_recovery로 확정한다. 빼 두면 서버 분리 직후 이 방이 일반 오류로 강하한다.
        const resolution = await resolveGroupRoomNotFound({ groupId, date, userId: userId ?? '' });
        if (seq !== requestSeqRef.current) return false;
        if (resolution.kind === 'detail') {
          resolvedDetail = resolution.detail;
        } else if (resolution.kind === 'membership_absent') {
          if (!convergeMembershipAbsence()) return false;
        } else {
          // session_recovery는 공통 로그아웃 경계를 이미 시작했다. 트리가 남아 있는 동안에도
          // 성공 복귀로 보이지 않게 안전 오류를 둔다. 재확인 실패도 같은 명시 재시도 상태다.
          setError(true);
        }
      } else {
        setError(true);
      }
    }

    if (resolvedDetail !== null) {
      // 최신 상세 성공은 현재 멤버십을 다시 증명한다. 앞선 실패에서 결과 모달 뒤 이탈을
      // 예약했더라도 낡은 예약으로 방을 나가지 않게 해제한다(1회 래치도 함께 푼다 — 멤버십이
      // 다시 증명된 뒤의 새 부재 판정은 새 사건이다).
      pendingLeaveRef.current = false;
      leftRef.current = false;
      // 환불 안내 래치도 같은 근거로 푼다(codex 사전 게이트 P2). 이 래치는 groupId가 바뀔 때만
      // 풀렸는데, 다른 기기에서 같은 그룹에 재가입한 뒤 포그라운드로 돌아오거나 같은 라우트가
      // 결과 푸시로 갱신되면 상세 조회가 성공해도 조기 반환이 계속 환불 안내를 그렸다.
      // 멤버십이 다시 증명된 순간 그 안내는 사실이 아니다 — 방을 열 수 있는 사람에게
      // "이 그룹에 속해 있지 않아 방을 열 수 없어요"를 계속 보여주게 된다.
      setRefundBlocked(false);
      setDetail(resolvedDetail);
      loadedDateRef.current = date;
      // 그룹방이 실제로 보여진(상세 로드 성공) 순간 방문을 계측한다 — route episode당 1회.
      const previousRoomView = roomViewedRef.current;
      const isNewGroup = previousRoomView?.groupId !== groupId;
      const isNewCardIntent =
        entrySource === 'group_card' &&
        interactionId != null &&
        previousRoomView?.interactionId !== interactionId;
      if (isNewGroup || isNewCardIntent) {
        roomViewedRef.current = { groupId, interactionId };
        const attributedInteractionId = consumeCardInteraction(
          { entrySource, interactionId, interactionAcceptedAt },
          ROOM_ATTRIBUTION_TTL_MS,
        );
        logGroupRoomViewed({
          group_id: groupId,
          entry_source: entrySource,
          interaction_id: attributedInteractionId,
        });
      }
    }

    if (noticeResult.status === 'fulfilled') {
      setNotices(noticeResult.value);
      setNoticeError(false);
    } else {
      setNoticeError(true); // 기존 공지는 그대로 둔다
    }

    if (challengeResult.status === 'fulfilled') {
      setChallenges(challengeResult.value);
      setChallengeError(false);
      // 내기 진입 잠금은 **최신 챌린지가 실제로 반영된 순간**에만 푼다(코덱스 리뷰).
      // load() 자체는 allSettled라 챌린지만 실패해도 정상 resolve하므로, 호출부의 finally로 풀면
      // 판돈은 빠졌는데 카드는 '내기 이전'인 채 진입점이 다시 열려 같은 요청을 반복하게 된다.
      // 실패하면 잠금을 유지하고, 다음 성공(당겨서 새로고침·포커스·포그라운드 복귀)이 푼다.
      setBetBusy(false);
      // 서버가 내 내기를 정산했으면 잔액도 함께 맞춘다 — 카드는 당첨·환불을 말하는데 전역 잔액만
      // 정산 전 값으로 남는 상태를 여기서 닫는다(위 settledBetSignature 주석).
      // ⚠️ 서명 확정은 잔액 동기화 **성공 뒤**다(GROMO-1024) — 먼저 확정하면 refreshCoins가
      //    일시 실패했을 때(throw 없이 coinsLoaded만 내려간다) 이후 조회가 전부 같은 서명으로
      //    판단해 영구히 재시도하지 않는다. 실패하면 이전 서명을 유지해, 다음 성공 조회
      //    (포커스·포그라운드 복귀·당겨서 새로고침)가 같은 변화를 다시 감지해 동기화를 재시도한다.
      const signature = settledBetSignature(challengeResult.value, userId ?? null);
      const previous = settledSigRef.current;
      if (previous === null || previous === signature) {
        settledSigRef.current = signature;
      } else {
        const synced = await refreshCoins();
        // 동기화를 기다리는 사이 새 조회·그룹 전환이 끼어들었으면 이 서명은 이미 낡았다 —
        // 확정하지 않고 '최신 아님'으로 끝낸다(끼어든 조회가 자기 서명으로 다시 판단한다).
        if (seq !== requestSeqRef.current) return false;
        if (synced) settledSigRef.current = signature;
      }
    } else {
      setChallengeError(true); // 기존 챌린지는 그대로 둔다
    }
    return true;
    // onLeft 대신 leaveRoom(신원 고정)을 본다 — 최신 콜백은 onLeftRef가 들고 있으므로
    // 부모가 콜백을 새로 만들어도 load 신원이 갈려 포커스 재조회가 다시 돌지 않는다.
  }, [
    groupId,
    leaveRoom,
    userId,
    refreshCoins,
    entrySource,
    interactionId,
    interactionAcceptedAt,
    refundNotice,
  ]);

  // 최초 진입·재시도 — 스피너를 세우고 조회한다(당겨서 새로고침은 RefreshControl이 표시).
  const reload = useCallback(() => {
    setLoading(true);
    load().then((fresh) => {
      if (fresh) setLoading(false);
    });
  }, [load]);

  // 포커스마다 재조회 — 공지를 쓰고(GroupNotice는 루트 스택 push라 이 화면이 언마운트되지 않는다)
  // 돌아왔을 때 공지 카드·멤버별 오늘 집중분이 옛 데이터로 남는 문제를 닫는다.
  // 마운트 1회 useEffect였을 땐 당겨서 새로고침 말고는 반영 경로가 없었다.
  // cleanup에서 시퀀스를 올려 진행 중이던 요청을 무효화한다(화면을 떠난 뒤 setState·onLeft 방지).
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      reload();
      return () => {
        focusedRef.current = false;
        requestSeqRef.current++;
        invalidateCardInteraction(interactionId);
        // 승인 대기 중인 카드 시트를 접는다 — 이 화면을 떠난 뒤 승인이 떨어지면
        // 그 시트가 **새 화면 위로** 뜬다(RN Modal은 라우트를 넘어 보인다).
        sheetGrantInFlightRef.current = null;
        settleSheetSlotWaiters(false);
        setSheetSlotRequested(false);
      };
    }, [reload, interactionId, settleSheetSlotWaiters]),
  );

  // 탈퇴 유예의 종결 — 호스트가 "보여줄 것이 없다"를 확정하는 순간 이탈을 잇는다(N53·C8).
  // 그 순간은 둘이다: 사용자가 **마지막 결과 모달을 닫았을 때**, 그리고 성공한 재조회가
  // **0건을 확정했을 때**(모달이 한 번도 뜨지 못한 채 서버에서 결과가 빠진 경우).
  // 구독은 마운트 1회 — onLeft는 ref로 최신 것을 쓴다.
  useEffect(
    () =>
      subscribeChallengeResultGate((state) => {
        if (!pendingLeaveRef.current || state !== 'none') return;
        leaveRoom();
      }),
    [leaveRoom],
  );

  // 포그라운드 복귀 — 포커스는 유지된 채라 useFocusEffect가 다시 돌지 않는다.
  // 화면이 떠 있으면 재조회하고, 자정을 넘겼으면 포커스 여부와 무관하게 새 date로 다시 부른다.
  useEffect(() => {
    if (AppState.currentState === 'background' || AppState.currentState === 'inactive') {
      invalidateCardInteraction(interactionId);
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        invalidateCardInteraction(interactionId);
        return;
      }
      if (focusedRef.current || loadedDateRef.current !== todayStrKst()) reload();
    });
    return () => sub.remove();
  }, [reload, interactionId]);

  // 정산 결과 푸시를 포그라운드에서 받으면 즉시 재조회한다(GROMO-1580 ④).
  // 종료 푸시는 정산 **전**에 오므로 그것을 탭해 들어온 순간에는 방금 끝난 회차가 큐에 없고,
  // 지목은 focusPendingRef에 유예 보관된다(PR #566 리뷰 ③ — 이 설계는 유지). 그런데 그 뒤
  // **그 방에 머무르는 포그라운드 구간**에는 재조회 계기가 하나도 없다(useFocusEffect·AppState
  // active 복귀·focusChallengeId 변경 셋 다 발화하지 않는다) — 정산이 끝나도 사용자는 아무것도
  // 못 보고 기다린다. 폴링 대신 서버가 그 사건에 보내는 BET_RESULT를 계기로 삼는다(상한·중단
  // 조건을 새로 규정하지 않아도 되는 유일한 축 — betResultSignal 파일 주석).
  // load()를 직접 부른다(reload 아님) — 스켈레톤을 다시 세우지 않는 조용한 갱신이다.
  // 화면이 안 보이면 하지 않는다: 다음 포커스가 어차피 같은 조회를 한다.
  useEffect(() => {
    return subscribeBetResultPush(() => {
      if (!focusedRef.current) return;
      load();
    });
  }, [load]);

  // 당겨서 새로고침 — 스피너는 **무조건** 내린다. '최신 응답일 때만' 내리면
  // 진행 중 다른 조회(포그라운드 복귀·삭제 후 재조회 등)가 끼어들어 seq가 밀리는 순간
  // 내릴 주체가 사라져 스피너가 영구히 돈다. 늦게 끝난 요청이 내려도 사용자 피해는 없다.
  const onRefresh = useCallback(() => {
    // 사용자가 **명시적으로** 요청한 재시도다 — 결과 호스트도 함께 깨운다(아래 onRetry 주석).
    requestChallengeResultRefresh();
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  // 오류 화면·배너의 「다시 시도」 — 이 화면만 다시 조회하면 부족하다.
  // ⚠️ 결과 모달의 소유자가 루트 호스트로 옮겨 가며 **방과 호스트의 재조회 계기가 갈렸다.**
  //    결과 조회가 실패해 gate가 'unknown'으로 굳으면 이 방은 이탈을 유예한 채 오류 화면을
  //    세우는데, 그 상태에서 버튼을 눌러도 호스트는 아무것도 하지 않는다 — 탈퇴자는 자기
  //    정산 결과를 못 본 채 방에 갇힌다. 그래서 재시도 신호를 함께 보낸다.
  //    포커스 복귀 같은 화면 내부 사건에는 붙이지 않는다(정본이 정한 재조회 계기 셋을 지킨다).
  const onRetry = useCallback(() => {
    requestChallengeResultRefresh();
    reload();
  }, [reload]);

  // 시트가 그릴 챌린지 — **살아 있는 배열에서 파생**한다(F2). 배경 재조회가 반영된 최신 팟·참가자다.
  const betChallenge =
    betSheet !== null && challenges !== null
      ? (challenges.find((c) => c.id === betSheet.challengeId) ?? null)
      : null;
  // 개설 시트의 달성 잠금 근거 — 내기가 없는 챌린지엔 bet.myAchievedNow가 없어 진행률에서 파생한다
  // (카드의 개설 진입점이 쓰는 계산 그대로). null(미판정)은 달성으로 세지 않는다.
  const betMyAchieved =
    !!userId &&
    !!betChallenge?.memberProgress?.some((p) => p.userId === userId && p.achieved === true);

  // 시트가 가리키던 대상이 사라졌으면 닫는다 — 없는 챌린지의 낡은 화면으로 돈을 걸 수는 없다.
  // 시트를 연 근거(모드의 진입 조건)가 최신 챌린지에서 깨진 경우도 같다(staleBetSheetAlert).
  // 조용히 바꿔 끼우지 않고 닫아서 **다시 열게** 한다 — 보고 있던 판돈·팟이 소리 없이 달라지면
  // 사용자는 자기가 확인한 값으로 걸었다고 믿는다.
  useEffect(() => {
    if (betSheet === null || challenges === null) return;
    if (betChallenge === null) {
      setBetSheet(null);
      return;
    }
    const stale = staleBetSheetAlert(betSheet, betChallenge);
    if (stale === null) return;
    setBetSheet(null);
    showAlert(stale[0], stale[1]);
  }, [betSheet, challenges, betChallenge, showAlert]);

  // 카드가 올리는 시트 열림 보고(GROMO-1578) — 신원을 고정한다. 매 렌더 새 함수를 주면 카드의
  // 정리 이펙트가 렌더마다 재등록되며 false를 흘려, 시트가 떠 있는데도 열림이 취소된다.
  const onCardSheetVisibilityChange = useCallback(
    (challengeId: string, open: boolean) => {
      // ⚠️ 여기서 `sheetGrantInFlightRef`를 비우지 않는다. 비우면 가드 둘의 갱신 시점이 어긋난다:
      //    이 ref는 **즉시** 바뀌는데 `sheetOpenRef`는 **다음 렌더까지 여전히 false**다. 그 사이에
      //    다른 카드의 프리플라이트가 끝나 요청하면 grantOneSheetWaiter가 두 가드를 모두 통과해
      //    **RN Modal 두 개가 함께 마운트**된다. 그래서 진행 중 승인은 **열림 상태가 실제로
      //    커밋될 때까지** 유지하고, 아래 이펙트가 커밋을 확인한 뒤에 푼다.
      // `sheetSlotRequested` 해제도 여기서 하지 않는다 — 위 "요청 해제" 이펙트가 한 곳에서
      // 판단한다(조건이 둘로 갈리면 빈 등록이 남는 창이 다시 생긴다).
      setSheetOpenCardIds((prev) => {
        const had = prev.includes(challengeId);
        if (had === open) return prev; // 같은 값 재보고는 리렌더를 만들지 않는다
        return open ? [...prev, challengeId] : prev.filter((id) => id !== challengeId);
      });
    },
    // 의존성 없음이 의도다 — 카드의 정리 이펙트가 이 신원에 매달려 있어, 바뀌면 렌더마다
    // 재등록되며 false를 흘린다(시트가 떠 있는데 열림이 취소된다).
    [],
  );

  // 내 권한 판정 — 상세 응답에 내 role이 없어 멤버 목록에서 직접 계산한다(§6-4).
  const me = userId ? detail?.members.find((m) => m.userId === userId) : undefined;
  const isOwner = me?.role === 'OWNER';
  const canWriteNotice = isOwner || (!!userId && !!detail?.noticeGrantedUserIds.includes(userId));

  const name = detail?.name ?? summary?.name ?? '내 그룹';
  const memberCount = detail?.members.length ?? summary?.currentMembers ?? 0;
  const maxMembers = detail?.maxMembers ?? summary?.maxMembers ?? 0;
  const isPrivate = detail?.isPrivate ?? summary?.isPrivate ?? false;
  const isFull = maxMembers > 0 && memberCount >= maxMembers;

  // 초대 — 링크는 **서버가 발급한 url 만** 쓴다(초대 링크 스펙 §4-2 ①·§7-4).
  // 앱이 조립하던 시절의 로컬 링크는 폐기했다: slug 는 어트리뷰션 원장이라 서버만 만들 수 있고,
  // 발급을 건너뛰면 클릭·설치·가입이 어느 링크에서 왔는지 영영 알 수 없다.
  // 발급은 멱등이라 같은 그룹·같은 사람이 여러 번 눌러도 링크가 늘어나지 않는다.
  const onInvite = useCallback(async () => {
    let invite: { slug: string; url: string };
    try {
      invite = await issueInviteLink(groupId);
    } catch {
      // 폴백 링크는 두지 않는다 — slug 없는 링크는 서버가 모르는 주소라 404로 끝난다.
      showAlert('초대 링크를 만들지 못했어요', '잠시 후 다시 시도해 주세요.');
      return;
    }
    // ⚠️ 요청만 하고 넘어가면 안 된다 — 기다리는 사이 결과 모달이 먼저 노출되면
    //    공유 시트가 그 위를 덮어 사용자가 못 본 결과에 seen/ack이 남는다.
    if ((await overlayActions?.acquire(SHARE_SLOT_ID, OVERLAY_PRIORITY.sheet)) === false) return;
    try {
      const result = await Share.share({
        message: buildInviteShareMessage(name, invite.url),
      });
      // 취소(dismissedAction)까지 공유로 집계하지 않는다 — 단 그 구분은 iOS에서만 가능하다.
      // 안드로이드는 시트를 그냥 닫아도 sharedAction으로 끝나 완료를 확인할 수 없어
      // confirmed:false(공유 시도)로 남긴다(analyticsEvents.logGroupInviteShared 주석).
      if (result.action === Share.sharedAction) {
        logGroupInviteShared({
          share_method: 'share_sheet',
          confirmed: Platform.OS === 'ios',
          slug: invite.slug,
          group_id: groupId,
        });
      }
    } catch {
      // 공유 시트를 못 띄운 경우 — 사용자에게 알릴 것이 없어 조용히 무시한다.
    } finally {
      overlayActions?.release(SHARE_SLOT_ID);
    }
  }, [groupId, name, overlayActions, showAlert]);

  const openNotice = useCallback(() => {
    navigation.navigate('GroupNotice', { groupId, canWrite: canWriteNotice });
  }, [navigation, groupId, canWriteNotice]);

  // 전환 뒤 늦게 도착한 실패 Alert가 지금 보고 있는 다른 그룹 화면 위에 뜨는 것을 막는다
  // (A-7, GROMO-1027·1028). 액션을 건 그룹(targetGroupId)이 여전히 화면에 떠 있을 때만 Alert를 낸다 —
  // renderedGroupIdRef는 렌더 중 groupId 리셋과 같은 기준(지금 그리고 있는 그룹).
  const alertIfCurrent = useCallback(
    (targetGroupId: string, title: string, message: string) => {
      if (renderedGroupIdRef.current !== targetGroupId) return;
      showAlert(title, message);
    },
    [showAlert],
  );

  // 챌린지 삭제 — 확인 Alert는 카드가 이미 거쳤다(ChallengeCard). 여기선 호출과 재조회만 한다.
  // 서버가 soft delete로 바꿔 이미 지워진 챌린지를 또 지우면 NOT_FOUND가 오는데,
  // 목록에서 사라지는 결과는 같으므로 성공과 똑같이 재조회로 끝낸다.
  const onDeleteChallenge = useCallback(
    async (challengeId: string) => {
      try {
        await deleteChallenge(groupId, challengeId);
      } catch (e) {
        // 전환 전 그룹의 삭제 실패가 늦게 도착하면 무시 — 지금 보고 있는 다른 그룹 화면 위에
        // 이전 그룹의 실패 안내를 띄우지 않는다(onDone·onCreated와 같은 가드, GROMO-1027).
        // 재조회도 시작하지 않는다(load 내부 가드와 같은 결론을 여기서 먼저 낸다).
        if (renderedGroupIdRef.current !== groupId) return;
        const code = groupErrorCode(e);
        // 진행 중인 내기가 있으면 서버가 삭제를 막는다(백 계약 CHALLENGE_HAS_OPEN_BET, 409) —
        // 이미 판돈을 걷어 둔 내기를 챌린지와 함께 지우면 돈이 갈 곳을 잃기 때문이다.
        // 공통 문구로 떨어뜨리면 '잠시 후 다시 시도'를 반복해도 정산 전까진 영원히 같은 실패다.
        if (code === 'CHALLENGE_HAS_OPEN_BET') {
          // 전환 뒤 늦게 온 실패는 지금 보는 그룹 위에 띄우지 않는다(A-7).
          alertIfCurrent(
            groupId,
            '챌린지를 삭제할 수 없어요',
            '진행 중인 내기가 있어 삭제할 수 없어요.',
          );
          return;
        }
        if (code !== 'NOT_FOUND') {
          alertIfCurrent(groupId, '챌린지를 삭제하지 못했어요', '잠시 후 다시 시도해 주세요.');
          return;
        }
      }
      load();
    },
    [groupId, load, alertIfCurrent],
  );

  // 라우트 진입의 백버튼 — 헤더뿐 아니라 상세 도착 **전**(로딩·에러) 분기에도 세운다.
  // 이 화면엔 네이티브 헤더도 탭바도 없어, 첫 조회가 도는 동안·실패했을 때 백버튼이 없으면
  // 목록으로 돌아갈 명시 경로가 0개가 된다(iOS는 시스템 뒤로가기도 없다).
  const backButton = onBack ? (
    <TouchableOpacity
      style={s.backBtn}
      onPress={onBack}
      activeOpacity={0.7}
      accessibilityLabel="뒤로"
    >
      <Ionicons name="chevron-back" size={18} color={T.inkSub} />
    </TouchableOpacity>
  ) : null;

  // ⚠️ 결과 모달은 이 화면의 어느 분기에도 없다(GROMO-1576) — 루트의 ChallengeResultHost가
  //    그린다. 예전엔 상세 도착 전(로딩·에러) 분기에도 일부러 그렸는데, 탈퇴자(MEMBER_ONLY)는
  //    detail이 영영 없어 본문에만 두면 참가자 스코프 결과가 화면에 닿지 못했기 때문이다.
  //    호스트가 루트로 올라가며 그 문제 자체가 사라졌다.

  // 헤더 — 로딩 분기와 본문이 **같은 노드**를 쓴다. name·인원은 이미 summary 폴백이 있어
  // (위 `detail?.name ?? summary?.name` — 상세 도착 전 헤더를 먼저 그리려고 둔 장치다)
  // 상세를 기다릴 필요가 없고, 덕분에 데이터가 도착해도 헤더가 제자리에서 글자만 채워진다.
  // ⚠️ 헤더는 스켈레톤 묶음 **밖**에 둔다 — SkeletonGroup은 accessibilityElementsHidden이라
  //    안에 넣으면 스크린리더에서 백버튼(유일한 탈출 경로)과 설정 진입이 사라진다.
  const headerRow = (
    <View style={s.header}>
      {/* 라우트 진입에서만 — 규격은 그룹 만들기·공지 화면의 원형 백버튼과 같다(§5-1) */}
      {backButton}
      <View style={s.headerLeft}>
        <Text style={s.title} numberOfLines={1}>
          {name}
        </Text>
        {isPrivate && <Ionicons name="lock-closed" size={15} color={T.inkSub} />}
        {/* 정원을 모르는 동안(요약 없이 첫 조회 중)은 '0/0'을 쓰지 않는다 — 상세가 오면 항상 1 이상이라
            본문 렌더에는 영향이 없다. */}
        {maxMembers > 0 && (
          <Text style={s.count}>
            {memberCount}/{maxMembers}
          </Text>
        )}
      </View>
      <TouchableOpacity
        style={s.moreBtn}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('GroupSettings', { groupId })}
        accessibilityLabel="그룹 설정"
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={T.ink} />
      </TouchableOpacity>
    </View>
  );

  // ── 최초 로딩 — 화면 실루엣 자리표시자(GROMO-1381, 옛 중앙 스피너 대체) ──
  //
  // ⚠️ 로딩이라고 **화면을 다른 트리로 갈아끼우지 않는다**(codex 리뷰). 예전에는 로딩 동안 별도
  //    트리(View > View)를 돌려줬는데, 상세가 도착하는 순간 껍데기가 통째로 바뀌면서 헤더가
  //    언마운트→재마운트됐다. 같은 JSX 변수(headerRow)를 써도 부모 트리가 다르면 네이티브 노드는
  //    유지되지 않는다 — 응답을 기다리며 백버튼·그룹 설정에 스크린리더/키보드 포커스를 두고 있던
  //    사용자는 그 순간 포커스를 잃는다. 껍데기(ScrollView + headerRow)는 로딩 전후로 **같은
  //    자리에 그대로** 두고 본문만 바꾼다.
  //
  // 자리표시자는 섹션 라벨과 멤버 그리드만 잡는다. 데이터가 오면 이 블록이 사라져 펄스(무한 루프)도
  // 함께 언마운트된다. 블록이 여러 개라 SkeletonGroup 한 겹에만 펄스를 건다 — 블록마다 돌리면
  // 무한 루프가 여러 개 생겨 "화면당 1개" 상한을 구조적으로 위반한다(codex 리뷰).
  const showSkeleton = loading && !detail;
  const skeletonBody = (
    <SkeletonGroup style={s.skeletonBody} testID="group.room.skeleton">
      {/* 공지·챌린지 모두 **카드 자리표시자를 두지 않는다** — 섹션 라벨만 세운다(codex 리뷰).
          로딩 중에는 **몇 장이 올지 알 수 없다.** 공지는 0장(빈 상태 카드)일 수도 최대
          NOTICE_PREVIEW(3)장일 수도 있는데, 목록 조회 전에 개수를 알려 주는 경로가 없다 —
          그룹 요약(GroupSummaryResponse)에도 공지 수·유무 필드가 없고 이전 응답 캐시도 없다.
          한 장으로 고정하면 3장이 도착하는 순간 아래 섹션이 100pt 넘게 밀려, 자리표시자를
          넣은 목적(레이아웃 안정화) 자체를 거스른다. 챌린지도 같은 이유다(카드 높이가 참가자
          수에 따라 달라지고, 개수도 모른다). 추정 대신 비워 두면 어긋남은 '아래로 늘어나는'
          방향뿐이라 이미 읽은 요소가 위로 튀어 오르지 않는다.
          멤버 그리드는 다르다 — 타일 높이가 상수이고 한 행(COLS)은 인원과 무관하게 항상 찬다. */}
      <View style={s.sectionHead}>
        <Skeleton w={44} h={SK_LABEL_H} radius={6} />
      </View>
      <View style={s.sectionHead}>
        <Skeleton w={60} h={SK_LABEL_H} radius={6} />
      </View>
      <View style={s.sectionHead}>
        <Skeleton w={44} h={SK_LABEL_H} radius={6} />
      </View>
      <View style={s.gridRow}>
        {Array.from({ length: COLS }, (_, i) => (
          <View key={i} style={s.gridPad}>
            <Skeleton w="100%" h={SK_TILE_H} radius={14} />
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );

  // ── 에러 + 다시 시도 ──
  // ⚠️ 여기는 로딩과 달리 화면을 통째로 바꾼다 — 포커스를 유지할 대상 자체가 없기 때문이다.
  //    이 분기에는 그룹 설정 버튼도 제목도 없고(백버튼만 남는다) 남길 본문도 없다. 로딩→성공은
  //    "같은 화면이 채워지는" 전환이지만, 로딩→실패는 "다른 화면으로 가는" 전환이다.
  // 탈퇴 유예(pendingLeaveRef) 중에는 이 화면이 결과 모달의 **배경**이다 — 모달 자체는 루트
  // 호스트가 그리고(GROMO-1576), 마지막 결과를 소비하면 challengeResultGate가 'none'으로
  // 바뀌며 위 구독이 onLeft로 잇는다(PR #566 리뷰 ②).
  // ── 환불 푸시 착지의 멤버십 부재(GROMO-1579) ──
  // 목록으로 튕기지 않고 **여기서 사건을 마무리한다.** 이 화면이 서는 조건은 딱 하나 —
  // 환불 푸시(refund=1)로 들어왔고 서버가 멤버십 부재를 확정했을 때다(convergeMembershipAbsence).
  // 왜 결과 모달이 아니라 안내인가: 삭제·무산 환불은 **이 푸시가 이미 알린 사건**이라 모달까지
  // 열면 같은 사건 이중 통지가 된다(N48 · 결정 N05). 그래서 여기서 말하는 것은 '무슨 일이
  // 있었는지'와 '돈은 어떻게 됐는지'뿐이다.
  // 왜 '그룹을 불러오지 못했어요'가 아닌가: 그룹은 멀쩡하고 조회도 성공했다 — 내가 멤버가
  // 아닐 뿐이다. 재시도를 권하면 영원히 같은 실패를 반복하게 된다.
  // 문구는 사유를 특정하지 않는다 — refund=1은 사유를 구분하지 않고 voidReason은 앱까지 오지
  // 않는다. 그리고 `BET_VOID_REFUND`가 싣는 사유는 셋이다(N48): 챌린지 삭제 · 인원 미달 무산 ·
  // 24시간 정산 지연 자동 전원 환불(`REFUND_DEADLINE`, N55).
  // ⚠️ 그래서 "진행되지 않은 회차"라고 쓸 수 없다(codex 사전 게이트 P2) — 24시간 지연 환불은
  //    회차가 **정상적으로 진행된 뒤**의 환불이라 그 사용자에겐 사실과 반대가 된다. 세 사유
  //    모두에 참인 것은 '참가비가 돌아왔다'와 '잔액에 반영됐다' 둘뿐이고, 그 둘만 말한다.
  // 잔액은 이미 다시 받았다 — 딥링크 처리(navigationRef)가 refund=1에서 requestCoinRefresh를
  // 태운다. 나가기는 사용자가 누를 때만 한다(자동 이탈이 이 티켓의 결함이었다).
  if (refundBlocked) {
    return (
      <View style={s.fill} testID="group.room.refundNotice">
        {!!backButton && <View style={s.backRow}>{backButton}</View>}
        <View style={s.center}>
          <Text style={s.errorTitle}>참가비가 환불됐어요</Text>
          <Text style={s.errorDesc}>
            걸었던 참가비를 돌려드렸어요.{'\n'}잔액에 이미 반영했어요.
          </Text>
          <Text style={s.errorDesc}>지금은 이 그룹에 속해 있지 않아 방을 열 수 없어요.</Text>
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={onLeft}>
            <Text style={s.retryText}>확인</Text>
          </TouchableOpacity>
        </View>
        {/* 환불과 무관한 다른 정산 결과가 큐에 남아 있으면 루트 호스트가 이 안내 **위에** 띄운다
            (N53·C8) — 이 화면은 그 모달의 배경일 뿐이라 여기서 그리지 않는다. */}
      </View>
    );
  }

  if (error && !detail) {
    return (
      <View style={s.fill}>
        {!!backButton && <View style={s.backRow}>{backButton}</View>}
        <View style={s.center}>
          <Text style={s.errorTitle}>그룹을 불러오지 못했어요</Text>
          <Text style={s.errorDesc}>잠시 후 다시 시도해 주세요.</Text>
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={onRetry}>
            <Text style={s.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // 멤버 순서는 서버가 준 그대로 둔다(앱에서 재정렬하지 않음).
  // '＋ 초대' 타일까지 한 흐름으로 배치하려고 셀 배열로 만든 뒤 3개씩 잘라 행으로 그린다.
  const members = detail?.members ?? [];
  const noticeList = notices ?? [];
  const challengeList = challenges ?? [];
  // 만들기 시트가 '이미 있는 (카테고리, 방식) 조합'을 못 고르게 하는 근거 — 서버의 중복 판정
  // 단위가 이 조합이다(V20 부분 유니크 인덱스 — 같은 조합의 ACTIVE가 있으면 409). 카테고리만
  // 넘기면 창형만 있는 카테고리에서 매트릭스가 반전된다(GROMO-1222 — 되는 매일 목표가 잠기고
  // 409가 확정된 시간대가 열린다). 종료된 챌린지는 다시 만들 수 있으므로 ACTIVE만 센다.
  const existingCombos = challengeList
    .filter((c) => c.status === 'ACTIVE')
    .map((c) => ({ category: c.missionCategory, type: c.missionType }));
  // 섹션 실패 표시는 '한 번도 못 받음'뿐 아니라 '빈 목록 + 갱신 실패'에도 세운다 —
  // 빈 상태 문구가 뜨면 서버 상태를 못 받았다는 사실이 화면에서 완전히 사라진다.
  const noticeFailed = noticeError && noticeList.length === 0;
  const challengeFailed = challengeError && challengeList.length === 0;
  // 라우트 진입 전용 화면이라 하단 탭바가 없다 — 시스템 인셋 + 기본 여백만 준다.
  // 하단바(F2 Part2)가 콘텐츠를 가리지 않게 그 높이만큼 스크롤 하단 여백을 더한다.
  const bottomSpace = insets.bottom + T.space.md + GROUP_BOTTOM_BAR_SPACE;
  const cells: GridCell[] = [
    // rank는 서버 정렬 순서(누적 집중 내림차순) 그대로 — 앱에서 재정렬하지 않는다(리더보드).
    ...members.map((m, i): GridCell => ({ kind: 'member', member: m, rank: i + 1 })),
    { kind: 'invite' },
  ];
  const memberRows = chunk(cells, COLS);

  return (
    <>
      <ScrollView
        style={s.scroll}
        testID="group.room.scroll"
        contentContainerStyle={[s.content, { paddingBottom: bottomSpace }]}
        showsVerticalScrollIndicator={false}
        // 첫 조회가 도는 동안에는 당겨서 새로고침을 달지 않는다 — load()에 동시 실행 가드가 없어
        // 같은 요청이 하나 더 나가고, 스켈레톤이 이미 "불러오는 중"을 말하고 있어 재시도 수단이
        // 필요하지 않다. 실패하면 아래 에러 분기의 '다시 시도'가 받는다.
        refreshControl={
          showSkeleton ? undefined : (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.accent} />
          )
        }
      >
        {/* ── 재조회 실패 배너 — 기존 데이터를 지우지 않고 '지금 보는 값이 옛것'임을 알린다 ── */}
        {error && !!detail && (
          <View style={s.banner}>
            <Text style={s.bannerText}>최신 정보를 불러오지 못했어요</Text>
            <TouchableOpacity onPress={onRetry} hitSlop={12} activeOpacity={0.7}>
              <Text style={s.bannerRetry}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 헤더 ── 로딩 중에도 **같은 자리에 그대로** 남는다(위 showSkeleton 주석) */}
        {headerRow}

        {showSkeleton ? (
          skeletonBody
        ) : (
          <>
            {/* ── 공지 ── */}
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>공지</Text>
              {noticeList.length > 0 && (
                <TouchableOpacity
                  style={s.moreRow}
                  activeOpacity={0.7}
                  onPress={openNotice}
                  hitSlop={12}
                >
                  <Text style={s.moreLink}>모두보기</Text>
                  <Ionicons name="chevron-forward" size={11} color={T.accent} />
                </TouchableOpacity>
              )}
            </View>

            {/* 공지를 못 받은 채 목록이 비어 있음 — '없음'과 구분해서 알린다(문구·아이콘 모두 danger).
            이 상태에선 작성 진입을 막는다(서버엔 이미 공지가 있는데 없다고 보고 또 쓰는 것을 예방). */}
            {noticeFailed ? (
              <View style={s.emptyNotice}>
                <View style={s.emptyErrorRow}>
                  <Ionicons name="alert-circle-outline" size={15} color={T.dangerInk} />
                  <Text style={s.emptyErrorText}>공지를 불러오지 못했어요</Text>
                </View>
                <TouchableOpacity style={s.writeBtn} activeOpacity={0.85} onPress={reload}>
                  <Text style={s.writeText}>다시 시도</Text>
                </TouchableOpacity>
              </View>
            ) : noticeList.length === 0 ? (
              <View style={s.emptyNotice}>
                <Text style={s.emptyNoticeText}>아직 공지가 없어요</Text>
                {canWriteNotice && (
                  <TouchableOpacity style={s.writeBtn} activeOpacity={0.85} onPress={openNotice}>
                    <Text style={s.writeText}>공지 쓰기</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={s.noticeList}>
                {/* 목록은 있는데 갱신만 실패 — 기존 공지를 그대로 두고 한 줄로 알린다. */}
                {noticeError && <Text style={s.bannerText}>공지를 새로고침하지 못했어요</Text>}
                {noticeList.slice(0, NOTICE_PREVIEW).map((n) => (
                  <TouchableOpacity
                    key={n.id}
                    style={s.noticeCard}
                    activeOpacity={0.85}
                    onPress={openNotice}
                  >
                    <Text style={s.noticeTitle} numberOfLines={1}>
                      {n.title}
                    </Text>
                    <Text style={s.noticeDate}>{fmtNoticeDate(n.createdAt)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* ── 챌린지(2차 §3-2) — 공지 아래·멤버 그리드 위 ── */}
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>챌린지</Text>
              {/* 조회 실패 중에는 이 진입점도 함께 막는다 — 아래 빈 상태의 '만들기'만 막으면
              existingCombos가 빈 배열인 채로 시트가 열려, 서버에 이미 있는 조합을 고를 수
              있게 되고 생성은 ACTIVE_CHALLENGE_EXISTS로 확정 실패한다. */}
              {isOwner && !challengeFailed && (
                <TouchableOpacity
                  style={s.addBtn}
                  activeOpacity={0.7}
                  onPress={() => setComposeOpen(true)}
                  hitSlop={12}
                  accessibilityLabel="챌린지 만들기"
                  testID="group.challenge.add"
                >
                  <Ionicons name="add" size={16} color={T.accent} />
                </TouchableOpacity>
              )}
            </View>

            {/* 공지와 같은 규격 — 목록이 빈 채 실패면 '없음'으로 위장하지 않고 재시도를 세운다.
            이 상태에선 만들기 진입도 막는다(서버에 이미 있는 챌린지를 중복 생성하면 409로 튕긴다). */}
            {challengeFailed ? (
              <View style={s.emptyNotice}>
                <View style={s.emptyErrorRow}>
                  <Ionicons name="alert-circle-outline" size={15} color={T.dangerInk} />
                  <Text style={s.emptyErrorText}>챌린지를 불러오지 못했어요</Text>
                </View>
                <TouchableOpacity style={s.writeBtn} activeOpacity={0.85} onPress={reload}>
                  <Text style={s.writeText}>다시 시도</Text>
                </TouchableOpacity>
              </View>
            ) : challengeList.length === 0 ? (
              <View style={s.emptyNotice}>
                <Text style={s.emptyNoticeText}>아직 챌린지가 없어요</Text>
                {isOwner && (
                  <TouchableOpacity
                    style={s.writeBtn}
                    activeOpacity={0.85}
                    onPress={() => setComposeOpen(true)}
                  >
                    <Text style={s.writeText}>챌린지 만들기</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={s.noticeList}>
                {/* 목록은 있는데 갱신만 실패 — 기존 카드를 그대로 두고 한 줄로 알린다. */}
                {challengeError && <Text style={s.bannerText}>챌린지를 새로고침하지 못했어요</Text>}
                {challengeList.map((c) => (
                  <ChallengeCard
                    key={c.id}
                    challenge={c}
                    isOwner={!!isOwner}
                    myUserId={userId}
                    onDelete={onDeleteChallenge}
                    // 재조회 실패 중에는 내기 진입도 함께 잠근다(GROMO-1026) — 지금 카드는 낡은
                    // 스냅샷이라, 그 팟·참가자를 보고 돈을 거는 요청을 서버는 정상 수락해 버린다.
                    // 오류 응답 분기로는 못 잡는 '잘못된 사전 표시'라 진입 자체를 막고,
                    // 다음 성공 조회(setChallengeError(false))가 다시 연다.
                    betLocked={betBusy || challengeError}
                    // 카드가 자기 시트를 열고 닫을 때마다 알려 준다 — 이 보고가 없으면 조정자가
                    // 카드 시트를 보지 못해 그 위로 결과 모달이 겹친다(GROMO-1578).
                    onSheetVisibilityChange={onCardSheetVisibilityChange}
                    // await 뒤에 여는 시트(주간 예약·삭제 프리플라이트)의 승인 게이트 —
                    // 위 sheetSlot 주석. 동기 시트는 이 게이트를 타지 않는다.
                    onRequestSheetSlot={requestCardSheetSlot}
                    // 카드가 사라지면 승인 대기 중이던 요청을 접는다 — 안 그러면 나중에 승인이
                    // 떨어져 **사라진 카드**가 열림 집합에 자기 id를 영구히 남긴다.
                    onAbandonSheetSlot={cancelSheetWaitersFor}
                    // 철회·취소 직후 목록을 다시 받는다 — 마지막 참가자가 빠져도 서버는 챌린지를
                    // 지우지 않고 휴면으로 남기므로(GROMO-1201) 재조회가 없으면 닫힌 내기·휴면
                    // 표시가 반영되지 않은 낡은 카드가 화면에 남는다.
                    onBetChanged={load}
                    onOpenBet={(mode) =>
                      setBetSheet({ challengeId: c.id, mode, betId: c.bet?.betId ?? null })
                    }
                  />
                ))}
              </View>
            )}

            {/* 챌린지 내역(GROMO-1277 · N6-1) — **이력의 소유자는 그룹이다.** 그래서 이 링크는
                챌린지 목록의 상태와 무관하게 항상 선다: 챌린지가 하나도 없어도(전부 삭제·종료돼도)
                돈이 오간 기록은 남아 있어야 하고, 그걸 볼 수 있어야 그 약속이 지켜진 것이다.
                조회 실패 중에도 감추지 않는다 — 내역은 다른 엔드포인트라 함께 죽지 않는다. */}
            <TouchableOpacity
              style={s.historyLink}
              activeOpacity={0.7}
              hitSlop={8}
              // 필터 두 칸을 **명시적으로 비운다** — 키를 생략하면 React Navigation의 얕은 병합이
              // 스택에 남은 필터 진입(다른 방일 수도 있다)의 challengeId를 그대로 물려준다.
              onPress={() =>
                navigation.navigate('GroupChallengeHistory', {
                  groupId,
                  challengeId: undefined,
                  challengeLabel: undefined,
                })
              }
              accessibilityRole="button"
              testID="group.challenge.history"
            >
              <Text style={s.historyLinkText}>챌린지 내역</Text>
              <Ionicons name="chevron-forward" size={13} color={T.inkMuted} />
            </TouchableOpacity>

            {/* ── 멤버 ── */}
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>멤버</Text>
            </View>
            <View style={s.grid}>
              {memberRows.map((row, rowIdx) => (
                <View key={`row-${rowIdx}`} style={s.gridRow}>
                  {row.map((cell) =>
                    cell.kind === 'invite' ? (
                      <TouchableOpacity
                        key="invite"
                        style={[s.inviteTile, isFull && s.inviteTileOff]}
                        activeOpacity={0.85}
                        disabled={isFull}
                        onPress={() => onInvite()}
                      >
                        <Ionicons name="add" size={22} color={isFull ? T.inkMuted : T.accent} />
                        <Text style={[s.inviteTileText, isFull && s.inviteTileTextOff]}>
                          {isFull ? '정원 가득' : '초대'}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <MemberTile
                        key={cell.member.userId}
                        nickname={cell.member.nickname}
                        focusTimeMinutes={cell.member.focusTimeMinutes}
                        totalFocusMinutes={cell.member.totalFocusMinutes}
                        rank={cell.rank}
                        isOwner={cell.member.role === 'OWNER'}
                        isMe={cell.member.userId === userId}
                        // GROMO-1200 멤버 선택 → 나와 통계 비교(리그 비교 화면 재사용).
                        onPress={() => {
                          // userId 없이는 isMe가 무조건 false라, 내 타일을 눌러도 나를 '타인'으로
                          // 열어 나에게 친구 신청 버튼이 뜬다. 진입을 막는 편이 낫다
                          // (리그 LeagueScreen의 `if (!myUserId) return;`과 같은 가드).
                          if (!userId) return;
                          navigation.navigate('FriendProfile', {
                            userId: cell.member.userId,
                            nickname: cell.member.nickname,
                            // 그룹 멤버는 tier 미보유 → 플레이스홀더(FriendProfile이 getPublicProfile로 교정).
                            tierLevel: 1,
                            // 관계는 FriendProfile이 fetchFriends로 재동기화(초기값만 false).
                            isFriend: false,
                            // 본인 타일이면 비교 없이 내 통계만(리그 '내 행'과 동일, GROMO-940).
                            isMe: cell.member.userId === userId,
                          });
                        }}
                      />
                    ),
                  )}
                  {/* 마지막 행 빈 칸 — 남는 칸을 채워 타일 폭을 고정한다 */}
                  {Array.from({ length: COLS - row.length }).map((_, i) => (
                    <View key={`pad-${i}`} style={s.gridPad} />
                  ))}
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* 그룹방 하단바(F2 Part2) — ▶ FAB는 이 그룹의 집중 세션(그룹 페이지 기본)으로 진입시킨다. */}
      <GroupRoomBottomBar
        onFocusPress={() =>
          navigation.navigate('FocusCategory', {
            initialGroupId: groupId,
            entrySource: 'group_room',
            interactionId: undefined,
            interactionAcceptedAt: undefined,
          })
        }
      />

      {/* ── 챌린지 만들기 시트(방장만) ── */}
      {composeOpen && (
        <ChallengeComposeSheet
          groupId={groupId}
          existingCombos={existingCombos}
          onClose={() => setComposeOpen(false)}
          onCreated={() => {
            // 전환 전 그룹의 시트가 늦게 완료를 알리면 무시 — 새 그룹의 시트 상태를 건드리거나
            // 이전 그룹의 재조회를 시작하지 않는다(load 내부 가드와 같은 이유).
            if (renderedGroupIdRef.current !== groupId) return;
            setComposeOpen(false);
            load();
          }}
        />
      )}

      {/* ── 내기 시트(개설·참가, 3차 §1) ── */}
      {betSheet !== null && betChallenge !== null && (
        <BetSheet
          groupId={groupId}
          challenge={betChallenge}
          mode={betSheet.mode}
          myAchieved={betMyAchieved}
          onClose={() => setBetSheet(null)}
          onDone={() => {
            // 전환 전 그룹의 시트가 늦게 완료를 알리면 무시 — betBusy를 새 그룹 화면에 걸면
            // 풀어 줄 load()가 없어(내부 가드로 단락) 진입점이 영구히 잠긴다(코덱스 리뷰).
            if (renderedGroupIdRef.current !== groupId) return;
            setBetSheet(null);
            // 재조회가 끝날 때까지 진입점을 잠근다 — 그전의 카드는 아직 내기 이전 모습이다(F6).
            // 잠금을 푸는 쪽은 load()의 **챌린지 성공 분기**다(위 주석).
            setBetBusy(true);
            load();
          }}
        />
      )}
    </>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: T.space.lg, gap: T.space.md },
  // 로딩·에러 분기의 바깥 컨테이너 — 백버튼 줄과 중앙 블록을 위아래로 쌓는다.
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: T.space.xxl },
  // 백버튼만 있는 줄 — 좌우 20은 헤더(content lg + header xs)와 같은 시작선이다.
  backRow: { flexDirection: 'row', paddingHorizontal: T.space.xl, paddingTop: T.space.lg },
  // 화면 전체를 차지하는 에러/빈 상태 헤드라인은 T.text.title(26/800) — 그룹 탭·리그와 같은 위계.
  // 카드 안 빈 상태(emptyNoticeText)는 caption을 유지한다.
  errorTitle: { ...T.text.title, color: T.ink, textAlign: 'center' },
  errorDesc: { ...T.text.body, color: T.inkSub, marginTop: T.space.xs, textAlign: 'center' },
  // 인라인 재시도 = 48 / r16 / px xxl — 그룹 탭·공지 화면과 같은 값(§G-4)
  retryBtn: {
    marginTop: T.space.lg,
    minHeight: 48,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.xxl,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  retryText: { ...T.text.label, color: T.white },

  // 재조회 실패 인라인 배너 — 문구는 그룹 화면 공통 s.notice 규격(caption/dangerInk),
  // 재시도 링크는 '모두보기'와 같은 accent 링크 규격(§G-4).
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bannerText: { ...T.text.caption, color: T.dangerInk },
  bannerRetry: { ...T.text.caption, color: T.accent },

  // 헤더 블록만 좌우 20(T.space.xl) — 홈·리그·전체 탭의 화면 제목과 시작선을 맞춘다.
  // content는 16(T.space.lg)이라 차이 4pt를 여기서 더한다(리그도 헤더 xl / 리스트 lg).
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.space.xs,
  },
  // 라우트 진입의 백버튼 — 그룹 만들기·공지 화면과 같은 32/r16/white/border 규격.
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: T.space.sm,
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  title: { ...T.text.title, color: T.ink, flexShrink: 1 },
  count: { ...T.text.caption, color: T.inkSub, fontVariant: ['tabular-nums'] },
  moreBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
  },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: T.space.xs,
  },
  sectionTitle: { ...T.text.label, color: T.ink },
  // '모두보기' — 홈의 '자세히' 링크와 같은 규격(label + chevron 11). 터치 타깃은 hitSlop 12로 보강.
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  moreLink: { ...T.text.label, color: T.accent },
  // 섹션 헤더의 '+' — 헤더 ⋯ 버튼(34)보다 한 단 작은 원형. 터치 타깃은 hitSlop 12로 보강.
  addBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accentBg,
  },

  // 챌린지 내역 링크 — 섹션 꼬리의 4차 위계(카드보다 옅게, 오른쪽 정렬 + 셰브런).
  historyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 2,
    marginTop: T.space.sm,
    paddingVertical: T.space.xs,
  },
  historyLinkText: { ...T.text.caption, fontWeight: '600', color: T.inkMuted },

  noticeList: { gap: T.space.sm },
  noticeCard: {
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.lg,
    gap: 2,
  },
  noticeTitle: { ...T.text.label, color: T.ink },
  noticeDate: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  emptyNotice: {
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.paperAlt,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: T.space.xl,
    paddingHorizontal: T.space.lg,
  },
  emptyNoticeText: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },
  // 조회 실패는 빈 상태와 같은 컨테이너를 쓰되 색·아이콘으로 갈라 놓는다 —
  // 읽어야만 구분되면 '아직 없음'과 '못 받음'이 같은 화면으로 보인다. 에러 색은 앱 관행대로 dangerInk.
  emptyErrorRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  emptyErrorText: { ...T.text.caption, color: T.dangerInk },
  writeBtn: {
    minHeight: 40,
    paddingVertical: T.space.xs,
    paddingHorizontal: T.space.xl,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  writeText: { ...T.text.label, color: T.white },

  // 로딩 자리표시자 묶음 — 바깥 s.content가 패딩을 주므로 블록 간 간격만 s.content와 맞춘다.
  skeletonBody: { gap: T.space.md },

  grid: { gap: T.space.md },
  gridRow: { flexDirection: 'row', gap: T.space.md },
  gridPad: { flex: 1 },
  inviteTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.xs,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: T.borderDark,
    borderRadius: 14,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.sm,
  },
  inviteTileOff: { borderColor: T.border, backgroundColor: T.paperAlt },
  inviteTileText: { ...T.text.caption, color: T.accent },
  inviteTileTextOff: { color: T.inkMuted },
});
