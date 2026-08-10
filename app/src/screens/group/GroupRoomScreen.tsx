import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useUser } from '@/store/UserContext';
import { getAuthSessionGeneration, triggerLogout } from '@/services/api';
import { useCoins } from '@/store/CoinContext';
import {
  deleteChallenge,
  getAnnouncements,
  getChallenges,
  getGroupDetail,
  getMyChallengeResults,
  groupErrorCode,
} from '@/services/groupApi';
import {
  logGroupChallengeResultClosed,
  logGroupChallengeResultShown,
  logGroupInviteShared,
  logGroupRoomViewed,
} from '@/services/analyticsEvents';
import { issueInviteLink } from '@/services/inviteLinkApi';
import { todayStrKst } from '@/utils/localDate';
import type {
  GroupAnnouncementResponse,
  GroupChallengeResponse,
  GroupDetailMemberResponse,
  GroupDetailResponse,
  GroupSummaryResponse,
  MyChallengeResultEntry,
} from '@/types/dto/group';
import type { V2RootStackParamList } from '@/navigation/types';
import { buildInviteShareMessage } from './inviteShare';
import { fmtNoticeDate } from './noticeDate';
import { settledSignatureOf } from './lastSettledView';
import {
  filterUnseenChallengeResults,
  markChallengeResultSeen,
  pickChallengeResults,
  type ChallengeResultCandidate,
} from './challengeResult';
import BetSheet from './components/BetSheet';
import ChallengeCard, { type BetSheetMode } from './components/ChallengeCard';
import ChallengeComposeSheet from './components/ChallengeComposeSheet';
import ChallengeResultModal from './components/ChallengeResultModal';
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
      return ['내기를 열 수 없어요', '지금은 내기를 이용할 수 없어요. 잠시 후 다시 시도해주세요.'];
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
      '최신 상태예요. 참가하려면 다시 열어주세요.',
    ];
  }
  // 참가 모드에서는 구버전 응답(undefined)도 이 검사에 함께 걸린다 — live가 null로 뭉개지면서
  // '내기가 바뀌었어요'로 닫히기 때문에 따로 분기를 두지 않는다.
  if (live === null || live.betId !== sheet.betId) {
    return ['내기가 바뀌었어요', '최신 내기로 다시 열어주세요.'];
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
  // 챌린지 종료 푸시가 지목한 챌린지(GROMO-1088) — 진입 직후 이 챌린지의 결과 모달을 자동으로 연다.
  // 딥링크 진입에만 실린다(목록 탭 진입은 undefined). 자세한 규칙은 아래 focusPendingRef 주석.
  focusChallengeId?: string;
  // 탭 진입점이 가진 요약(getMyGroups[0]) — 상세 응답 도착 전 헤더를 먼저 그리는 용도(선택).
  summary?: GroupSummaryResponse;
  // 그룹 나가기 성공 시 호출 — 부모(GroupScreen)가 재조회해 빈 상태로 되돌린다.
  onLeft: () => void;
  // 초대 시트가 이 화면 위에 떠 있는가 — 떠 있으면 이 화면이 소유한 챌린지 만들기 시트를
  // 내린다(아래 이펙트 주석 참고).
  inviteOpen?: boolean;
  // 라우트로 push된 경우에만 전달 — 헤더 좌측에 원형 백버튼을 세운다.
  // 루트 스택이 headerShown:false라 네이티브 헤더가 없고, 탭바도 없어
  // 미전달이면 목록으로 돌아갈 명시 경로가 0개가 된다(앱 관행: 스택 화면은 백버튼 자가 렌더).
  onBack?: () => void;
}

export default function GroupRoomScreen({
  groupId,
  focusChallengeId,
  summary,
  onLeft,
  inviteOpen,
  onBack,
}: GroupRoomScreenProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { userId } = useUser();
  // 잔액은 CoinContext가 정본이다 — 여기서는 '서버가 정산했다'를 감지했을 때만 다시 받는다.
  const { refresh: refreshCoins } = useCoins();

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
  // 챌린지 결과 모달 큐 — load()가 /me/challenge-results(참가자 스코프, N53)에서 미노출분을
  // 골라 채운다. 맨 앞 한 장만 띄우고, 닫으면 다음 장으로(가드 키가 세션 단위라 큐도 그 단위).
  const [resultQueue, setResultQueue] = useState<ChallengeResultCandidate[]>([]);

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
  // 그룹방 방문 계측(group_room_viewed)을 그룹당 1회로 묶는 기준 — 마지막으로 발행한 groupId.
  // 새로고침·포그라운드 복귀 재조회·같은 방 재포커스에선 재발행하지 않고, 그룹을 바꾸면 다시 발행한다.
  const roomViewedGroupIdRef = useRef<string | null>(null);
  // 지금 떠 있는 결과 모달의 노출 시각·키 — dwell_ms 계산과 노출 이벤트/가드 1회 실행용.
  const resultShownAtRef = useRef<number | null>(null);
  const resultShownKeyRef = useRef<string | null>(null);
  // ── 챌린지 종료 푸시가 지목한 결과(GROMO-1088) ──
  // focusPendingRef = 아직 큐에 올리지 못한 대상. 큐에 실린 순간 비운다(1회 소비) —
  // 비우지 않으면 포커스·포그라운드 복귀·당겨서 새로고침이 부르는 재조회마다 사용자가 닫은
  // 모달이 다시 뜬다(1회 가드를 일부러 건너뛰는 대상이라 가드가 막아 주지 못한다).
  // 반대로 **아직 결과가 없으면(집계 전) 소비하지 않는다** — 창형은 앱 진입이 사용분 업로드를
  // 트리거하는 구조라 진입 직후엔 전원 미확정일 수 있고, 그때는 다음 조회가 이어받아야 한다.
  // focusKeyRef = 지금 무장한 대상의 신원(그룹+챌린지). 라우트 파라미터가 갈리면(같은 방에서
  // 다른 챌린지 푸시를 탭) 다시 무장한다.
  const focusPendingRef = useRef<string | null>(null);
  const focusKeyRef = useRef<string | null>(null);
  // 탈퇴 감지(MEMBER_ONLY 또는 NOT_FOUND scope 재확인 완료) 시 이탈(onLeft)을 결과 모달 소비
  // 뒤로 미루는 플래그
  // (PR #566 리뷰 ② — 탈퇴자도 자기 정산 결과는 본다, N53·C8). 마지막 결과를 닫을 때 발화한다.
  const pendingLeaveRef = useRef(false);
  const resultQueueRef = useRef<ChallengeResultCandidate[]>([]);
  const activeUserIdRef = useRef(userId);
  activeUserIdRef.current = userId;
  // 지목 변경을 재조회로 잇기 위한 직전 값 — 아래 이펙트 주석 참고.
  const focusSeenRef = useRef<{ groupId: string; challengeId?: string }>({
    groupId,
    challengeId: focusChallengeId,
  });

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
    // 이전 그룹의 결과 모달도 즉시 접는다 — 전환 중 남의 그룹 결과가 새 화면 위에 뜨면 안 된다.
    resultShownAtRef.current = null;
    resultShownKeyRef.current = null;
    pendingLeaveRef.current = false; // 이전 그룹의 이탈 유예도 함께 접는다(새 그룹 판단은 새로)
    resultQueueRef.current = [];
    setResultQueue([]);
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

  // 딥링크 대상 무장 — 렌더 중 조정(위 groupId 리셋과 같은 패턴). 그룹이 바뀌어도 신원이 갈리므로
  // 이전 그룹의 챌린지를 새 방에서 찾는 일은 없다.
  const focusKey = focusChallengeId ? `${groupId}:${focusChallengeId}` : null;
  if (focusKeyRef.current !== focusKey) {
    focusKeyRef.current = focusKey;
    focusPendingRef.current = focusChallengeId ?? null;
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
    // 같은 userId를 유지하는 게스트→소셜 승격도 인증 세대는 바뀐다. 이 요청 묶음이 시작한 세대를
    // 박제해, 이전 세션의 NOT_FOUND 재확인이 새 세션을 로그아웃/이탈시키지 않게 한다.
    const requestSessionGeneration = getAuthSessionGeneration();
    // 기준일은 서버 판정 축과 같은 KST다(GROMO-1219) — 진행률·내기·결과의 날짜 판정이 전부
    // 서버 KST 고정이라, 기기 로컬 날짜를 보내면 비KST 기기에서 하루 어긋난 조회가 된다.
    const date = todayStrKst();
    setError(false);
    // 결과 모달의 소스는 참가자 스코프 /me/challenge-results 1콜이다(GROMO-1279 · N53) —
    // 어제 date 챌린지 재조회로 결과를 역산하던 구 구조는 폐기(challengeResult.ts 파일 주석).
    // 게스트(userId 없음)는 참가 회차가 있을 수 없어 부르지 않는다. 실패해도 화면 무영향(allSettled).
    const [detailResult, noticeResult, challengeResult, myResultsResult] = await Promise.allSettled(
      [
        getGroupDetail(groupId, date),
        getAnnouncements(groupId),
        getChallenges(groupId, date),
        userId ? getMyChallengeResults() : Promise.resolve<MyChallengeResultEntry[]>([]),
      ],
    );
    if (seq !== requestSeqRef.current) return false;

    // ── 챌린지 결과 모달 후보 산출(GROMO-1279) — 성공한 조회만으로 계산한다(부분 실패 무영향). ──
    // 상세 처리보다 **먼저** 둔다(PR #566 리뷰 ②) — 탈퇴자(MEMBER_ONLY)의 onLeft 판단이 "지금
    // 보여줄 결과가 있는가"를 알아야 하기 때문. 큐는 참가자 스코프라 멤버십과 무관하게 성립한다.
    // Array.isArray 방어: allSettled는 mock·구서버의 비정상 값도 fulfilled로 통과시킨다.
    // '보여줄 결과가 없다'와 **'있는지 모르겠다'**를 가르는 값(codex 후속 리뷰 P2). 결과 조회
    // 실패·가드 읽기 실패가 여기 해당한다 — 모르는 채로 탈퇴자를 방에서 내보내면(onLeft) 다른
    // 소속 그룹이 없는 사용자에겐 '다음 조회'가 없어 정산 결과를 영영 못 본다(N53·C8).
    let resultsUnknown = false;
    const resultEntries =
      myResultsResult.status === 'fulfilled' && Array.isArray(myResultsResult.value)
        ? myResultsResult.value
        : null;
    if (resultEntries !== null && userId) {
      const candidates = pickChallengeResults(resultEntries);
      // 성공 응답은 **빈 배열도 정본**이다(codex 후속 리뷰 P2). 예전엔 후보가 0건이면 분기를
      // 통째로 건너뛰어 기존 큐가 그대로 남았다 — 다른 시트에 가려 대기하던 결과가 그 사이
      // 서버에서 제외되면(다른 기기에서 챌린지 삭제 → FR-44-4로 응답에서 빠짐) 시트를 닫는
      // 순간 **서버가 이미 지운 과거 결과**가 뜬다. 삭제 환불 푸시와 겹치면 같은 사건 이중
      // 통지(N48이 금지하는 형태)가 된다. 실패 응답은 여기 오지 않는다(resultEntries === null) —
      // 네트워크 실패로 대기 결과를 잃지 않는다.
      let next: ChallengeResultCandidate[] = [];
      // 가드를 읽어 판정까지 마쳤는가 — null(읽기 실패)이면 '빈 정본'으로 반영하지 않는다.
      let unseenKnown = true;
      if (candidates.length > 0) {
        const unseen = await filterUnseenChallengeResults(userId, candidates);
        // 가드 조회를 기다리는 사이 새 조회·그룹 전환이 끼어들었으면 이 결과는 낡았다.
        if (seq !== requestSeqRef.current) return false;
        if (unseen === null) unseenKnown = false;
        else {
          // 푸시가 지목한 챌린지(GROMO-1088)는 같은 challengeId의 **최신 1건이 unseen일 때만**
          // 큐 앞자리에 세우고 소비한다(PR #566 리뷰 ③). SESSION_END 푸시는 정산 **전**에 오므로
          // 방금 끝난 회차는 아직 이 큐에 없다 — 이때 seen 우회로 지난 회차를 재노출하며 지목까지
          // 소비하면, 정작 새 결과가 정산돼 도착했을 때 지목이 죽어 있다. 매치가 전부 본 결과뿐이면
          // 소비하지 않고 유지한다("후보에 없으면 소비하지 않는다"와 같은 원리 — 다음 재조회가
          // 이어받는다). candidates는 sessionDate 내림차순이라 첫 매치가 최신이다.
          const focusId = focusPendingRef.current;
          let focused: ChallengeResultCandidate[] = [];
          if (focusId) {
            const newest = candidates.find((c) => c.challengeId === focusId);
            if (newest && unseen.some((u) => u.sessionId === newest.sessionId)) {
              focused = [newest];
              focusPendingRef.current = null;
            }
          }
          next = [
            ...focused,
            ...unseen.filter((c) => !focused.some((f) => f.sessionId === c.sessionId)),
          ];
        }
      }
      // 가드를 못 읽었으면 큐를 건드리지 않는다 — '빈 정본'은 판정에 성공했을 때만 성립한다.
      if (!unseenKnown) {
        resultsUnknown = true;
      } else {
        // 떠 있는 모달(맨 앞)은 유지한다. ref도 같은 tick에 갱신해 NOT_FOUND 재확인을 기다리는
        // 동안 사용자가 마지막 결과를 닫아도 이탈 판단이 과거 큐를 읽지 않게 한다.
        const previousHead = resultQueueRef.current[0];
        const resolvedQueue =
          previousHead && resultShownKeyRef.current === previousHead.sessionId
            ? [
                previousHead,
                ...next.filter((candidate) => candidate.sessionId !== previousHead.sessionId),
              ]
            : next;
        resultQueueRef.current = resolvedQueue;
        setResultQueue(resolvedQueue);
      }
    } else if (userId) {
      // 결과 조회 자체가 실패했다 — 역시 '없다'가 아니라 '모른다'다(게스트는 참가 회차가
      // 있을 수 없어 해당 없음). 큐는 그대로 두고 아래 탈퇴 분기가 이탈을 미룬다.
      resultsUnknown = true;
    }

    let resolvedDetail: GroupDetailResponse | null =
      detailResult.status === 'fulfilled' ? detailResult.value : null;

    // 멤버십 부재가 확정돼도 참가자 스코프 결과가 남아 있으면 먼저 소비한다(N53·C8).
    // 결과 유무를 모르는 회차에는 성공 이탈로 단정하지 않고 다음 명시 재시도에 남긴다.
    const convergeMembershipAbsence = (): boolean => {
      if (resultQueueRef.current.length > 0 || resultShownKeyRef.current !== null) {
        pendingLeaveRef.current = true;
        setError(true);
        return true;
      }
      if (resultsUnknown) {
        setError(true);
        return true;
      }
      onLeft();
      return false;
    };

    if (detailResult.status === 'rejected') {
      const code = groupErrorCode(detailResult.reason);
      if (code === 'MEMBER_ONLY') {
        // 서버가 활성 인증 뒤 멤버십 부재를 확인한 사후조건이라 직접 수렴할 수 있다.
        if (!convergeMembershipAbsence()) return false;
      } else if (code === 'NOT_FOUND') {
        // NOT_FOUND는 활성 사용자 부재와 그룹 부재가 같은 code다. 인증을 재확인하고, 유효한
        // 세션이면 최신 detail/전체 목록 scope가 결론을 낼 때만 방 유지 또는 이탈로 수렴한다.
        const resolution = await resolveGroupRoomNotFound({ groupId, date, userId: userId ?? '' });
        if (
          seq !== requestSeqRef.current ||
          activeUserIdRef.current !== userId ||
          getAuthSessionGeneration() !== requestSessionGeneration
        ) {
          return false;
        }
        if (resolution.kind === 'detail') {
          resolvedDetail = resolution.detail;
        } else if (resolution.kind === 'membership_absent') {
          if (!convergeMembershipAbsence()) return false;
        } else {
          if (resolution.kind === 'session_recovery') triggerLogout();
          // session_recovery는 최신 요청·계정 확인 뒤 공통 로그아웃 경계를 시작한다. 트리가
          // 남아 있는 동안에도 성공 복귀로 보이지 않게 안전 오류를 둔다.
          setError(true);
        }
      } else {
        setError(true);
      }
    }

    if (resolvedDetail !== null) {
      // 최신 상세 성공은 현재 멤버십을 다시 증명한다. 앞선 실패에서 결과 모달 뒤 이탈을
      // 예약했더라도 낡은 예약으로 방을 나가지 않게 해제한다.
      pendingLeaveRef.current = false;
      setDetail(resolvedDetail);
      loadedDateRef.current = date;
      // 그룹방이 실제로 보여진(상세 로드 성공) 순간 방문을 계측한다 — 그룹당 1회.
      if (roomViewedGroupIdRef.current !== groupId) {
        roomViewedGroupIdRef.current = groupId;
        logGroupRoomViewed({ group_id: groupId });
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
  }, [groupId, onLeft, userId, refreshCoins]);

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
      };
    }, [reload]),
  );

  // 지목이 바뀌면 재조회한다(GROMO-1088, 코덱스 리뷰) — 이 방이 이미 떠 있는 채로 **같은 그룹의
  // 다른 챌린지** 푸시를 탭하면 라우트 파라미터만 갈리고 포커스는 유지돼 useFocusEffect가 다시
  // 돌지 않는다. 그러면 새 지목이 다음 수동 새로고침까지 전혀 처리되지 않는다.
  // (백그라운드에서 탭한 경우는 AppState 복귀가 재조회를 부르지만, 포그라운드 탭엔 그 계기가 없다.)
  // ⚠️ 그룹이 함께 바뀌었으면 발사하지 않는다 — load 신원이 갈려 useFocusEffect가 이미 다시 돈다.
  useEffect(() => {
    const prev = focusSeenRef.current;
    focusSeenRef.current = { groupId, challengeId: focusChallengeId };
    if (prev.groupId !== groupId) return;
    if (prev.challengeId === focusChallengeId || !focusChallengeId) return;
    reload();
  }, [groupId, focusChallengeId, reload]);

  // 포그라운드 복귀 — 포커스는 유지된 채라 useFocusEffect가 다시 돌지 않는다.
  // 화면이 떠 있으면 재조회하고, 자정을 넘겼으면 포커스 여부와 무관하게 새 date로 다시 부른다.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (focusedRef.current || loadedDateRef.current !== todayStrKst()) reload();
    });
    return () => sub.remove();
  }, [reload]);

  // 초대 링크가 도착하면 이 화면이 소유한 시트를 전부 내린다 — 초대 시트와 이 시트들은 모두
  // SheetShell asModal(RN 네이티브 Modal)이라 동시에 뜨면 딤이 2겹으로 포개지고, 플랫폼별 모달
  // 표시 순서에 따라 초대 프리뷰가 가려질 수도 있다. GroupScreen이 링크 수신 시 찾기 시트를
  // 내리는 것과 같은 배타 처리이고, 링크로 들어온 초대가 우선이라 이쪽을 접는다.
  // 챌린지 만들기 시트도 같이 내린다 — 폼은 세그먼트·칩 2필드(기본값 있음)라 다시 여는 비용이
  // 거의 없고, 자유 입력이 없어 되돌릴 수 없는 손실이 생기지 않는다.
  useEffect(() => {
    if (!inviteOpen) return;
    setComposeOpen(false);
  }, [inviteOpen]);

  // 당겨서 새로고침 — 스피너는 **무조건** 내린다. '최신 응답일 때만' 내리면
  // 진행 중 다른 조회(포그라운드 복귀·삭제 후 재조회 등)가 끼어들어 seq가 밀리는 순간
  // 내릴 주체가 사라져 스피너가 영구히 돈다. 늦게 끝난 요청이 내려도 사용자 피해는 없다.
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

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
    Alert.alert(stale[0], stale[1]);
  }, [betSheet, challenges, betChallenge]);

  // ── 챌린지 결과 모달(A3) ──
  // 다른 시트(⋯ 메뉴·만들기·내기·초대)가 떠 있으면 미룬다 — 전부 RN 네이티브 Modal이라 겹치면
  // 딤이 포개지고 표시 순서도 플랫폼 재량이다(초대 시트 배타 이펙트와 같은 이유). 큐는 상태로
  // 남아 있어 시트가 닫히면 그때 뜬다.
  const currentResult = resultQueue.length > 0 ? resultQueue[0] : null;
  const resultVisible = currentResult !== null && !inviteOpen && betSheet === null && !composeOpen;

  // 노출 이벤트 + 1회 가드 기록 — **모달이 실제로 뜬 순간** 결과당 1회.
  // 가드를 닫을 때 기록하면 모달이 떠 있는 사이의 재조회가 같은 결과를 큐에 또 넣는다.
  useEffect(() => {
    if (!resultVisible || currentResult === null) return;
    const key = currentResult.sessionId;
    if (resultShownKeyRef.current === key) return;
    resultShownKeyRef.current = key;
    resultShownAtRef.current = Date.now();
    // 가드 키는 계정 스코프다(IA §8) — userId 없이는 큐 자체가 만들어지지 않아(load의 userId
    // 가드) 여기 도달하지 않지만, 방어적으로 있을 때만 기록한다.
    if (userId) markChallengeResultSeen(userId, currentResult.sessionId, currentResult.date);
    // 정산 결과를 보여주는 순간 잔액도 맞춘다(PR #566 리뷰 ⑤) — 결과 큐가 그룹 무관 소스(N53)가
    // 되며 다른 그룹·ENDED 챌린지의 정산은 현재 방의 settledBetSignature가 감지하지 못한다.
    // 중복 호출 무해(서버 재조회일 뿐)·실패 무해(refreshCoins는 throw 없이 false — 다음 조회 재시도).
    refreshCoins();
    logGroupChallengeResultShown({
      // 소스가 /me/challenge-results로 바뀌며(N53) 미션 메타가 응답에 없다 — 대신 정산 결말을
      // 싣는다(무산·환불 노출도 이 이벤트가 세야 한다).
      status: currentResult.status,
      // null(미판정)은 파라미터를 아예 싣지 않는다 — false(미달성)와 뭉개지 않는다.
      achieved: currentResult.myAchieved ?? undefined,
      achiever_count: currentResult.achievers.length,
      member_count: currentResult.memberCount,
    });
  }, [resultVisible, currentResult, userId, refreshCoins]);

  const onResultClose = useCallback(() => {
    const shownAt = resultShownAtRef.current;
    resultShownAtRef.current = null;
    resultShownKeyRef.current = null;
    if (shownAt !== null) logGroupChallengeResultClosed({ dwell_ms: Date.now() - shownAt });
    setResultQueue((queue) => {
      const next = queue.slice(1);
      resultQueueRef.current = next;
      return next;
    });
    // 탈퇴 감지로 미뤄 둔 이탈(PR #566 리뷰 ②) — 마지막 결과를 닫는 순간 부모에게 넘긴다.
    // resultQueue.length는 이 콜백의 클로저 값(방금 닫은 장 포함)이라 1 이하 = 이번이 마지막.
    if (pendingLeaveRef.current && resultQueue.length <= 1) {
      pendingLeaveRef.current = false;
      onLeft();
    }
  }, [resultQueue.length, onLeft]);

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
      Alert.alert('초대 링크를 만들지 못했어요', '잠시 후 다시 시도해주세요.');
      return;
    }
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
    }
  }, [groupId, name]);

  const openNotice = useCallback(() => {
    navigation.navigate('GroupNotice', { groupId, canWrite: canWriteNotice });
  }, [navigation, groupId, canWriteNotice]);

  // 전환 뒤 늦게 도착한 실패 Alert가 지금 보고 있는 다른 그룹 화면 위에 뜨는 것을 막는다
  // (A-7, GROMO-1027·1028). 액션을 건 그룹(targetGroupId)이 여전히 화면에 떠 있을 때만 Alert를 낸다 —
  // renderedGroupIdRef는 렌더 중 groupId 리셋과 같은 기준(지금 그리고 있는 그룹).
  const alertIfCurrent = useCallback((targetGroupId: string, title: string, message: string) => {
    if (renderedGroupIdRef.current !== targetGroupId) return;
    Alert.alert(title, message);
  }, []);

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
          alertIfCurrent(groupId, '챌린지를 삭제하지 못했어요', '잠시 후 다시 시도해주세요.');
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

  // 상세 도착 전(로딩·에러) 분기에도 결과 모달은 그린다(PR #566 리뷰 ②) — 탈퇴자(MEMBER_ONLY)는
  // detail이 영영 없어서, 본문 분기에만 모달을 두면 참가자 스코프 결과 큐가 화면에 닿지 못한다.
  const resultModal =
    resultVisible && currentResult !== null ? (
      <ChallengeResultModal result={currentResult} onClose={onResultClose} />
    ) : null;

  // ── 최초 로딩 — 중앙 스피너(§5-4) ──
  if (loading && !detail) {
    return (
      <View style={s.fill}>
        {!!backButton && <View style={s.backRow}>{backButton}</View>}
        <View style={s.center}>
          <ActivityIndicator color={T.accent} />
        </View>
        {resultModal}
      </View>
    );
  }

  // ── 에러 + 다시 시도 ──
  // 탈퇴 유예(pendingLeaveRef) 중에는 이 화면이 결과 모달의 배경이다 — 전면 다크 모달 뒤라
  // 보이지 않고, 마지막 결과를 닫으면 onResultClose가 onLeft로 잇는다(PR #566 리뷰 ②).
  if (error && !detail) {
    return (
      <View style={s.fill}>
        {!!backButton && <View style={s.backRow}>{backButton}</View>}
        <View style={s.center}>
          <Text style={s.errorTitle}>그룹을 불러오지 못했어요</Text>
          <Text style={s.errorDesc}>잠시 후 다시 시도해주세요.</Text>
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.85} onPress={reload}>
            <Text style={s.retryText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
        {resultModal}
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
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.accent} />
        }
      >
        {/* ── 재조회 실패 배너 — 기존 데이터를 지우지 않고 '지금 보는 값이 옛것'임을 알린다 ── */}
        {error && !!detail && (
          <View style={s.banner}>
            <Text style={s.bannerText}>최신 정보를 불러오지 못했어요</Text>
            <TouchableOpacity onPress={reload} hitSlop={12} activeOpacity={0.7}>
              <Text style={s.bannerRetry}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 헤더 ── */}
        <View style={s.header}>
          {/* 라우트 진입에서만 — 규격은 그룹 만들기·공지 화면의 원형 백버튼과 같다(§5-1) */}
          {backButton}
          <View style={s.headerLeft}>
            <Text style={s.title} numberOfLines={1}>
              {name}
            </Text>
            {isPrivate && <Ionicons name="lock-closed" size={15} color={T.inkSub} />}
            <Text style={s.count}>
              {memberCount}/{maxMembers}
            </Text>
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
      </ScrollView>

      {/* 그룹방 하단바(F2 Part2) — ▶ FAB는 이 그룹의 집중 세션(그룹 페이지 기본)으로 진입시킨다. */}
      <GroupRoomBottomBar
        onFocusPress={() => navigation.navigate('FocusCategory', { initialGroupId: groupId })}
      />

      {/* ── 챌린지 만들기 시트(방장만) ── */}
      {/* '⋯' 메뉴와 같은 이유로 inviteOpen까지 본다 — 위 이펙트는 렌더 뒤에 돌아 한 프레임 동안
          두 Modal이 겹친다. */}
      {composeOpen && !inviteOpen && (
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

      {/* ── 챌린지 결과 모달(A3) — 큐 맨 앞 한 장. 닫으면 다음 결과로 넘어간다 ── */}
      {resultModal}
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
    height: 48,
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
    height: 40,
    paddingHorizontal: T.space.xl,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.accent,
  },
  writeText: { ...T.text.label, color: T.white },

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
