import { useRef, useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import { tierByLevel } from '@/v2/constants/tiers';
import { useFocusCategory } from '@/hooks/useFocusCategory';
import { useUser } from '@/store/UserContext';
import { useSubjects } from '@/store/SubjectContext';
import { useFocus } from '@/store/FocusContext';
import type { V2RootStackParamList } from '@/v2/navigation/types';
import {
  DEADLINE_LABEL,
  FRIENDS,
  INITIAL_PINS,
  MY_TIER,
  MY_USER_ID,
  RANKING,
  RECEIVED_REQUESTS,
  type RankedMember,
} from './mock';
import { fmtMinutes } from './format';
import { RankRow } from './components/RankRow';
import { MemberAvatar } from './components/MemberAvatar';
import { TierBadge } from './components/TierBadge';
import { ProfileSheet, type ProfileTarget } from './components/ProfileSheet';

// 리그 메인 (탭 2번째) — 포디움형 레이아웃.
// 리그 탭: 최상단 세그먼트 + 좌 마감/우 제목(탭=리그 선택 드롭다운)
//   + Top3 포디움 + sticky '내 순위' 스트립(탭=내 행으로) + 4위~ 랭킹(진입 시 내 행 자동 스크롤)
//   + '핀한 사람만' 필터(나+핀만, 나 대비 시간 차 표시). 하단 시트는 폐기.
//   - 시안의 시험 칩은 카테고리(온보딩 16)가 많아 폐기 — 제목 드롭다운으로 전체/내 시험/다른 시험 전환.
//   - 내 순위는 리스트와 같은 파생값 하나만 쓴다(순위 기준 이원화 방지).
// 친구 탭: 친구 검색·추가 엔트리 + 친구 2열 그리드. 데이터는 UI-first mock(./mock).

// 탭바가 차지하는 높이(홈 '오늘' 카드 marginBottom 선례와 동일 기준)
const TAB_BAR_SPACE = 74;
// 리그 드롭다운의 '전체' 항목 라벨
const LEAGUE_ALL = '전체';
// 자동/탭 스크롤 시 sticky 스트립에 내 행이 가리지 않게 두는 위 여유
const MY_STRIP_SPACE = 70;
// 포디움 메달 색 (1·2·3위 — 골드/실버/브론즈)
const MEDAL_COLORS = ['#E0A83F', '#B8B0A3', '#C58F5A'];

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
  // 핀 토글은 로컬 상태 — TODO: POST·DELETE /friends/{id}/pin 연동
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(INITIAL_PINS));

  const listRef = useRef<ScrollView>(null);
  // 랭킹 리스트 안 내 행의 y — 스트립 탭/진입 자동 스크롤 목적지
  const myRowY = useRef(0);
  // 리스트 뷰포트 높이 — 내 행이 첫 화면 안에 보이면 자동 스크롤 생략(포디움 유지)
  const listHeight = useRef(0);
  // 진입·리그 전환 직후 1회 내 행으로 자동 스크롤
  const pendingScrollToMe = useRef(true);

  // 내 행은 실데이터로 보정 — 닉네임(홈과 같은 UserContext)·온보딩 카테고리·과목 누적 공부시간 합.
  // 타 유저·주간 집계는 mock — TODO: 리그 API 연동 시 응답 값으로 대체
  const myCategory = useFocusCategory();
  const { nickname: myNickname, goalSeconds } = useUser();
  const { todayFocusSeconds } = useFocus();
  const { subjects } = useSubjects();
  const myTotalMinutes = Math.round(
    subjects.reduce((acc, sub) => acc + sub.accumulatedSeconds, 0) / 60,
  );
  const ranking: RankedMember[] = RANKING.map((m) =>
    m.userId === MY_USER_ID
      ? {
          ...m,
          nickname: myNickname || m.nickname,
          exam: myCategory ?? m.exam,
          totalFocusMinutes: myTotalMinutes,
        }
      : m,
  ).sort((a, b) => b.totalFocusMinutes - a.totalFocusMinutes);
  const me = ranking.find((m) => m.userId === MY_USER_ID);
  const myLeagueLabel = me?.exam ?? null;
  const myMinutes = me?.totalFocusMinutes ?? 0;

  const friendIds = new Set(FRIENDS.map((f) => f.userId));

  // 현재 리그 — 기본은 내 시험, 드롭다운 선택이 있으면 그 리그
  const filter = leagueFilter ?? myLeagueLabel ?? LEAGUE_ALL;
  const isAll = filter === LEAGUE_ALL;
  const visibleRanking = isAll ? ranking : ranking.filter((m) => m.exam === filter);
  const title = isAll ? '전체 리그' : `${filter} 리그`;

  // 전환 가능한 리그 — 전체 + 내 시험 + 랭킹 데이터에 있는 시험들
  const leagues = [
    LEAGUE_ALL,
    ...new Set([...(myLeagueLabel ? [myLeagueLabel] : []), ...ranking.map((m) => m.exam)]),
  ];

  const myTier = tierByLevel(MY_TIER.tierLevel ?? 1);

  // 내 순위 — 위 리스트와 같은 파생값에서만 계산
  const myIdx = visibleRanking.findIndex((m) => m.userId === MY_USER_ID);
  const above = myIdx > 0 ? visibleRanking[myIdx - 1] : null;

  // 포디움(Top3) / 리스트(4위~ 또는 핀한 사람만)
  const top3 = visibleRanking.slice(0, 3);
  const showPodium = !pinnedOnly && top3.length > 0;
  const listRows = pinnedOnly
    ? visibleRanking.filter((m) => m.userId === MY_USER_ID || pinned.has(m.userId))
    : visibleRanking.slice(3);

  function togglePin(userId: string) {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

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

  // 프로필 오버레이 열기 — 순위 대신 개인 기록(최고 순위·주간 최고)을 보여준다.
  // 내 통계는 실데이터(오늘 목표 달성률·오늘 요일 스파크). 일별 기록이 아직 없어
  // 과거 6일은 0, 스트릭·기록은 mock — TODO: 일별 집중 기록/리그 히스토리 도입 시 실계산.
  function openProfile(member: RankedMember) {
    const isMe = member.userId === MY_USER_ID;
    const goal = goalSeconds ?? 0;
    const todayRate = goal > 0 ? Math.min(todayFocusSeconds / goal, 1) : 0;
    const weekdayIdx = (new Date().getDay() + 6) % 7; // 월요일 시작
    setSelected({
      userId: member.userId,
      nickname: member.nickname,
      tierLevel: member.tierLevel,
      minutes: member.totalFocusMinutes,
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

  // 친구 탭 그리드 카드용 — 친구의 티어/시간은 랭킹에서 조회
  const friendMembers = FRIENDS.map((f) => ranking.find((m) => m.userId === f.userId)).filter(
    (m): m is RankedMember => m != null,
  );

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── 최상단: 리그/친구 세그먼트 ── */}
      <View style={[s.segmentWrap, tab === 'friend' ? s.segmentWrapFriend : null]}>
        <View style={s.segment}>
          {(['league', 'friend'] as TabKey[]).map((k) => {
            const on = tab === k;
            return (
              <TouchableOpacity
                key={k}
                style={[s.segBtn, on ? s.segBtnOn : null]}
                onPress={() => setTab(k)}
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
            {DEADLINE_LABEL}
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
                      <View
                        style={[
                          s.podiumMedal,
                          { backgroundColor: MEDAL_COLORS[i] },
                          first ? s.podiumMedalFirst : null,
                        ]}
                      >
                        <Text style={s.podiumMedalNum} allowFontScaling={false}>
                          {i + 1}
                        </Text>
                      </View>
                      <MemberAvatar size={first ? 60 : 48} />
                      <View style={s.podiumNameRow}>
                        <TierBadge level={m.tierLevel} size={16} />
                        <Text style={s.podiumName} numberOfLines={1}>
                          {m.nickname}
                        </Text>
                      </View>
                      <Text style={s.podiumTime} allowFontScaling={false}>
                        {fmtMinutes(m.totalFocusMinutes)}
                      </Text>
                      {!isMe && (
                        <TouchableOpacity
                          style={s.podiumPin}
                          hitSlop={8}
                          onPress={() => togglePin(m.userId)}
                        >
                          <MaterialCommunityIcons
                            name={pinned.has(m.userId) ? 'pin' : 'pin-outline'}
                            size={15}
                            color={pinned.has(m.userId) ? T.accent : '#C9BCA8'}
                          />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })}
            </View>
          )}

          {/* ── 내 순위 스트립 — 스크롤해도 상단 고정(sticky). 탭=내 행으로 ── */}
          <View style={s.myStripWrap}>
            <TouchableOpacity
              style={s.myStrip}
              activeOpacity={0.85}
              disabled={myIdx < 0}
              onPress={scrollToMyRow}
            >
              {myIdx >= 0 ? (
                <>
                  <Text style={s.myStripRank} allowFontScaling={false}>
                    내 순위 {myIdx + 1}위
                  </Text>
                  <Text style={s.myStripGap} numberOfLines={1} allowFontScaling={false}>
                    {above
                      ? `▲ ${above.nickname}까지 ${fmtMinutes(above.totalFocusMinutes - myMinutes)}`
                      : '지금 1위예요'}
                  </Text>
                  <Ionicons name="chevron-down" size={13} color={T.accentDeep} />
                </>
              ) : (
                <Text style={s.myStripEmpty}>이 리그에는 내 순위가 없어요</Text>
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
                  minutes={m.totalFocusMinutes}
                  isMe={isMe}
                  pinned={pinned.has(m.userId)}
                  deltaMinutes={pinnedOnly && !isMe ? m.totalFocusMinutes - myMinutes : undefined}
                  onPress={() => openProfile(m)}
                  onPin={isMe ? undefined : () => togglePin(m.userId)}
                />
              </View>
            );
          })}
          {visibleRanking.length === 0 && (
            <Text style={s.emptyLeague}>아직 이 리그엔 아무도 없어요</Text>
          )}
          {pinnedOnly && listRows.length <= 1 && (
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
              <Text style={s.addSub}>받은 요청 {RECEIVED_REQUESTS.length}건</Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color="#C8A06A" />
          </TouchableOpacity>

          <Text style={s.friendCount}>
            내 친구 <Text style={s.friendCountNum}>{friendMembers.length}</Text>명
          </Text>
          <View style={s.friendGrid}>
            {friendMembers.map((m) => (
              <TouchableOpacity
                key={m.userId}
                style={s.friendCard}
                activeOpacity={0.85}
                onPress={() => openProfile(m)}
              >
                <MemberAvatar size={48} />
                <Text style={s.friendName} numberOfLines={1}>
                  {m.nickname}
                </Text>
                <View style={s.friendTierRow}>
                  <TierBadge level={m.tierLevel} size={18} />
                  <Text style={s.friendTier}>{tierByLevel(m.tierLevel).name}</Text>
                </View>
                <Text style={s.friendTime} allowFontScaling={false}>
                  {fmtMinutes(m.totalFocusMinutes)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
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
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
  },
  headerToggle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  headerTitle: { ...T.text.title, color: T.ink },
  deadline: { ...T.text.caption, color: '#9C6B43' },

  // 리그 선택 드롭다운
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(20,14,9,0.25)' },
  menuCard: {
    position: 'absolute',
    right: 20,
    minWidth: 172,
    maxHeight: 330,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 14,
    paddingVertical: 6,
    shadowColor: '#50371E',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  menuText: { ...T.text.label, flex: 1, color: T.ink },
  menuTextOn: { color: T.accent, fontWeight: '800' },
  menuMine: { ...T.text.caption, color: T.inkSub },

  segmentWrap: { paddingHorizontal: 18, paddingTop: 8 },
  segmentWrapFriend: { paddingBottom: 2 },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#EAE0CF',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  segBtnOn: {
    backgroundColor: T.white,
    shadowColor: '#50371E',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segText: { ...T.text.label, color: T.inkSub },
  segTextOn: { color: T.ink, fontWeight: '700' },

  list: { flex: 1, paddingHorizontal: 16 },

  // Top3 포디움 — 2위·1위·3위, 1위 가운데가 크게
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 14,
    paddingTop: 4,
    paddingBottom: 12,
  },
  podiumCol: { alignItems: 'center', gap: 4, width: 100 },
  podiumColFirst: { marginBottom: 16 },
  podiumMedal: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: T.white,
  },
  podiumMedalFirst: { width: 26, height: 26, borderRadius: 13 },
  podiumMedalNum: { ...T.text.caption, fontWeight: '800', color: T.white },
  podiumNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 100,
    marginTop: 2,
  },
  podiumName: { ...T.text.caption, fontWeight: '700', color: T.ink, flexShrink: 1 },
  podiumTime: {
    ...T.text.caption,
    fontWeight: '800',
    color: T.accentDeep,
    fontVariant: ['tabular-nums'],
  },
  podiumPin: { position: 'absolute', top: 20, right: 4 },

  // 내 순위 스트립 (sticky) — 밑 리스트가 비치지 않게 배경을 깐다
  myStripWrap: { backgroundColor: T.paperLight, paddingTop: 2, paddingBottom: 7 },
  myStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: T.noteBg,
    borderWidth: 1.5,
    borderColor: '#C8893F',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  myStripRank: { ...T.text.label, fontWeight: '800', color: T.accentDeep },
  myStripGap: {
    ...T.text.caption,
    flex: 1,
    textAlign: 'right',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
  },
  myStripEmpty: { ...T.text.caption, flex: 1, textAlign: 'center', color: T.inkSub },

  // 섹션 헤더 (랭킹 + 핀 필터)
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sectionLabel: { ...T.text.label, fontWeight: '700', color: T.ink },
  pinChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: T.chipBg,
    borderWidth: 1,
    borderColor: T.chipBorder,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pinChipOn: { backgroundColor: T.accent, borderColor: T.accent },
  pinChipText: { ...T.text.caption, color: T.inkSub },
  pinChipTextOn: { color: T.white, fontWeight: '700' },

  emptyLeague: {
    ...T.text.caption,
    color: T.inkMuted,
    textAlign: 'center',
    paddingVertical: 24,
  },

  // 티어 안내 진입점 — 리스트 맨 아래
  tierStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    marginTop: 14,
    marginBottom: 4,
  },
  tierStripImg: { width: 22, height: 22, resizeMode: 'contain' },
  tierStripText: { ...T.text.caption, color: T.inkSub },

  // 친구 탭 — 검색·추가 엔트리 카드
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FBF3E8',
    borderWidth: 1,
    borderColor: '#EBDCC2',
    borderRadius: 16,
    paddingHorizontal: 15,
    paddingVertical: 13,
    marginTop: 12,
    marginBottom: 14,
  },
  addIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: '#F0E0C2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTextCol: { flex: 1, gap: 1 },
  addTitle: { ...T.text.label, fontWeight: '800', color: '#5C3D22' },
  addSub: { ...T.text.caption, fontWeight: '500', color: '#A88D6E' },

  friendCount: {
    ...T.text.label,
    fontWeight: '700',
    color: T.ink,
    marginBottom: 12,
    marginLeft: 4,
  },
  friendCountNum: { color: T.accent },
  friendGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  friendCard: {
    width: '48%',
    flexGrow: 1,
    alignItems: 'center',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 10,
  },
  friendName: { ...T.text.label, fontWeight: '700', color: T.ink, marginTop: 8 },
  friendTierRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  friendTier: { ...T.text.caption, color: T.inkSub },
  friendTime: {
    ...T.text.label,
    fontWeight: '800',
    color: T.accent,
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
});
