import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  LayoutAnimation,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { T, withAlpha } from '@/constants/theme';
import { tierByLevel } from '@/constants/tiers';
import { useUser } from '@/store/UserContext';
import { useFocus } from '@/store/FocusContext';
import { useLeagueRanking } from './useLeagueRanking';
import { useGlobalRanking } from './useGlobalRanking';
import { useLeagueMeta } from './useLeagueMeta';
import { useFriends } from './useFriends';
import { usePinned } from './usePinned';
import type { V2RootStackParamList } from '@/navigation/types';
import { MY_USER_ID, type RankedMember } from './mock';
import { hms, fmtHourMin } from './format';
import type { FriendResponse } from '@/types/api';
import { RankRow } from './components/RankRow';
import { LiveFocusTime } from './components/LiveFocusTime';
import { MemberAvatar } from './components/MemberAvatar';
import { TierBadge } from './components/TierBadge';
import { ProfileSheet, type ProfileTarget } from './components/ProfileSheet';
import { TabGuideOverlay, type GuideStep } from '@/components/TabGuideOverlay';
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

// 탭바가 차지하는 높이(홈 '오늘' 카드 marginBottom 선례와 동일 기준)
const TAB_BAR_SPACE = 74;
// 리그 드롭다운의 '전체' 항목 라벨
const LEAGUE_ALL = '전체';
// 자동/탭 스크롤 시 sticky 스트립에 내 행이 가리지 않게 두는 위 여유
const MY_STRIP_SPACE = 70;
// 포디움 메달 그라데이션 (1·2·3위 — 골드/실버/브론즈, 밝은 쪽→진한 쪽)
const MEDAL_GRAD = [T.medalGrad.gold, T.medalGrad.silver, T.medalGrad.bronze];

type TabKey = 'league' | 'friend';
const TAB_LABEL: Record<TabKey, string> = { league: '리그', friend: '친구' };

export default function LeagueScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  const [tab, setTab] = useState<TabKey>('league');
  const [selected, setSelected] = useState<ProfileTarget | null>(null);
  // 현재 선택한 리그 — null이면 기본(내 시험). 제목 드롭다운에서 전체/다른 시험으로 전환
  const [leagueFilter, setLeagueFilter] = useState<string | null>(null);
  const [leagueMenuOpen, setLeagueMenuOpen] = useState(false);
  // 핀한 사람만 보기 — 리스트를 나+핀으로 좁히고 나 대비 차이를 붙인다
  const [pinnedOnly, setPinnedOnly] = useState(false);
  // 핀 실데이터 — 포커스마다 서버(GET /pins) 재조회 + 낙관적 토글(./usePinned).
  // 프로필 상세·친구 탭과 같은 서버 상태를 공유해 화면 간 불일치가 없다.
  const { pinned, togglePin, loaded: pinnedLoaded } = usePinned();

  const listRef = useRef<ScrollView>(null);
  // 랭킹 리스트 안 내 행의 y — 스트립 탭/진입 자동 스크롤 목적지
  const myRowY = useRef(0);
  // 리스트 뷰포트 높이 — 내 행이 첫 화면 안에 보이면 자동 스크롤 생략(포디움 유지)
  const listHeight = useRef(0);
  // 진입·리그 전환 직후 1회 내 행으로 자동 스크롤
  const pendingScrollToMe = useRef(true);

  // 내 티어·마감 스케줄 실데이터 (GROMO-538) — 티어 조회는 여기 한 곳에서만.
  const { tier, deadlineLabel } = useLeagueMeta();
  // 리그 랭킹 실데이터 — 홈 상단바와 공유. 멤버 티어는 서버 응답 실값(GROMO-748).
  const { ranking, myLeagueLabel, mySeconds } = useLeagueRanking();
  // '전체' 탭 전용 진짜 전역 랭킹(직군 리스트 재사용 금지 — GROMO-644).
  const globalRanking = useGlobalRanking();

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
  const { goalSeconds } = useUser();
  const { todayFocusSeconds } = useFocus();

  // 친구 목록·받은 요청 수 — 실데이터(포커스마다 재조회)
  const {
    friends,
    receivedCount,
    loaded: friendsLoaded,
    error: friendsError,
    refetch: refetchFriends,
  } = useFriends();
  const friendIds = new Set(friends.map((f) => f.userId));

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
  const filter = leagueFilter ?? myLeagueLabel ?? LEAGUE_ALL;
  const isAll = filter === LEAGUE_ALL;
  const visibleRanking = isAll ? globalRanking : ranking.filter((m) => m.exam === filter);
  const title = isAll ? '전체 리그' : `${filter} 리그`;

  // 전환 가능한 리그 — 전체 + 내 직군(있을 때). 직군 랭킹은 단일 직군이라 라벨은 최대 하나.
  const leagues = [LEAGUE_ALL, ...(myLeagueLabel ? [myLeagueLabel] : [])];

  const myTier = tierByLevel(tier.tierLevel ?? 1);

  // 내 순위 — 위 리스트와 같은 파생값에서만 계산
  const myIdx = visibleRanking.findIndex((m) => m.userId === MY_USER_ID);
  const above = myIdx > 0 ? visibleRanking[myIdx - 1] : null;

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
  const hasPinned = visibleRanking.some((m) => pinned.has(m.userId));
  const pinnedRows = visibleRanking.filter((m) => m.userId === MY_USER_ID || pinned.has(m.userId));
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
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setLeagueFilter(league);
    setLeagueMenuOpen(false);
    listRef.current?.scrollTo({ y: 0, animated: false });
    pendingScrollToMe.current = true;
  }

  function togglePinnedOnly() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPinnedOnly((v) => !v);
  }

  // 프로필 진입 — 타인은 프로필 상세(FriendProfile, 친구/비친구 3분기)로 이동하고,
  // 내 행만 기존 오버레이(개인 기록·실데이터 요약)를 띄운다.
  // 내 통계는 실데이터(오늘 목표 달성률·오늘 요일 스파크). 일별 기록이 아직 없어
  // 과거 6일은 0, 스트릭·기록은 mock — TODO: 일별 집중 기록/리그 히스토리 도입 시 실계산.
  function openProfile(member: RankedMember) {
    const isMe = member.userId === MY_USER_ID;
    logLeagueProfileOpened({ is_me: isMe });
    if (!isMe) {
      // 프로필 순위 = 지금 보고 있는 목록의 순위 그대로 전달 — 서버 프로필 rank(아레나 내 순위)와
      // 스코프가 달라 숫자가 어긋나므로, 탭한 숫자와 일치시킨다 (GROMO-685).
      const rank = visibleRanking.indexOf(member) + 1;
      navigation.navigate('FriendProfile', {
        userId: member.userId,
        nickname: member.nickname,
        tierLevel: member.tierLevel,
        isFriend: friendIds.has(member.userId),
        rank: rank > 0 ? rank : undefined,
        rankLabel: filter,
      });
      return;
    }
    const goal = goalSeconds ?? 0;
    const todayRate = goal > 0 ? Math.min(todayFocusSeconds / goal, 1) : 0;
    const weekdayIdx = (new Date().getDay() + 6) % 7; // 월요일 시작
    setSelected({
      userId: member.userId,
      nickname: member.nickname,
      tierLevel: member.tierLevel,
      seconds: member.totalFocusSeconds,
      bestRank: member.bestRank,
      bestWeekMinutes: member.bestWeekMinutes,
      achievedRate: isMe ? todayRate : member.achievedRate,
      // 스트릭은 일별 기록 저장소가 생기기 전까지 mock 유지 — TODO: 일별 기록 도입 시 실계산
      streakDays: member.streakDays,
      weekSpark: isMe
        ? Array.from({ length: 7 }, (_, i) =>
            i === weekdayIdx ? Math.round(todayFocusSeconds / 60) : 0,
          )
        : undefined,
      friendCount: member.friendCount,
      isFriend: friendIds.has(member.userId),
    });
  }

  // 첫 진입 사용법 안내(GROMO-652) — 캐릭터가 리그 경쟁·탭 전환을 설명
  const segmentRef = useRef<View | null>(null);
  const guideSteps: GuideStep[] = [
    {
      text: '리그에 온 걸 환영해!\n같은 시험을 준비하는 사람들과 일주일 동안 공부 시간으로 경쟁하는 곳이야.',
      character: require('@/assets/character_hi.png'),
    },
    {
      text: '여기서 리그와 친구 랭킹을 오갈 수 있어. 리그가 끝나면 순위에 따라 티어가 오르내려!',
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
        <View style={s.header}>
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
          contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_SPACE + 16 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Top3 포디움 (2위·1위·3위 배치, 1위 가운데 상단) ── */}
          {showPodium && (
            <View style={s.podium}>
              {[1, 0, 2]
                .filter((i) => top3[i] != null)
                .map((i) => {
                  const m = top3[i];
                  const isMe = m.userId === MY_USER_ID;
                  const first = i === 0;
                  return (
                    <TouchableOpacity
                      key={m.userId}
                      style={[s.podiumCol, first ? s.podiumColFirst : null]}
                      activeOpacity={0.85}
                      onPress={() => openProfile(m)}
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
                        <TierBadge level={m.tierLevel} size={16} />
                        <Text
                          style={[s.podiumName, isMe ? s.podiumNameMe : null]}
                          numberOfLines={1}
                        >
                          {m.nickname}
                        </Text>
                        {m.isFocusing && <View style={s.podiumFocusDot} />}
                      </View>
                      {/* GROMO-810: Top3 도 집중 중이면 과목 + 초 단위 라이브 (랭킹 행과 동일 규칙) */}
                      {m.isFocusing && m.focusStartedAt != null ? (
                        <>
                          <Text style={s.podiumFocusTag} numberOfLines={1}>
                            {m.focusTagName != null ? `${m.focusTagName} 집중 중` : '집중 중'}
                          </Text>
                          <LiveFocusTime
                            baseSeconds={m.totalFocusSeconds}
                            focusStartedAt={m.focusStartedAt}
                            format={hms}
                            style={[s.podiumTime, s.podiumTimeFocusing]}
                          />
                        </>
                      ) : (
                        <Text style={s.podiumTime} allowFontScaling={false}>
                          {hms(m.totalFocusSeconds)}
                        </Text>
                      )}
                      {!isMe && (
                        <TouchableOpacity
                          style={s.podiumPin}
                          hitSlop={15}
                          onPress={() => togglePin(m.userId)}
                        >
                          <MaterialCommunityIcons
                            name={pinned.has(m.userId) ? 'pin' : 'pin-outline'}
                            size={15}
                            color={pinned.has(m.userId) ? T.accent : T.inkFaint}
                          />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
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
                      ? `▲ ${myIdx}위까지 ${hms(above.totalFocusSeconds - mySeconds)}`
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

          {/* ── 랭킹 리스트 (기본: 4위~ / 핀 모드: 나+핀, 나 대비 차이) ── */}
          {listRows.map((m) => {
            const isMe = m.userId === MY_USER_ID;
            return (
              <View
                key={m.userId}
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
                  rank={visibleRanking.indexOf(m) + 1}
                  nickname={m.nickname}
                  tierLevel={m.tierLevel}
                  seconds={m.totalFocusSeconds}
                  isMe={isMe}
                  pinned={pinned.has(m.userId)}
                  deltaSeconds={pinnedOnly && !isMe ? m.totalFocusSeconds - mySeconds : undefined}
                  isFocusing={m.isFocusing}
                  focusStartedAt={m.focusStartedAt}
                  focusTagName={m.focusTagName}
                  onPress={() => openProfile(m)}
                  onPin={isMe ? undefined : () => togglePin(m.userId)}
                />
              </View>
            );
          })}
          {visibleRanking.length === 0 && (
            <Text style={s.emptyLeague}>아직 이 리그엔 아무도 없어요</Text>
          )}
          {pinnedOnly && listRows.length === 0 && (
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
          contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_SPACE + 20 }}
          showsVerticalScrollIndicator={false}
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
                      style={[
                        s.friendCard,
                        isPinned && s.friendCardPinned,
                        f.isFocusing && s.friendCardFocusing,
                      ]}
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
                          <Ionicons name="pin" size={11} color={T.white} />
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
                           아니면 누적분 고정 표시. 서버 확장 전 응답엔 필드가 없어 0분·미집중 취급 */}
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
                          {fmtHourMin(f.focusTimeMinutes ?? 0)}
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
                    {l === myLeagueLabel && <Text style={s.menuMine}>내 시험</Text>}
                    {on && <Ionicons name="checkmark" size={15} color={T.accent} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── 프로필 오버레이 ── */}
      <ProfileSheet target={selected} onClose={() => setSelected(null)} />

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
  // 핀한 친구 강조 — 상단 정렬과 함께 한눈에 구분되도록 액센트 테두리 + 은은한 배경·그림자 (GROMO-658)
  friendCardPinned: {
    borderWidth: 1.5,
    borderColor: T.accent,
    backgroundColor: withAlpha(T.accent, 0.05),
    shadowColor: T.accent,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
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
  // 친구 목록 조회 실패 — 빈 상태와 구분되는 에러 안내 + 재시도 (GROMO-621)
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
