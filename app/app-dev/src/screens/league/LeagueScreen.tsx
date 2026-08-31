import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  LinearTransition,
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { FIXED_BOX_FONT_SCALE_MAX, T, withAlpha } from '@/constants/theme';
import { t } from '@/i18n';
import { springify } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { tierByLevel } from '@/constants/tiers';
import { useUser } from '@/store/UserContext';
import { useLeagueRanking } from './useLeagueRanking';
import { useGlobalRanking } from './useGlobalRanking';
import { useLeagueMeta } from './useLeagueMeta';
import { useLeagueLastResult } from './useLeagueLastResult';
import { useStagedRanking } from './useStagedRanking';
import { useFriends } from './useFriends';
import { usePinned } from './usePinned';
import type { V2RootStackParamList } from '@/navigation/types';
import { MY_USER_ID, type RankedMember } from './mock';
import { hms, fmtMinutes } from './format';
import { memberLiveSeconds } from '@/utils/liveFocus';
import type { FriendResponse } from '@/types/api';
import { RankRow } from './components/RankRow';
import { RankRowShell } from './components/RankRowShell';
import { LiveFocusTime } from './components/LiveFocusTime';
import { LeagueDeadline } from './components/LeagueDeadline';
import { MemberAvatar } from './components/MemberAvatar';
import { TierBadge } from './components/TierBadge';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
import { tabBarSafeBottom } from '@/components/tabBarLayout';
import { STORAGE_KEYS } from '@/types/storage';
import {
  logLeagueViewed,
  logLeagueTabChanged,
  logLeagueFilterSelected,
  logLeagueProfileOpened,
  logNudgeViewed,
  logNudgeTapped,
} from '@/services/analyticsEvents';

// 리그 메인 (탭 2번째) — 포디움형 레이아웃.
// 리그 탭: 최상단 세그먼트 + 좌 마감/우 제목(탭=리그 선택 드롭다운)
//   + Top3 포디움 + 4위~ 랭킹 + 플로팅 '내 순위' 행(GROMO-1614 — 하단 탭바 위 상시 표시,
//     스크롤로 내 자리가 화면에 들어오면 그 칸에 도킹, 지나치면 상단에 붙는 양방향 클램프.
//     전체 리그 100위 밖은 전역 순위(GET /league/me/rank)로 목록 끝 ⋯ 아래에 내 행을 편입.
//     구 sticky 상단 스트립은 이 행으로 대체·폐기)
//   + '핀한 사람만' 필터(나+핀만, 나 대비 시간 차 표시). 하단 시트는 폐기.
//   - 시안의 시험 칩은 카테고리(온보딩 16)가 많아 폐기 — 제목 드롭다운으로 전체/내 시험/다른 시험 전환.
//   - 내 순위는 리스트와 같은 파생값 하나만 쓴다(순위 기준 이원화 방지).
// 친구 탭: 친구 검색·추가 엔트리 + 친구 2열 그리드(카드 탭 → 프로필 상세 FriendProfile).
// 친구 목록·받은 요청 수(./useFriends)·핀(./usePinned)은 실데이터.

// 리그 드롭다운의 '전체' 항목 식별자 — 표시용 라벨이 아니라 서버 직군 라벨(exam)과 대조하는
// 센티널이라 번역하지 않는다. 화면 표시는 league.home.allLeague.
const LEAGUE_ALL = '전체';
// 플로팅 '내 순위' 행이 리스트 뷰포트 위/아래 가장자리에서 띄우는 여백(GROMO-1614)
const FLOAT_INSET = 8;
// 포디움 메달 그라데이션 (1·2·3위 — 골드/실버/브론즈, 밝은 쪽→진한 쪽)
const MEDAL_GRAD = [T.medalGrad.gold, T.medalGrad.silver, T.medalGrad.bronze];

// 포디움 칸 — 순위가 바뀌면 칸끼리 자리를 맞바꾼다(GROMO-1381).
// 칸 자체가 터치 대상이라 래퍼를 새로 끼우지 않고 TouchableOpacity를 그대로 애니메이션
// 컴포넌트로 만든다(노드 수 불변 → testID 셀렉터 계약 유지).
// ⚠️ 랭킹 행의 rankSwap을 여기 쓰지 않는다. rankSwap은 **세로 목록** 전용이다 — 위/아래 이동을
//    보고 좌우로 비껴가게 만드는데, 포디움은 가로 배치라 두 칸이 이미 좌우로 지나간다.
//    여기 필요한 것은 자리 이동을 그대로 따라가는 기본 트랜지션 + 같은 스프링 토큰이다.
const AnimatedPodiumCol = Animated.createAnimatedComponent(TouchableOpacity);
// 랭킹 행(rankSwap)과 같은 스프링 토큰. 모듈 상수로 두어 매 렌더 새 빌더가 만들어지지 않게 한다.
// (springify 헬퍼는 빌더 **인스턴스**를 받는다 — LinearTransition.createInstance()와 같은 값이다.)
const PODIUM_LAYOUT = springify(new LinearTransition());

type TabKey = 'league' | 'friend';
const TAB_LABEL_KEY: Record<TabKey, string> = {
  league: 'league.home.tabLeague',
  friend: 'league.home.tabFriend',
};

export default function LeagueScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  // '동작 줄이기' 게이트 — 포디움 재정렬 트랜지션을 끈다(랭킹 행은 RankRowShell이 따로 쥔다).
  const m = useMotion();

  const [tab, setTab] = useState<TabKey>('league');
  // 현재 선택한 리그 — null이면 기본(내 시험). 제목 드롭다운에서 전체/다른 시험으로 전환
  const [leagueFilter, setLeagueFilter] = useState<string | null>(null);
  const [leagueMenuOpen, setLeagueMenuOpen] = useState(false);
  // 핀한 사람만 보기 — 리스트를 나+핀으로 좁히고 나 대비 차이를 붙인다
  const [pinnedOnly, setPinnedOnly] = useState(false);
  // 핀 실데이터 — 포커스마다 서버(GET /pins) 재조회 + 낙관적 토글(./usePinned).
  // 프로필 상세·친구 탭과 같은 서버 상태를 공유해 화면 간 불일치가 없다.
  const { pinned, togglePin, loaded: pinnedLoaded, refetch: refetchPinned } = usePinned();

  const listRef = useAnimatedRef<Animated.ScrollView>();
  // 랭킹 리스트 콘텐츠 안 내 행(내 자리)의 y — 플로팅 행 탭 스크롤 목적지(JS)
  const myRowY = useRef(0);
  // ── 플로팅 '내 순위' 행 (GROMO-1614) — 스크롤 위치 추적은 전부 UI 스레드(shared value)로,
  //    JS 리렌더는 플로팅↔도킹 경계를 넘는 순간에만 일어난다(GROMO-1572 매 프레임 리렌더 회피).
  const scrollY = useSharedValue(0);
  // 내 자리(포디움 블록/내 행)의 콘텐츠 y. -1은 미실측 — 실측 전엔 플로팅을 띄우지 않는다.
  const myRowYsv = useSharedValue(-1);
  // 도킹 목적지의 높이 — 위쪽 이탈 판정용. 행이면 플로팅 행과 같지만 포디움 블록이면 훨씬 크다.
  const dockHsv = useSharedValue(62);
  // 플로팅 행 자신의 높이(하단 클램프용) — 실측 전 근사값. 도킹 목적지 높이와 분리한다:
  // 내가 Top3면 목적지는 포디움 블록이라 행보다 훨씬 크다.
  const floatHsv = useSharedValue(62);
  // 리스트 뷰포트 높이(shared) — 클램프 하한 계산용
  const listHsv = useSharedValue(0);

  // 내 티어·마감 스케줄 실데이터 (GROMO-538) — 티어 조회는 여기 한 곳에서만.
  const { tier, deadlineAt, refetch: refetchMeta } = useLeagueMeta();
  // 미확인 주간 마감 결과가 있으면 결과 연출로 진입 (GROMO-831) — 포커스마다 last-result 조회
  useLeagueLastResult();
  // 리그 랭킹 실데이터 — 홈 상단바와 공유. 멤버 티어는 서버 응답 실값(GROMO-748).
  const {
    ranking,
    myLeagueLabel,
    intendedLeagueLabel,
    mySeconds,
    error: rankingError,
    refetch: refetchRanking,
  } = useLeagueRanking();
  // '전체' 탭 전용 진짜 전역 랭킹(직군 리스트 재사용 금지 — GROMO-644).
  // myGlobalRank = 내 전역 순위(top-100 밖 포함) — 100위 밖 플로팅 행의 순위 원천(GROMO-1614).
  const {
    ranking: globalRanking,
    myGlobalRank,
    myGlobalSeconds,
    error: globalError,
    refetch: refetchGlobal,
  } = useGlobalRanking();

  // 진입(포커스)마다 증가 — 넛지 노출을 '진입당 1회'로 발화시키는 트리거. 랭킹은 비동기 로드라
  // 포커스 시점엔 myIdx가 아직 -1일 수 있어, 데이터가 채워진 뒤 이 seq 기준으로 딱 1회만 쏜다.
  const [focusSeq, setFocusSeq] = useState(0);
  const rankNudgeSeq = useRef(-1);

  // 리그 화면 진입 계측 (GROMO-538) — 포커스마다 1회.
  useFocusEffect(
    useCallback(() => {
      logLeagueViewed();
      setFocusSeq((n) => n + 1);
    }, []),
  );
  // 내 실 서버 ID — 랭킹 행의 userId는 MY_USER_ID 센티널로 치환돼 있어(useLeagueRanking)
  // 내 프로필 진입 시 본인 통계 조회용 실 ID가 따로 필요하다.
  const { userId: myUserId, nickname: myNickname } = useUser();

  // 친구 목록·받은 요청 수 — 실데이터(포커스마다 재조회)
  const {
    friends,
    receivedCount,
    loaded: friendsLoaded,
    error: friendsError,
    refetch: refetchFriends,
  } = useFriends();

  // ── 당겨서 새로고침 (GROMO-887) — 탭별로 그 탭 데이터만 재조회한다. refreshing 상태도 탭별로
  //    분리 — 하나를 공유하면 리그 새로고침 중 친구 탭으로 넘어갔을 때 실행된 적 없는 친구 탭에
  //    가짜 스피너가 돈다(코드리뷰 반영). 스피너는 살짝 늦게 내려 깜빡임을 막는다.
  const [refreshingLeague, setRefreshingLeague] = useState(false);
  const [refreshingFriend, setRefreshingFriend] = useState(false);
  // 리그 탭: 티어·마감 + 직군 랭킹 + 전역 랭킹 + 핀을 함께 갱신.
  const onRefreshLeague = useCallback(() => {
    setRefreshingLeague(true);
    Promise.all([refetchMeta(), refetchRanking(), refetchGlobal(), refetchPinned()]).finally(() =>
      setTimeout(() => setRefreshingLeague(false), 500),
    );
  }, [refetchMeta, refetchRanking, refetchGlobal, refetchPinned]);
  // 친구 탭: 친구 목록·받은 요청 + 핀 배지를 갱신.
  const onRefreshFriend = useCallback(() => {
    setRefreshingFriend(true);
    Promise.all([refetchFriends(), refetchPinned()]).finally(() =>
      setTimeout(() => setRefreshingFriend(false), 500),
    );
  }, [refetchFriends, refetchPinned]);

  // GROMO-658: 친구 그리드 정렬 — 핀한 친구 우선, 같은 그룹 안에선 오늘 집중 시간 내림차순.
  // 핀 여부는 배지와 동일 기준(공유 핀 상태 usePinned 우선, 미로딩 시 응답 isPinned 폴백)으로
  // 파생해야 랭킹 탭에서 핀 토글한 직후에도 순서가 배지와 일치한다.
  const isFriendPinned = (f: FriendResponse) => (pinnedLoaded ? pinned.has(f.userId) : f.isPinned);
  const sortedFriends = [...friends].sort(
    (a, b) =>
      Number(isFriendPinned(b)) - Number(isFriendPinned(a)) ||
      (b.focusTimeMinutes ?? 0) - (a.focusTimeMinutes ?? 0),
  );

  // 현재 리그 — 기본은 내 직군, 드롭다운 선택이 있으면 그 리그.
  // '전체'는 진짜 전역 랭킹(globalRanking), 직군은 내 직군 랭킹을 라벨로 필터한다(GROMO-644).
  // 직군 조회가 실패해 라벨을 못 받았을 땐 의도 라벨로 내 리그를 유지한다 — 전역 조회 성공에
  // 묻혀 직군 실패가 조용히 전체 리그로 대체되지 않게(GROMO-922 코드리뷰 반영). 단 유지된
  // 목록이 하나도 없을 때만 — 전역 폴백(GROMO-657) 목록을 실패 후에도 유지 중이면(label=null·
  // exam='') 의도 라벨로 필터하는 순간 전부 걸러져 멀쩡한 목록이 실패 안내로 바뀐다(코드리뷰
  // 반영). 빈 성공의 전역 폴백 자체는 error가 아니라서 기존대로 전체 리그.
  const myLabel =
    myLeagueLabel ?? (rankingError && ranking.length === 0 ? intendedLeagueLabel : null);
  const filter = leagueFilter ?? myLabel ?? LEAGUE_ALL;
  const isAll = filter === LEAGUE_ALL;
  // 재정렬은 **한 칸씩** 재생한다 (정본 §6). 서버가 여러 칸을 한 번에 바꿔 넣어도 중간 순서를
  // 거쳐 가도록 useStagedRanking이 순서를 늦추고, 한 칸마다 **기록도 함께** 단계적으로 올린다
  // (정본 "바로 위 사람을 앞지르는 값이라야 상승이 납득된다"). 마지막 단계는 서버 최종값이다.
  // 포디움·리스트가 같은 파생값을 쓰므로 두 영역의 재정렬 호흡이 자동으로 맞는다.
  const visibleRanking = useStagedRanking(
    isAll ? globalRanking : ranking.filter((r) => r.exam === filter),
  );
  // 지금 보는 리스트의 조회 실패 여부 — 전체 탭은 전역 랭킹, 직군 탭은 직군 랭킹 기준 (GROMO-922)
  const visibleRankingError = isAll ? globalError : rankingError;
  // 실패 안내 표시 여부 — 실패했고 보여줄 목록도 없을 때만(기존 목록이 있으면 목록 유지)
  const showRankingError = visibleRankingError && visibleRanking.length === 0;
  const title = isAll ? t('league.home.allLeague') : t('league.home.leagueTitle', { name: filter });

  // 전환 가능한 리그 — 전체 + 내 직군(있을 때). 직군 랭킹은 단일 직군이라 라벨은 최대 하나.
  const leagues = [LEAGUE_ALL, ...(myLabel ? [myLabel] : [])];

  const myTier = tierByLevel(tier.tierLevel ?? 1);

  // 내 순위 — 위 리스트와 같은 파생값에서만 계산
  const myIdx = visibleRanking.findIndex((r) => r.userId === MY_USER_ID);
  const myMember = myIdx >= 0 ? visibleRanking[myIdx] : null;
  // 전체 리그 100위 밖일 때의 실제 전역 순위(GROMO-1614). 직군 뷰에는 대응 API가 없어 null —
  // 그 경우 플로팅 행 대신 순위 없는 안내 카드를 띄운다(아래 JSX).
  const outOfListRank = isAll && myIdx < 0 ? myGlobalRank : null;
  // 100위 밖 행의 시간 — 순위와 같은 스냅샷(me/rank 응답)이 우선. 순위 따로·시간 따로 짝지으면
  // 세션 조회 실패 조합에서 정확한 순위 옆에 0/이전 시간이 붙는다(코덱스 리뷰). 응답에 시간이
  // 없을 때만 세션 합산 권위값(mySeconds)으로 보충한다.
  const outOfListSeconds = myGlobalSeconds ?? mySeconds;
  // ⚠️ 격차(핀 모드 나 대비 차이) 계산은 **화면에 그려지는 값과 같은 축**으로 한다 — 두 겹이다.
  //    ① 단계값: 재정렬을 한 칸씩 재생하는 동안 목록의 기록은 단계값인데 여기만 서버
  //       최종값(mySeconds)을 쓰면 아직 이전 순위가 보이는 프레임에서 차이가 음수가 된다(codex 리뷰).
  //    ② 라이브 경과: 서버 정렬이 '확정 집계 + 진행 경과' 기준이 되면서(GROMO-1606) 확정값
  //       끼리 빼면 같은 문제가 다시 생긴다 — 행 표시(LiveFocusTime)가 단계값 + 경과이므로
  //       격차도 memberLiveSeconds(단계값 + 경과)끼리 뺀다(GROMO-1606 코덱스 리뷰).
  //    시계는 렌더 시점 스냅샷 — 격차는 보조 수치라 초 단위 틱은 걸지 않는다(스테이징·재조회
  //    렌더마다 갱신). 목록 밖(top-100 밖)이면 애초에 단계화 대상이 아니므로 내 세션 합산
  //    값(mySeconds) 그대로다 — 그때도 유효한 값이다(useLeagueRanking 주석).
  const gapNow = Date.now();
  const myLiveSeconds = myIdx >= 0 ? memberLiveSeconds(visibleRanking[myIdx], gapNow) : mySeconds;

  // 포디움(Top3) / 리스트(4위~ 또는 핀한 사람만)
  const top3 = visibleRanking.slice(0, 3);
  const showPodium = !pinnedOnly && top3.length > 0;
  // '핀한 사람만': 핀한 사람이 하나라도 있으면 나+핀을 함께 보여주고(나 대비 시간 차),
  // 하나도 없으면 나만 뜨지 않도록 비운다 (GROMO-636).
  const hasPinned = visibleRanking.some((r) => pinned.has(r.userId));
  const pinnedRows = visibleRanking.filter((r) => r.userId === MY_USER_ID || pinned.has(r.userId));
  const listRows = pinnedOnly ? (hasPinned ? pinnedRows : []) : visibleRanking.slice(3);

  // ── 플로팅 '내 순위' 행 (GROMO-1614) ─────────────────────────────────────
  // 도킹 목적지가 있는가 — 내 자리(포디움 칸/목록 내 행/100위 밖 편입 행)가 리스트에 실재할 때만
  // 플로팅↔도킹 전환이 성립한다. 핀 모드는 목록이 나+핀 요약이라 플로팅을 걸지 않는다.
  const hasDockTarget = !pinnedOnly && (myIdx >= 0 || outOfListRank != null);

  // 넛지 노출 — 내 실제 순위가 **실제로 그려질 때만**(rank) 진입당 1회. 데이터 존재만 보면
  // 핀 모드(내 행 미편입·플로팅 비활성)로 재진입해도 노출로 집계돼 전환율이 왜곡된다(코덱스 리뷰).
  // 랭킹 비동기 로드로 순위가 뒤늦게 확정돼도 focusSeq 기준으로 딱 1회만 발화(중복 방지).
  const myRankShown = hasDockTarget || (pinnedOnly && hasPinned && myIdx >= 0);
  useEffect(() => {
    if (tab === 'league' && myRankShown && rankNudgeSeq.current !== focusSeq) {
      rankNudgeSeq.current = focusSeq;
      logNudgeViewed({ type: 'rank' });
    }
  }, [tab, myRankShown, focusSeq]);

  // 플로팅 상태(JS) — UI 스레드 reaction이 경계를 넘는 순간에만 밀어 넣는다. 도킹 중에는
  // 오버레이를 아예 떼어 실제 행이 터치를 받게 한다(경계에서 두 위치가 일치해 이음새 없음).
  const [floating, setFloating] = useState(false);
  const floatBottomPad = tabBarSafeBottom(insets.bottom) + FLOAT_INSET;
  const onListScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  // 리그 탭 재진입 시 스크롤 좌표 리셋 — 탭 전환으로 ScrollView가 언마운트됐다 다시 마운트되면
  // 네이티브 오프셋은 0인데 shared value는 이전 값을 유지해, 첫 onScroll 전까지 플로팅 판정이
  // 어긋난다(코덱스 리뷰). 마운트 직후의 오프셋 0에 맞춰 초기화한다.
  useEffect(() => {
    if (tab === 'league') scrollY.value = 0;
  }, [tab, scrollY]);
  // 내 자리 실측 — 포디움 블록(내가 Top3일 때)·목록 내 행·100위 밖 편입 행이 공유한다.
  // 포디움은 칸이 아니라 블록 단위다: 칸의 y는 부모(podium View) 기준이라 콘텐츠 좌표가 아니고,
  // 블록이 보이면 내 칸도 보이므로 '포디움 상단이 뷰포트에 있으면 도킹'으로 충분하다.
  const onMyLayout = (e: LayoutChangeEvent) => {
    myRowY.current = e.nativeEvent.layout.y;
    myRowYsv.value = e.nativeEvent.layout.y;
    dockHsv.value = e.nativeEvent.layout.height;
  };
  useAnimatedReaction(
    () => {
      if (myRowYsv.value < 0 || listHsv.value <= 0) return false; // 미실측 — 판정 보류
      const raw = myRowYsv.value - scrollY.value;
      // 위쪽 이탈은 목적지 '하단'이 (상단에 붙을) 오버레이 하단보다 위로 지나갔는가로 본다 —
      // 행(목적지 높이 == 플로팅 높이)은 상단 여백 판정과 동일하게 이어지고, 포디움처럼 목적지가
      // 더 큰 경우엔 콘텐츠 최상단(y≈0)에 있어도 플로팅이 뜨지 않는다(코덱스 리뷰 — Top3에서
      // 첫 화면부터 포디움 위에 겹치던 문제).
      const topGone = raw + dockHsv.value < FLOAT_INSET + floatHsv.value - 1;
      return topGone || raw > listHsv.value - floatBottomPad - floatHsv.value + 1;
    },
    (now, prev) => {
      if (now !== prev) runOnJS(setFloating)(now);
    },
    [floatBottomPad],
  );
  // 오버레이 위치 — 내 자리의 뷰포트 y를 위/아래 가장자리로 클램프. 경계 근처에선 raw≈클램프라
  // 마운트/언마운트 순간 실제 행과 정확히 겹쳐 '자리에 딱 들어가는' 연출이 된다.
  const floatStyle = useAnimatedStyle(() => {
    const raw = myRowYsv.value - scrollY.value;
    const maxY = listHsv.value - floatBottomPad - floatHsv.value;
    return { transform: [{ translateY: Math.min(Math.max(raw, FLOAT_INSET), maxY) }] };
  }, [floatBottomPad]);

  function scrollToMyRow() {
    listRef.current?.scrollTo({ y: Math.max(myRowY.current - FLOAT_INSET, 0), animated: true });
  }

  // 드롭다운에서 리그 선택 — 최상단(포디움)부터 보여주고, 내 행이 화면 밖이면 자동 스크롤 예약
  function selectLeague(league: string) {
    // 이미 선택된 리그를 다시 누르면 계측 생략(탭 전환 가드와 동일 — 중복 발화 방지).
    if (league !== filter) logLeagueFilterSelected({ is_all: league === LEAGUE_ALL });
    // 여기 있던 LayoutAnimation.configureNext는 걷어냈다 (GROMO-1381 / 컨트랙트 §7).
    // LayoutAnimation은 JS 스레드·전역 스코프라 이 화면의 형제 뷰(포디움·스트립)까지 함께
    // 끌고 가고, 아래 랭킹 행이 쓰는 Reanimated 레이아웃 트랜지션과 같은 트리에서 충돌한다.
    // 목록 재배치 연출은 행 껍데기(RankRowShell)의 layout 트랜지션이 대신 맡는다.
    setLeagueFilter(league);
    setLeagueMenuOpen(false);
    listRef.current?.scrollTo({ y: 0, animated: false });
  }

  function togglePinnedOnly() {
    // LayoutAnimation 제거 — 사유는 selectLeague 주석과 같다(컨트랙트 §7).
    setPinnedOnly((v) => !v);
  }

  // 프로필 진입 — 내 행/타인 모두 프로필 상세(FriendProfile)로 이동해 포맷을 통일한다(GROMO-940,
  // 구 ProfileSheet 오버레이 폐기). 내 행은 isMe로 진입해 비교 없이 내 그래프만 표시.
  function openProfile(member: RankedMember) {
    const isMe = member.userId === MY_USER_ID;
    logLeagueProfileOpened({ is_me: isMe });
    // 프로필 순위 = 지금 보고 있는 목록의 순위 그대로 전달 — 서버 프로필 rank(아레나 내 순위)와
    // 스코프가 달라 숫자가 어긋나므로, 탭한 숫자와 일치시킨다 (GROMO-685).
    const rank = visibleRanking.indexOf(member) + 1;
    if (isMe) {
      // 랭킹 행의 userId는 MY_USER_ID 센티널이라 실 서버 ID를 넘긴다 — 본인 통계 조회용.
      if (!myUserId) return;
      navigation.navigate('FriendProfile', {
        userId: myUserId,
        nickname: member.nickname,
        tierLevel: member.tierLevel,
        isFriend: false,
        isMe: true,
        rank: rank > 0 ? rank : undefined,
        rankLabel: filter,
      });
      return;
    }
    navigation.navigate('FriendProfile', {
      userId: member.userId,
      nickname: member.nickname,
      tierLevel: member.tierLevel,
      // 친구 여부는 랭킹 응답의 서버 판정 값(GROMO-1630) — 구 클라 대조(친구 목록 Set) 제거,
      // 미배포 서버 호환으로 optional 폴백 false.
      isFriend: member.isFriend ?? false,
      // 핀 초기값 — 공유 핀 상태(usePinned)가 로딩된 경우에만 전달(낙관 상태 포함 최신값).
      // 미로딩이면 undefined로 넘겨 프로필의 GET /pins 재동기화에 맡긴다 — false를 넘기면
      // 프로필이 확정값으로 믿고 서버 동기화를 건너뛰어 핀한 유저가 꺼짐으로 보인다(PR 291 리뷰 반영).
      isPinned: pinnedLoaded ? pinned.has(member.userId) : undefined,
      rank: rank > 0 ? rank : undefined,
      rankLabel: filter,
    });
  }

  // 100위 밖 편입 행(전체 리그) 탭 — 목록에 원본 멤버가 없어 openProfile을 못 태우므로
  // 같은 isMe 경로로 직접 진입한다. 순위는 전역 순위(outOfListRank)를 그대로 전달.
  function openMyProfileOutOfList() {
    if (!myUserId || outOfListRank == null) return;
    logLeagueProfileOpened({ is_me: true });
    navigation.navigate('FriendProfile', {
      userId: myUserId,
      nickname: myNickname || t('common.me'),
      tierLevel: tier.tierLevel ?? 1,
      isFriend: false,
      isMe: true,
      rank: outOfListRank,
      rankLabel: filter,
    });
  }

  // 첫 진입 사용법 안내(GROMO-652) — 캐릭터가 리그 경쟁·티어·친구 탭을 차례로 설명
  const segmentRef = useRef<View | null>(null);
  const headerRef = useRef<View | null>(null);
  const guideSteps: GuideStep[] = [
    {
      text: t('league.home.guide1'),
      character: require('@/assets/character_hi.png'),
    },
    {
      text: t('league.home.guide2'),
      character: require('@/assets/character_study.png'),
      anchor: headerRef,
    },
    {
      text: t('league.home.guide3'),
      character: require('@/assets/character_happy.png'),
    },
    {
      text: t('league.home.guide4'),
      character: require('@/assets/character_happy.png'),
      anchor: segmentRef,
    },
    {
      text: t('league.home.guide5'),
      character: require('@/assets/character_study.png'),
    },
  ];

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── 최상단: 리그/친구 세그먼트 ── */}
      <View
        style={[s.segmentWrap, tab === 'friend' ? s.segmentWrapFriend : null]}
        ref={segmentRef}
        collapsable={false}
      >
        <View style={s.segment}>
          {(['league', 'friend'] as TabKey[]).map((k) => {
            const on = tab === k;
            return (
              <TouchableOpacity
                key={k}
                style={[s.segBtn, on ? s.segBtnOn : null]}
                onPress={() => {
                  if (tab !== k) logLeagueTabChanged({ tab: k });
                  setTab(k);
                }}
                activeOpacity={0.8}
              >
                <Text style={[s.segText, on ? s.segTextOn : null]}>{t(TAB_LABEL_KEY[k])}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── 헤더: 좌상단 마감 카운트다운 + 우측 제목(탭=리그 선택 드롭다운) ── */}
      {tab === 'league' && (
        <View style={s.header} ref={headerRef} collapsable={false}>
          {/* 마감·제목은 한 줄에 나란히 놓이는데 둘 다 고정 배치라, 접근성 배율에서 그대로
              커지면 서로를 파고든다(코덱스 리뷰) — 상한을 걸고 마감 쪽은 줄어들게 둔다.
              (상한 적용은 LeagueDeadline 안. 1초 틱을 이 화면 밖으로 뺀 이유는 그 파일 주석 참고) */}
          <LeagueDeadline deadlineAt={deadlineAt} style={s.deadline} />
          <TouchableOpacity
            style={s.headerToggle}
            activeOpacity={0.7}
            onPress={() => setLeagueMenuOpen(true)}
          >
            <Text style={s.headerTitle} maxFontSizeMultiplier={FIXED_BOX_FONT_SCALE_MAX}>
              {title}
            </Text>
            <Ionicons name="chevron-down" size={17} color={T.inkSub} />
          </TouchableOpacity>
        </View>
      )}

      {tab === 'league' ? (
        <View style={s.listWrap}>
          <Animated.ScrollView
            ref={listRef}
            style={s.list}
            onLayout={(e) => {
              listHsv.value = e.nativeEvent.layout.height;
            }}
            onScroll={onListScroll}
            scrollEventThrottle={16}
            contentContainerStyle={{ paddingBottom: tabBarSafeBottom(insets.bottom) + 16 }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshingLeague}
                onRefresh={onRefreshLeague}
                tintColor={T.accent}
              />
            }
          >
            {/* ── Top3 포디움 (2위·1위·3위 배치, 1위 가운데 상단) ──
               칸의 key는 userId라 순위가 바뀌면 **같은 노드가 자리를 옮긴다** → layout 트랜지션이
               성립한다(메달 번호·1위 여백은 자리에 붙는 값이라 즉시 갈아끼워진다).
               ⚠️ 포디움↔목록 **경계를 넘는 이동(3위↔4위)은 이번 범위 밖이다.** 4위 행과 3위 칸은
                  서로 다른 컴포넌트라 노드가 언마운트/리마운트되고, 레이아웃 트랜지션은 살아남은
                  노드에만 성립한다. 같은 노드로 잇자면 포디움과 목록을 한 트리로 합쳐야 하는데
                  그건 이 배치가 감당할 구조 변경이 아니다 — 그 경우는 지금처럼 툭 바뀐다(후속). */}
            {showPodium && (
              /* 내가 Top3면 포디움 블록 자체가 플로팅 행의 도킹 목적지다(onMyLayout 주석 참고) */
              <View style={s.podium} onLayout={myIdx >= 0 && myIdx < 3 ? onMyLayout : undefined}>
                {[1, 0, 2]
                  .filter((i) => top3[i] != null)
                  .map((i) => {
                    const member = top3[i];
                    const isMe = member.userId === MY_USER_ID;
                    const first = i === 0;
                    return (
                      <AnimatedPodiumCol
                        key={member.userId}
                        layout={m.css(PODIUM_LAYOUT)}
                        style={[s.podiumCol, first ? s.podiumColFirst : null]}
                        activeOpacity={0.85}
                        onPress={() => openProfile(member)}
                      >
                        <View style={s.podiumMedalCol}>
                          {first && (
                            <MaterialCommunityIcons
                              name="crown"
                              size={18}
                              color={T.medal.gold}
                              style={s.podiumCrown}
                            />
                          )}
                          <LinearGradient
                            colors={MEDAL_GRAD[i]}
                            start={{ x: 0.2, y: 0 }}
                            end={{ x: 0.8, y: 1 }}
                            style={[
                              s.podiumMedal,
                              first ? s.podiumMedalFirst : null,
                              { shadowColor: MEDAL_GRAD[i][1] },
                            ]}
                          >
                            <Text style={s.podiumMedalNum} allowFontScaling={false}>
                              {i + 1}
                            </Text>
                          </LinearGradient>
                        </View>
                        <View style={[s.podiumAvatarWrap, isMe ? s.podiumAvatarWrapMe : null]}>
                          <MemberAvatar size={first ? 60 : 48} />
                          {isMe && (
                            <View style={s.podiumMeBadge} pointerEvents="none">
                              <Text style={s.podiumMeBadgeText} allowFontScaling={false}>
                                {t('common.me')}
                              </Text>
                            </View>
                          )}
                        </View>
                        <View style={s.podiumNameRow}>
                          <TierBadge level={member.tierLevel} size={16} />
                          <Text
                            style={[s.podiumName, isMe ? s.podiumNameMe : null]}
                            numberOfLines={1}
                          >
                            {member.nickname}
                          </Text>
                          {member.isFocusing && <View style={s.podiumFocusDot} />}
                        </View>
                        {/* GROMO-810: Top3 도 집중 중이면 과목 + 초 단위 라이브 (랭킹 행과 동일 규칙) */}
                        {member.isFocusing && member.focusStartedAt != null ? (
                          <>
                            <Text style={s.podiumFocusTag} numberOfLines={1}>
                              {member.focusTagName != null
                                ? t('league.rankRow.focusingTag', { tag: member.focusTagName })
                                : t('league.rankRow.focusing')}
                            </Text>
                            <LiveFocusTime
                              baseSeconds={member.totalFocusSeconds}
                              focusStartedAt={member.focusStartedAt}
                              format={hms}
                              style={[s.podiumTime, s.podiumTimeFocusing]}
                              maxFontSizeMultiplier={FIXED_BOX_FONT_SCALE_MAX}
                            />
                          </>
                        ) : (
                          // 포디움 열은 width 100 고정 — 넘치면 옆 포디움·핀 버튼과 겹친다(코덱스 리뷰)
                          <Text
                            style={s.podiumTime}
                            maxFontSizeMultiplier={FIXED_BOX_FONT_SCALE_MAX}
                          >
                            {hms(member.totalFocusSeconds)}
                          </Text>
                        )}
                        {!isMe && (
                          <TouchableOpacity
                            style={s.podiumPin}
                            hitSlop={15}
                            onPress={() => togglePin(member.userId)}
                          >
                            <MaterialCommunityIcons
                              name={pinned.has(member.userId) ? 'pin' : 'pin-outline'}
                              size={15}
                              color={pinned.has(member.userId) ? T.accent : T.inkFaint}
                            />
                          </TouchableOpacity>
                        )}
                      </AnimatedPodiumCol>
                    );
                  })}
              </View>
            )}

            {/* ── 섹션 헤더: 랭킹 라벨 + 핀한 사람만 필터 ── */}
            <View style={s.sectionRow}>
              <Text style={s.sectionLabel}>
                {pinnedOnly ? t('league.home.sectionPinned') : t('league.home.sectionRanking')}
              </Text>
              <TouchableOpacity
                style={[s.pinChip, pinnedOnly ? s.pinChipOn : null]}
                activeOpacity={0.8}
                onPress={togglePinnedOnly}
              >
                <MaterialCommunityIcons
                  name={pinnedOnly ? 'pin' : 'pin-outline'}
                  size={13}
                  color={pinnedOnly ? T.white : T.inkSub}
                />
                <Text style={[s.pinChipText, pinnedOnly ? s.pinChipTextOn : null]}>
                  {t('league.home.pinnedOnly')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* ── 랭킹 리스트 (기본: 4위~ / 핀 모드: 나+핀, 나 대비 차이) ──
               행 껍데기(RankRowShell)가 곧 원래의 행 컨테이너다 — 진입 시차와 재정렬 궤적을
               쥔다. key가 userId라 데이터 순서만 바뀌면 노드는 그대로 살아 자리를 옮긴다 —
               재정렬 연출이 성립하는 전제다(인덱스 키였다면 성립하지 않는다).
               ⚠️ 껍데기가 진입 시차를 **마운트 시점 인덱스**로 고정하는 이유는 그 파일 주석 참고.
               순위 숫자는 자리에 붙는 값이라 visibleRanking 순서에서 매번 다시 매긴다. */}
            {listRows.map((row, i) => {
              const isMe = row.userId === MY_USER_ID;
              return (
                <RankRowShell
                  key={row.userId}
                  index={i}
                  // 내 행 실측 = 플로팅 행의 도킹 목적지. 구 '진입 시 내 행 자동 스크롤'은 제거 —
                  // 내 순위가 항상 플로팅으로 보이므로 첫 화면은 포디움부터 시작한다(GROMO-1614).
                  onLayout={isMe && !pinnedOnly ? onMyLayout : undefined}
                >
                  <RankRow
                    // 기본 목록은 visibleRanking.slice(3)이라 자리 번호가 인덱스로 나온다(i=0 → 4위).
                    // 핀 모드만 원본에서 골라 담은 부분집합이라 원 위치를 찾아야 하는데, 그쪽은
                    // 행 수가 핀 개수로 묶여 있다. 전 모드에서 indexOf를 돌리면 100행 × 100탐색이
                    // 돼 목록이 찰수록 제곱으로 비싸진다(GROMO-1572).
                    rank={pinnedOnly ? visibleRanking.indexOf(row) + 1 : i + 4}
                    nickname={row.nickname}
                    tierLevel={row.tierLevel}
                    seconds={row.totalFocusSeconds}
                    isMe={isMe}
                    pinned={pinned.has(row.userId)}
                    // 행 표시가 단계값 + 라이브 경과이므로 비교도 같은 축이어야 한다(위 주석).
                    deltaSeconds={
                      pinnedOnly && !isMe
                        ? memberLiveSeconds(row, gapNow) - myLiveSeconds
                        : undefined
                    }
                    isFocusing={row.isFocusing}
                    focusStartedAt={row.focusStartedAt}
                    focusTagName={row.focusTagName}
                    onPress={() => openProfile(row)}
                    onPin={isMe ? undefined : () => togglePin(row.userId)}
                  />
                </RankRowShell>
              );
            })}
            {/* ── 전체 리그 100위 밖: 목록 끝에 실제 전역 순위로 내 행 편입 — 플로팅 행의 도킹
               목적지(GROMO-1614). 전역 순위를 모르면(조회 실패·미배정) 편입 없이 안내 카드만. ── */}
            {!pinnedOnly && outOfListRank != null && visibleRanking.length > 0 && (
              <>
                <Text style={s.listEllipsis}>⋯</Text>
                <View onLayout={onMyLayout}>
                  <RankRow
                    rank={outOfListRank}
                    nickname={myNickname || t('common.me')}
                    tierLevel={tier.tierLevel ?? 1}
                    seconds={outOfListSeconds}
                    isMe
                    onPress={openMyProfileOutOfList}
                  />
                </View>
              </>
            )}
            {/* 조회 실패 + 보여줄 목록 없음 — "아무도 없는 리그" 빈 상태로 오인되지 않게 에러+재시도로
               분기 (GROMO-922, 친구 탭 GROMO-621과 동일 패턴). 실패여도 기존 목록이 있으면 유지. */}
            {visibleRanking.length === 0 &&
              (showRankingError ? (
                <View style={s.friendErrorWrap}>
                  <Text style={s.emptyLeague}>{t('league.home.rankingLoadFailed')}</Text>
                  <TouchableOpacity
                    style={s.retryBtn}
                    activeOpacity={0.8}
                    onPress={isAll ? refetchGlobal : refetchRanking}
                  >
                    <Text style={s.retryBtnText}>{t('common.retry')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={s.emptyLeague}>{t('league.home.emptyLeague')}</Text>
              ))}
            {/* 실패 안내가 떠 있을 땐 숨긴다 — "불러오지 못했어요"와 동시에 뜨면 모순(코드리뷰 반영) */}
            {pinnedOnly && !showRankingError && listRows.length === 0 && (
              <Text style={s.emptyLeague}>{t('league.home.emptyPinned')}</Text>
            )}

            {/* ── 내 티어 스트립 → 티어 안내 (시안에 진입점이 없어 둔 임시 진입점) ── */}
            <TouchableOpacity
              style={s.tierStrip}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('TierGuide')}
            >
              <Image source={myTier.image} style={s.tierStripImg} />
              <Text style={s.tierStripText}>{t('league.home.myTier', { name: myTier.name })}</Text>
              <Ionicons name="chevron-forward" size={13} color={T.inkMuted} />
            </TouchableOpacity>
          </Animated.ScrollView>

          {/* ── 플로팅 '내 순위' 행 (GROMO-1614) — 내 자리가 뷰포트 밖일 때만 마운트되어 위/아래
             가장자리에 붙는다. 도킹 중에는 떼어내 실제 행이 그대로 보이고 터치를 받는다.
             경계에서 두 위치가 일치하므로 마운트/언마운트가 '자리에 들어가는' 연출이 된다. */}
          {hasDockTarget && floating && (
            <Animated.View
              style={[s.floatRowWrap, floatStyle]}
              onLayout={(e) => {
                floatHsv.value = e.nativeEvent.layout.height;
              }}
            >
              <RankRow
                rank={myMember != null ? myIdx + 1 : outOfListRank}
                nickname={myMember?.nickname ?? (myNickname || t('common.me'))}
                tierLevel={myMember?.tierLevel ?? tier.tierLevel ?? 1}
                seconds={myMember?.totalFocusSeconds ?? outOfListSeconds}
                isMe
                isFocusing={myMember?.isFocusing}
                focusStartedAt={myMember?.focusStartedAt}
                focusTagName={myMember?.focusTagName}
                style={s.floatRowShadow}
                onPress={() => {
                  // 유도 수치(순위) 탭 = 넛지 유도 성공 — 내 자리로 스크롤해 도킹시킨다.
                  logNudgeTapped({ type: 'rank' });
                  scrollToMyRow();
                }}
              />
            </Animated.View>
          )}

          {/* ── 순위를 모르는 100위 밖(직군 뷰 전부 · 전역 순위 조회 실패) — 안내 카드.
             구 상단 스트립의 문구를 하단 플로팅 위치로 옮긴 것. 직군 뷰에선 탭=전체 리그 이동. */}
          {!pinnedOnly && myIdx < 0 && outOfListRank == null && visibleRanking.length > 0 && (
            <View style={[s.floatNoticeWrap, { bottom: floatBottomPad }]}>
              <TouchableOpacity
                style={s.floatNotice}
                activeOpacity={0.85}
                disabled={isAll}
                onPress={() => selectLeague(LEAGUE_ALL)}
              >
                <MaterialCommunityIcons name="pin-outline" size={14} color={T.accentDeep} />
                <Text style={s.floatNoticeText}>
                  {isAll ? t('league.home.outOfRankAll') : t('league.home.outOfRankExam')}
                </Text>
                {!isAll && <Ionicons name="chevron-forward" size={13} color={T.accentDeep} />}
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : (
        /* ── 친구 탭 — 검색·추가 엔트리 + 친구 2열 그리드 (시안 "친구 탭") ── */
        <ScrollView
          style={s.list}
          contentContainerStyle={{ paddingBottom: tabBarSafeBottom(insets.bottom) + 20 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshingFriend}
              onRefresh={onRefreshFriend}
              tintColor={T.accent}
            />
          }
        >
          <TouchableOpacity
            style={s.addCard}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('FriendAdd')}
          >
            <View style={s.addIcon}>
              <Ionicons name="person-add-outline" size={19} color={T.accentDeep} />
            </View>
            <View style={s.addTextCol}>
              <Text style={s.addTitle}>{t('league.home.addFriendTitle')}</Text>
              <Text style={s.addSub}>
                {t('league.home.receivedRequests', { count: receivedCount })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={T.inkMuted} />
          </TouchableOpacity>

          {/* 조회 실패 + 보여줄 목록 없음 — "친구 0명" 빈 상태로 오인되지 않게 에러+재시도로 분기 (GROMO-621).
               실패여도 기존 목록이 있으면 그대로 유지해서 보여준다. */}
          {friendsError && friends.length === 0 ? (
            <View style={s.friendErrorWrap}>
              <Text style={s.emptyLeague}>{t('league.home.friendsLoadFailed')}</Text>
              <TouchableOpacity style={s.retryBtn} activeOpacity={0.8} onPress={refetchFriends}>
                <Text style={s.retryBtnText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={s.friendCount}>
                {t('league.home.myFriendsPrefix')}{' '}
                <Text style={s.friendCountNum}>{friends.length}</Text>
                {t('league.home.myFriendsSuffix')}
              </Text>
              {/* 실친구 목록 — 주간 집중시간은 응답에 없어 미표기(TODO: 백엔드 협의 후 복원) */}
              <View style={s.friendGrid}>
                {sortedFriends.map((f) => {
                  // 핀 배지·정렬 모두 동일한 파생 핀 상태(isFriendPinned)를 쓴다 — 위 정렬 주석 참조.
                  const isPinned = isFriendPinned(f);
                  return (
                    <TouchableOpacity
                      key={f.userId}
                      style={[s.friendCard, f.isFocusing && s.friendCardFocusing]}
                      activeOpacity={0.85}
                      onPress={() =>
                        navigation.navigate('FriendProfile', {
                          userId: f.userId,
                          nickname: f.nickname,
                          tierLevel: f.tierLevel ?? 1,
                          isFriend: true,
                          isPinned,
                        })
                      }
                    >
                      {isPinned && (
                        <View style={s.friendPinBadge}>
                          {/* 랭킹·필터 칩·프로필과 동일한 압정 아이콘 — Ionicons 핀은 모양이 달라 혼동 (GROMO-845) */}
                          <MaterialCommunityIcons name="pin" size={11} color={T.white} />
                        </View>
                      )}
                      <MemberAvatar size={48} />
                      <Text style={s.friendName} numberOfLines={1}>
                        {f.nickname}
                      </Text>
                      <View style={s.friendTierRow}>
                        <TierBadge level={f.tierLevel ?? 1} size={18} />
                        <Text style={s.friendTier}>{tierByLevel(f.tierLevel ?? 1).name}</Text>
                      </View>
                      {/* 오늘 집중 시간 (GROMO-658) — 집중 중이면 과목 + 초 단위 라이브,
                           아니면 누적분 고정 표시(랭킹·라이브와 동일한 디지털 표기, 분 원본이라 초는
                           :00 고정 — GROMO-845). 서버 확장 전 응답엔 필드가 없어 0분·미집중 취급 */}
                      {f.isFocusing ? (
                        <>
                          {f.focusTagName != null && (
                            <View style={s.friendFocusingRow}>
                              <View style={s.friendFocusingDot} />
                              <Text style={s.friendFocusTag} numberOfLines={1}>
                                {f.focusTagName}
                              </Text>
                            </View>
                          )}
                          {/* 카드 폭이 '48%' 고정인데 HH:MM:SS는 공백이 없어 줄바꿈이 안 된다 —
                              배율을 안 묶으면 글자 중간에서 깨진다(코드리뷰). 정적 분기의
                              fmtMinutes도 'HH:MM:00'이라 같은 상한을 걸어야 두 분기 높이가 맞는다
                              (코덱스 리뷰 — '공백에서 접힌다'고 적었던 건 틀렸다). */}
                          <LiveFocusTime
                            baseSeconds={(f.focusTimeMinutes ?? 0) * 60}
                            focusStartedAt={f.focusStartedAt ?? null}
                            style={s.friendFocusTimeLive}
                            maxFontSizeMultiplier={FIXED_BOX_FONT_SCALE_MAX}
                          />
                        </>
                      ) : (
                        <Text
                          style={[
                            s.friendFocusTime,
                            (f.focusTimeMinutes ?? 0) > 0 && s.friendFocusTimeOn,
                          ]}
                          maxFontSizeMultiplier={FIXED_BOX_FONT_SCALE_MAX}
                        >
                          {fmtMinutes(f.focusTimeMinutes ?? 0)}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
                {friends.length % 2 === 1 && <View style={s.friendCardGhost} />}
              </View>
              {/* 빈 상태는 성공 응답(빈 배열)일 때만 — 첫 로드 전엔 미표시 */}
              {friendsLoaded && friends.length === 0 && (
                <Text style={s.emptyLeague}>{t('league.home.emptyFriends')}</Text>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* ── 리그 선택 드롭다운 — 헤더 제목 탭 시 (전체/내 시험/다른 시험) ── */}
      <Modal
        visible={leagueMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLeagueMenuOpen(false)}
      >
        <TouchableOpacity
          style={s.menuBackdrop}
          activeOpacity={1}
          onPress={() => setLeagueMenuOpen(false)}
        >
          <View style={[s.menuCard, { top: insets.top + 48 }]}>
            <ScrollView bounces={false}>
              {leagues.map((l) => {
                const on = l === filter;
                return (
                  <TouchableOpacity
                    key={l}
                    style={s.menuRow}
                    activeOpacity={0.8}
                    onPress={() => selectLeague(l)}
                  >
                    <Text style={[s.menuText, on ? s.menuTextOn : null]}>
                      {l === LEAGUE_ALL
                        ? t('league.home.allLeague')
                        : t('league.home.leagueTitle', { name: l })}
                    </Text>
                    {l === myLabel && <Text style={s.menuMine}>{t('league.home.myExam')}</Text>}
                    {on && <Ionicons name="checkmark" size={15} color={T.accent} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 첫 진입 사용법 안내(GROMO-652) */}
      <TabGuideOverlay storageKey={STORAGE_KEYS.guideLeague} steps={guideSteps} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },

  // 마감 문구와 제목이 한 줄에 못 들어가면 접는다 — 안 접으면 줄어들 수 있는 쪽(마감)만
  // 말줄임돼 정작 남은 시간이 사라진다(코드리뷰).
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    rowGap: T.space.xs,
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.md,
    paddingBottom: T.space.md,
  },
  // flexShrink/maxWidth 둘 다 필요 — headerTitle만 줄여 봐야 부모가 안 줄면 소용없고,
  // header의 flexWrap은 토글을 다음 줄로 옮길 뿐 토글 자체를 줄이지 않는다(코덱스 리뷰).
  headerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    flexShrink: 1,
    maxWidth: '100%',
  },
  headerTitle: { ...T.text.title, color: T.ink, flexShrink: 1 },
  deadline: { ...T.text.caption, color: T.inkSub, flexShrink: 1 },

  // 리그 선택 드롭다운
  menuBackdrop: { flex: 1, backgroundColor: withAlpha(T.night.bottom, 0.25) },
  menuCard: {
    position: 'absolute',
    right: 20,
    minWidth: 172,
    maxHeight: 330,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: T.space.sm,
    shadowColor: T.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.md,
  },
  menuText: { ...T.text.label, flex: 1, color: T.ink },
  menuTextOn: { color: T.accent, fontWeight: '800' },
  menuMine: { ...T.text.caption, color: T.inkSub },

  segmentWrap: { paddingHorizontal: T.space.xl, paddingTop: T.space.sm },
  segmentWrapFriend: { paddingBottom: 2 },
  segment: {
    flexDirection: 'row',
    backgroundColor: T.track,
    borderRadius: 12,
    padding: T.space.xs,
    gap: T.space.xs,
  },
  segBtn: { flex: 1, paddingVertical: T.space.sm, borderRadius: 9, alignItems: 'center' },
  segBtnOn: {
    backgroundColor: T.white,
    shadowColor: T.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segText: { ...T.text.label, color: T.inkSub },
  segTextOn: { color: T.ink, fontWeight: '700' },

  // 리스트 래퍼 — 플로팅 '내 순위' 행(absolute)의 배치 기준(GROMO-1614)
  listWrap: { flex: 1 },
  list: { flex: 1, paddingHorizontal: T.space.lg },

  // Top3 포디움 — 2위·1위·3위, 1위 가운데가 크게
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: T.space.lg,
    paddingTop: T.space.xs,
    paddingBottom: T.space.md,
  },
  // width 100은 FIXED_BOX_FONT_SCALE_MAX의 근거다 — 바꾸면 constants/theme.test.ts도 같이 고칠 것.
  podiumCol: { alignItems: 'center', gap: T.space.xs, width: 100 },
  podiumColFirst: { marginBottom: T.space.lg },
  // 메달 — 왕관(1위)+그라데이션 원형 배지를 세로로 쌓는다
  podiumMedalCol: { alignItems: 'center' },
  podiumCrown: { marginBottom: -3 },
  podiumMedal: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: T.white,
    // 메달색 글로우 (shadowColor는 각 메달별로 인라인)
    shadowOpacity: 0.55,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  podiumMedalFirst: { width: 30, height: 30, borderRadius: 15 },
  podiumMedalNum: { ...T.text.caption, fontWeight: '800', color: T.white },
  // 아바타 래퍼 — 기본은 투명(레이아웃 무변화), 내 것이면 액센트 글로우 링
  podiumAvatarWrap: { alignItems: 'center', justifyContent: 'center' },
  podiumAvatarWrapMe: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 2.5,
    borderColor: T.accent,
    backgroundColor: T.white,
    shadowColor: T.accent,
    shadowOpacity: 0.45,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  // 내 아바타 우상단 '나' 배지
  podiumMeBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: T.accent,
    borderRadius: 9,
    paddingHorizontal: T.space.sm,
    paddingVertical: 1,
    borderWidth: 1.5,
    borderColor: T.white,
    zIndex: 2,
  },
  podiumMeBadgeText: { fontSize: 11, fontWeight: '800', color: T.white },
  podiumNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    maxWidth: 100,
    marginTop: 2,
  },
  podiumName: { ...T.text.caption, fontWeight: '700', color: T.ink, flexShrink: 1 },
  podiumNameMe: { color: T.accentDeep, fontWeight: '800' },
  podiumTime: {
    ...T.text.caption,
    fontWeight: '800',
    color: T.accentDeep,
    fontVariant: ['tabular-nums'],
  },
  // 집중 중 표시 (GROMO-810) — 포디움도 랭킹 행과 동일한 초록 점·과목·라이브 시간
  podiumFocusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.green },
  podiumFocusTag: { ...T.text.caption, fontWeight: '700', color: T.greenDeep, maxWidth: 100 },
  podiumTimeFocusing: { color: T.greenDeep },
  podiumPin: { position: 'absolute', top: 20, right: 4 },

  // ── 플로팅 '내 순위' 행 (GROMO-1614) ──
  // 리스트 패딩(T.space.lg)과 같은 좌우 여백 — 도킹 시 실제 행과 폭이 정확히 겹친다
  floatRowWrap: { position: 'absolute', top: 0, left: T.space.lg, right: T.space.lg },
  // 떠 있는 동안만 걸리는 그림자 + 행 기본 marginBottom 제거(위치 계산은 행 상단 기준)
  floatRowShadow: {
    marginBottom: 0,
    shadowColor: T.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  // 100위 밖 편입 행 앞 생략(⋯) 표시
  listEllipsis: {
    textAlign: 'center',
    color: T.inkFaint,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 4,
    paddingBottom: T.space.sm,
  },
  // 순위를 모르는 100위 밖 안내 카드 — 구 상단 스트립의 시각(노트 배경+액센트 테두리)을 하단으로
  floatNoticeWrap: { position: 'absolute', left: T.space.lg, right: T.space.lg },
  floatNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.noteBg,
    borderWidth: 1.5,
    borderColor: T.accent,
    borderRadius: 12,
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.md,
    shadowColor: T.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  floatNoticeText: { ...T.text.caption, flex: 1, color: T.inkSub },

  // 섹션 헤더 (랭킹 + 핀 필터)
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: T.space.sm,
    paddingHorizontal: 2,
  },
  sectionLabel: { ...T.text.label, fontWeight: '700', color: T.ink },
  pinChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    backgroundColor: T.chipBg,
    borderWidth: 1,
    borderColor: T.chipBorder,
    borderRadius: 999,
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.xs,
  },
  pinChipOn: { backgroundColor: T.accent, borderColor: T.accent },
  pinChipText: { ...T.text.caption, color: T.inkSub },
  pinChipTextOn: { color: T.white, fontWeight: '700' },

  emptyLeague: {
    ...T.text.caption,
    color: T.inkMuted,
    textAlign: 'center',
    paddingVertical: T.space.xxl,
  },

  // 티어 안내 진입점 — 리스트 맨 아래
  tierStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: T.space.sm,
    marginTop: T.space.lg,
    marginBottom: T.space.xs,
  },
  tierStripImg: { width: 22, height: 22, resizeMode: 'contain' },
  tierStripText: { ...T.text.caption, color: T.inkSub },

  // 친구 탭 — 검색·추가 엔트리 카드
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    backgroundColor: T.accentBg,
    borderWidth: 1,
    borderColor: T.sand,
    borderRadius: 16,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.md,
    marginTop: T.space.md,
    marginBottom: T.space.lg,
  },
  addIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: T.accentBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTextCol: { flex: 1, gap: 1 },
  addTitle: { ...T.text.label, fontWeight: '800', color: T.ink },
  addSub: { ...T.text.caption, fontWeight: '500', color: T.inkMuted },

  friendCount: {
    ...T.text.label,
    fontWeight: '700',
    color: T.ink,
    marginBottom: T.space.md,
    marginLeft: T.space.xs,
  },
  friendCountNum: { color: T.accent },
  friendGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: T.space.md },
  friendCard: {
    width: '48%',
    flexGrow: 1,
    alignItems: 'center',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingTop: T.space.lg,
    paddingBottom: T.space.md,
    paddingHorizontal: T.space.md,
  },
  // 홀수 명일 때 마지막 줄을 채우는 투명 칸 — 혼자 남은 카드가 전체 폭으로 늘어나지 않게 2열 폭 고정
  friendCardGhost: { width: '48%', flexGrow: 1 },
  // 집중 중 표시 (GROMO-658) — 초록 테두리 카드 + 점·과목 + 초 단위 라이브 시간
  friendCardFocusing: { borderWidth: 1.5, borderColor: T.green, backgroundColor: T.greenBg },
  friendFocusingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    marginTop: T.space.xs,
  },
  friendFocusingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.green },
  friendFocusTag: { ...T.text.caption, fontWeight: '700', color: T.greenDeep, maxWidth: 70 },
  friendFocusTimeLive: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.greenDeep,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  // 핀한 친구 표시 — 나만의 랭킹(핀 경쟁자)에 고정된 친구
  friendPinBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 조회 실패 — 빈 상태와 구분되는 에러 안내 + 재시도 (친구 GROMO-621 · 랭킹 GROMO-922 공용)
  friendErrorWrap: { alignItems: 'center', paddingVertical: T.space.sm },
  retryBtn: {
    backgroundColor: T.accent,
    borderRadius: 999,
    paddingHorizontal: T.space.xl,
    paddingVertical: T.space.sm,
  },
  retryBtnText: { ...T.text.caption, fontWeight: '700', color: T.white },
  friendName: { ...T.text.label, fontWeight: '700', color: T.ink, marginTop: T.space.sm },
  friendTierRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs, marginTop: 3 },
  friendTier: { ...T.text.caption, color: T.inkSub },
  // 오늘 집중 시간 (GROMO-658) — 0분은 흐리게, 집중 이력 있으면 액센트로
  friendFocusTime: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkMuted,
    marginTop: T.space.xs,
    fontVariant: ['tabular-nums'],
  },
  friendFocusTimeOn: { color: T.accent },
});
