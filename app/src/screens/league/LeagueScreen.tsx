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
} from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { T, withAlpha } from '@/constants/theme';
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
import type { FriendResponse } from '@/types/api';
import { RankRow } from './components/RankRow';
import { RankRowShell } from './components/RankRowShell';
import { LiveFocusTime } from './components/LiveFocusTime';
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
//   + Top3 포디움 + sticky '내 순위' 스트립(탭=내 행으로) + 4위~ 랭킹(진입 시 내 행 자동 스크롤)
//   + '핀한 사람만' 필터(나+핀만, 나 대비 시간 차 표시). 하단 시트는 폐기.
//   - 시안의 시험 칩은 카테고리(온보딩 16)가 많아 폐기 — 제목 드롭다운으로 전체/내 시험/다른 시험 전환.
//   - 내 순위는 리스트와 같은 파생값 하나만 쓴다(순위 기준 이원화 방지).
// 친구 탭: 친구 검색·추가 엔트리 + 친구 2열 그리드(카드 탭 → 프로필 상세 FriendProfile).
// 친구 목록·받은 요청 수(./useFriends)·핀(./usePinned)은 실데이터.

// 리그 드롭다운의 '전체' 항목 라벨
const LEAGUE_ALL = '전체';
// 자동/탭 스크롤 시 sticky 스트립에 내 행이 가리지 않게 두는 위 여유
const MY_STRIP_SPACE = 70;
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
const TAB_LABEL: Record<TabKey, string> = { league: '리그', friend: '친구' };

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

  const listRef = useRef<ScrollView>(null);
  // 랭킹 리스트 안 내 행의 y — 스트립 탭/진입 자동 스크롤 목적지
  const myRowY = useRef(0);
  // 리스트 뷰포트 높이 — 내 행이 첫 화면 안에 보이면 자동 스크롤 생략(포디움 유지)
  const listHeight = useRef(0);
  // 진입·리그 전환 직후 1회 내 행으로 자동 스크롤
  const pendingScrollToMe = useRef(true);

  // 내 티어·마감 스케줄 실데이터 (GROMO-538) — 티어 조회는 여기 한 곳에서만.
  const { tier, deadlineLabel, refetch: refetchMeta } = useLeagueMeta();
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
  const { ranking: globalRanking, error: globalError, refetch: refetchGlobal } = useGlobalRanking();

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
  const { userId: myUserId } = useUser();

  // 친구 목록·받은 요청 수 — 실데이터(포커스마다 재조회)
  const {
    friends,
    receivedCount,
    loaded: friendsLoaded,
    error: friendsError,
    refetch: refetchFriends,
  } = useFriends();
  const friendIds = new Set(friends.map((f) => f.userId));

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
  const title = isAll ? '전체 리그' : `${filter} 리그`;

  // 전환 가능한 리그 — 전체 + 내 직군(있을 때). 직군 랭킹은 단일 직군이라 라벨은 최대 하나.
  const leagues = [LEAGUE_ALL, ...(myLabel ? [myLabel] : [])];

  const myTier = tierByLevel(tier.tierLevel ?? 1);

  // 내 순위 — 위 리스트와 같은 파생값에서만 계산
  const myIdx = visibleRanking.findIndex((r) => r.userId === MY_USER_ID);
  const above = myIdx > 0 ? visibleRanking[myIdx - 1] : null;
  // ⚠️ 격차 계산에는 **단계별 내 기록**을 쓴다. 재정렬을 한 칸씩 재생하는 동안 목록의 기록은
  //    단계값인데 여기만 서버 최종값(mySeconds)을 쓰면, 아직 4위·3위가 보이는 프레임에서
  //    `above - my`가 음수가 되고 hms가 0으로 눌러 `▲ N위까지 00:00:00`이 뜬다(codex 리뷰).
  //    목록 밖(top-100 밖)이면 애초에 단계화 대상이 아니므로 최종값 그대로다 — mySeconds는
  //    목록이 아니라 내 세션 합산에서 오기 때문에 그때도 유효한 값이다(useLeagueRanking 주석).
  const stagedMySeconds = myIdx >= 0 ? visibleRanking[myIdx].totalFocusSeconds : mySeconds;

  // 넛지 노출 — '내 순위 스트립'(▲ N위까지 M분)이 실제 순위와 함께 뜰 때(rank) 진입당 1회.
  // 랭킹 비동기 로드로 myIdx가 뒤늦게 확정돼도 focusSeq 기준으로 딱 1회만 발화(중복 방지).
  useEffect(() => {
    if (tab === 'league' && myIdx >= 0 && rankNudgeSeq.current !== focusSeq) {
      rankNudgeSeq.current = focusSeq;
      logNudgeViewed({ type: 'rank' });
    }
  }, [tab, myIdx, focusSeq]);

  // 포디움(Top3) / 리스트(4위~ 또는 핀한 사람만)
  const top3 = visibleRanking.slice(0, 3);
  const showPodium = !pinnedOnly && top3.length > 0;
  // '핀한 사람만': 핀한 사람이 하나라도 있으면 나+핀을 함께 보여주고(나 대비 시간 차),
  // 하나도 없으면 나만 뜨지 않도록 비운다 (GROMO-636).
  const hasPinned = visibleRanking.some((r) => pinned.has(r.userId));
  const pinnedRows = visibleRanking.filter((r) => r.userId === MY_USER_ID || pinned.has(r.userId));
  const listRows = pinnedOnly ? (hasPinned ? pinnedRows : []) : visibleRanking.slice(3);

  function scrollToMyRow() {
    // 내가 포디움(Top3)이거나 핀 모드면 최상단으로
    if (myIdx < 3 || pinnedOnly) {
      listRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    listRef.current?.scrollTo({ y: Math.max(myRowY.current - MY_STRIP_SPACE, 0), animated: true });
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
    pendingScrollToMe.current = true;
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
      isFriend: friendIds.has(member.userId),
      // 핀 초기값 — 공유 핀 상태(usePinned)가 로딩된 경우에만 전달(낙관 상태 포함 최신값).
      // 미로딩이면 undefined로 넘겨 프로필의 GET /pins 재동기화에 맡긴다 — false를 넘기면
      // 프로필이 확정값으로 믿고 서버 동기화를 건너뛰어 핀한 유저가 꺼짐으로 보인다(PR 291 리뷰 반영).
      isPinned: pinnedLoaded ? pinned.has(member.userId) : undefined,
      rank: rank > 0 ? rank : undefined,
      rankLabel: filter,
    });
  }

  // 첫 진입 사용법 안내(GROMO-652) — 캐릭터가 리그 경쟁·티어·친구 탭을 차례로 설명
  const segmentRef = useRef<View | null>(null);
  const headerRef = useRef<View | null>(null);
  const guideSteps: GuideStep[] = [
    {
      text: '리그에 온 걸 환영해!\n같은 시험을 준비하는 사람들과 일주일 동안 공부 시간으로 경쟁하는 곳이야.',
      character: require('@/assets/character_hi.png'),
    },
    {
      text: '지금 참여 중인 리그와 마감까지 남은 시간이 여기 보여.\n제목을 누르면 전체 리그도 볼 수 있어.',
      character: require('@/assets/character_study.png'),
      anchor: headerRef,
    },
    {
      text: '한 주가 끝나면 순위에 따라 티어가 올라가거나 내려가!\n랭킹 아래 ‘내 티어’를 누르면 티어 단계를 자세히 볼 수 있어.',
      character: require('@/assets/character_happy.png'),
    },
    {
      text: '친구 탭에서는 친구를 추가하고 서로의 공부시간을 볼 수 있어.\n같이 공부할 친구를 초대해봐!',
      character: require('@/assets/character_happy.png'),
      anchor: segmentRef,
    },
    {
      text: '순위는 이번 주 집중 시간으로 정해져.\n지금 바로 집중을 시작해서 순위를 올려보자!',
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
                <Text style={[s.segText, on ? s.segTextOn : null]}>{TAB_LABEL[k]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── 헤더: 좌상단 마감 카운트다운 + 우측 제목(탭=리그 선택 드롭다운) ── */}
      {tab === 'league' && (
        <View style={s.header} ref={headerRef} collapsable={false}>
          <Text style={s.deadline} allowFontScaling={false}>
            {deadlineLabel ?? ''}
          </Text>
          <TouchableOpacity
            style={s.headerToggle}
            activeOpacity={0.7}
            onPress={() => setLeagueMenuOpen(true)}
          >
            <Text style={s.headerTitle}>{title}</Text>
            <Ionicons name="chevron-down" size={17} color={T.inkSub} />
          </TouchableOpacity>
        </View>
      )}

      {tab === 'league' ? (
        <ScrollView
          ref={listRef}
          style={s.list}
          onLayout={(e) => {
            listHeight.current = e.nativeEvent.layout.height;
          }}
          stickyHeaderIndices={showPodium ? [1] : [0]}
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
            <View style={s.podium}>
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
                              나
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
                              ? `${member.focusTagName} 집중 중`
                              : '집중 중'}
                          </Text>
                          <LiveFocusTime
                            baseSeconds={member.totalFocusSeconds}
                            focusStartedAt={member.focusStartedAt}
                            format={hms}
                            style={[s.podiumTime, s.podiumTimeFocusing]}
                          />
                        </>
                      ) : (
                        <Text style={s.podiumTime} allowFontScaling={false}>
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

          {/* ── 내 순위 스트립 — 스크롤해도 상단 고정(sticky).
               탭=내 행으로 / 내가 없는 리그에선 핀 안내 + 전체 리그 이동 ── */}
          <View style={s.myStripWrap}>
            <TouchableOpacity
              style={s.myStrip}
              activeOpacity={0.85}
              onPress={
                myIdx >= 0
                  ? () => {
                      // 유도 수치(순위·격차)를 탭 = 넛지 유도 성공.
                      logNudgeTapped({ type: 'rank' });
                      scrollToMyRow();
                    }
                  : () => selectLeague(LEAGUE_ALL)
              }
            >
              {myIdx >= 0 ? (
                <>
                  <Text style={s.myStripRank} allowFontScaling={false}>
                    내 순위 {myIdx + 1}위
                  </Text>
                  <Text style={s.myStripGap} numberOfLines={1} allowFontScaling={false}>
                    {above
                      ? `▲ ${myIdx}위까지 ${hms(above.totalFocusSeconds - stagedMySeconds)}`
                      : '지금 1위예요'}
                  </Text>
                  <Ionicons name="chevron-down" size={13} color={T.accentDeep} />
                </>
              ) : (
                <>
                  <MaterialCommunityIcons name="pin-outline" size={14} color={T.accentDeep} />
                  <Text style={s.myStripEmpty}>
                    다른 리그 구경 중 — 핀하면 전체 리그에서 모아볼 수 있어요
                  </Text>
                  <Ionicons name="chevron-forward" size={13} color={T.accentDeep} />
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* ── 섹션 헤더: 랭킹 라벨 + 핀한 사람만 필터 ── */}
          <View style={s.sectionRow}>
            <Text style={s.sectionLabel}>{pinnedOnly ? '핀한 사람' : '랭킹'}</Text>
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
              <Text style={[s.pinChipText, pinnedOnly ? s.pinChipTextOn : null]}>핀한 사람만</Text>
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
                onLayout={
                  isMe && !pinnedOnly
                    ? (e) => {
                        myRowY.current = e.nativeEvent.layout.y;
                        // 진입/리그 전환 직후 1회 — 내 행이 첫 화면 밖일 때만 스크롤(포디움 유지)
                        if (pendingScrollToMe.current) {
                          pendingScrollToMe.current = false;
                          requestAnimationFrame(() => {
                            const rowBottom = myRowY.current + 56; // 행 높이 근사값
                            if (listHeight.current > 0 && rowBottom > listHeight.current) {
                              listRef.current?.scrollTo({
                                y: Math.max(myRowY.current - MY_STRIP_SPACE, 0),
                                animated: false,
                              });
                            }
                          });
                        }
                      }
                    : undefined
                }
              >
                <RankRow
                  rank={visibleRanking.indexOf(row) + 1}
                  nickname={row.nickname}
                  tierLevel={row.tierLevel}
                  seconds={row.totalFocusSeconds}
                  isMe={isMe}
                  pinned={pinned.has(row.userId)}
                  // row.totalFocusSeconds가 단계값이므로 비교 대상도 단계값이어야 한다(위 주석).
                  deltaSeconds={
                    pinnedOnly && !isMe ? row.totalFocusSeconds - stagedMySeconds : undefined
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
          {/* 조회 실패 + 보여줄 목록 없음 — "아무도 없는 리그" 빈 상태로 오인되지 않게 에러+재시도로
               분기 (GROMO-922, 친구 탭 GROMO-621과 동일 패턴). 실패여도 기존 목록이 있으면 유지. */}
          {visibleRanking.length === 0 &&
            (showRankingError ? (
              <View style={s.friendErrorWrap}>
                <Text style={s.emptyLeague}>랭킹을 불러오지 못했어요</Text>
                <TouchableOpacity
                  style={s.retryBtn}
                  activeOpacity={0.8}
                  onPress={isAll ? refetchGlobal : refetchRanking}
                >
                  <Text style={s.retryBtnText}>다시 시도</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={s.emptyLeague}>아직 이 리그엔 아무도 없어요</Text>
            ))}
          {/* 실패 안내가 떠 있을 땐 숨긴다 — "불러오지 못했어요"와 동시에 뜨면 모순(코드리뷰 반영) */}
          {pinnedOnly && !showRankingError && listRows.length === 0 && (
            <Text style={s.emptyLeague}>랭킹에서 핀을 누르면 여기에 담겨요</Text>
          )}

          {/* ── 내 티어 스트립 → 티어 안내 (시안에 진입점이 없어 둔 임시 진입점) ── */}
          <TouchableOpacity
            style={s.tierStrip}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('TierGuide')}
          >
            <Image source={myTier.image} style={s.tierStripImg} />
            <Text style={s.tierStripText}>내 티어 · {myTier.name}</Text>
            <Ionicons name="chevron-forward" size={13} color={T.inkMuted} />
          </TouchableOpacity>
        </ScrollView>
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
              <Text style={s.addTitle}>친구 검색·추가</Text>
              <Text style={s.addSub}>받은 요청 {receivedCount}건</Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={T.inkMuted} />
          </TouchableOpacity>

          {/* 조회 실패 + 보여줄 목록 없음 — "친구 0명" 빈 상태로 오인되지 않게 에러+재시도로 분기 (GROMO-621).
               실패여도 기존 목록이 있으면 그대로 유지해서 보여준다. */}
          {friendsError && friends.length === 0 ? (
            <View style={s.friendErrorWrap}>
              <Text style={s.emptyLeague}>친구 목록을 불러오지 못했어요</Text>
              <TouchableOpacity style={s.retryBtn} activeOpacity={0.8} onPress={refetchFriends}>
                <Text style={s.retryBtnText}>다시 시도</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={s.friendCount}>
                내 친구 <Text style={s.friendCountNum}>{friends.length}</Text>명
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
                          <LiveFocusTime
                            baseSeconds={(f.focusTimeMinutes ?? 0) * 60}
                            focusStartedAt={f.focusStartedAt ?? null}
                            style={s.friendFocusTimeLive}
                          />
                        </>
                      ) : (
                        <Text
                          style={[
                            s.friendFocusTime,
                            (f.focusTimeMinutes ?? 0) > 0 && s.friendFocusTimeOn,
                          ]}
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
                <Text style={s.emptyLeague}>아직 친구가 없어요. 검색해서 추가해보세요!</Text>
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
                      {l === LEAGUE_ALL ? '전체 리그' : `${l} 리그`}
                    </Text>
                    {l === myLabel && <Text style={s.menuMine}>내 시험</Text>}
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

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.md,
    paddingBottom: T.space.md,
  },
  headerToggle: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  headerTitle: { ...T.text.title, color: T.ink },
  deadline: { ...T.text.caption, color: T.inkSub },

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

  // 내 순위 스트립 (sticky) — 밑 리스트가 비치지 않게 배경을 깐다
  myStripWrap: { backgroundColor: T.paperLight, paddingTop: 2, paddingBottom: T.space.sm },
  myStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.noteBg,
    borderWidth: 1.5,
    borderColor: T.accent,
    borderRadius: 12,
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.md,
  },
  myStripRank: { ...T.text.label, fontWeight: '800', color: T.accentDeep },
  myStripGap: {
    ...T.text.caption,
    flex: 1,
    textAlign: 'right',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
  },
  myStripEmpty: { ...T.text.caption, flex: 1, color: T.inkSub },

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
