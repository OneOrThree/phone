import { useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import { tierByLevel } from '@/v2/constants/tiers';
import { useFocusCategory } from '@/hooks/useFocusCategory';
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
import { MyRankingSheet, type MyRankStatus, type RivalEntry } from './components/MyRankingSheet';
import { ProfileSheet, type ProfileTarget } from './components/ProfileSheet';

// 리그 메인 (탭 2번째) — 시안 "리그 메인 · 전체 랭킹 · 핀/모달/프로필" + "친구 탭".
// 리그 탭: 제목/마감 + 세그먼트 + 리그 범위 토글(내 시험 ↔ 전체) + 혼합 티어 랭킹 + 하단 '내 순위' 시트.
//   - 시안의 시험 칩은 카테고리(온보딩 16)가 많아 토글 2개로 축소.
//   - 내 순위는 리스트와 같은 파생값 하나만 쓴다(시트와 순위 기준 이원화 방지).
// 친구 탭: 친구 검색·추가 엔트리 + 친구 2열 그리드. 데이터는 UI-first mock(./mock).

// 탭바가 차지하는 높이(홈 '오늘' 카드 marginBottom 선례와 동일 기준)
const TAB_BAR_SPACE = 74;
// 접힌 "내 순위" 시트가 가리는 높이 — 리스트 하단 패딩에 반영
const SHEET_COLLAPSED_SPACE = 150;

type TabKey = 'league' | 'friend';
const TAB_LABEL: Record<TabKey, string> = { league: '리그', friend: '친구' };

export default function LeagueScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  const [tab, setTab] = useState<TabKey>('league');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<ProfileTarget | null>(null);
  // 리그 범위 — 기본은 내 시험 리그, '전체'로 전환 가능
  const [showAll, setShowAll] = useState(false);
  // 핀 토글은 로컬 상태 — TODO: POST·DELETE /friends/{id}/pin 연동
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(INITIAL_PINS));

  const listRef = useRef<ScrollView>(null);
  // 랭킹 리스트 안 내 행의 y — 시트의 내 순위 카드 탭 시 스크롤 목적지
  const myRowY = useRef(0);

  // 온보딩 16(목표 선택) 값 = 내 시험 리그. mock 내 행의 exam을 이 값으로 보정 —
  // TODO: 시험별 리그 백엔드 협의 후 랭킹 응답 값으로 대체
  const myCategory = useFocusCategory();
  const ranking: RankedMember[] = myCategory
    ? RANKING.map((m) => (m.userId === MY_USER_ID ? { ...m, exam: myCategory } : m))
    : RANKING;
  const me = ranking.find((m) => m.userId === MY_USER_ID);
  const myLeagueLabel = me?.exam ?? null;

  const friendIds = new Set(FRIENDS.map((f) => f.userId));

  // 리그 범위 적용 — 내 시험 정보가 없으면 전체만
  const viewAll = showAll || !myLeagueLabel;
  const visibleRanking = viewAll ? ranking : ranking.filter((m) => m.exam === myLeagueLabel);
  const title = viewAll ? '전체 리그' : `${myLeagueLabel} 리그`;

  const myTier = tierByLevel(MY_TIER.tierLevel ?? 1);

  // 내 순위 — 위 리스트와 같은 파생값에서만 계산
  const myIdx = visibleRanking.findIndex((m) => m.userId === MY_USER_ID);
  const myStatus: MyRankStatus | null =
    myIdx >= 0
      ? {
          rank: myIdx + 1,
          nickname: visibleRanking[myIdx].nickname,
          tierLevel: visibleRanking[myIdx].tierLevel,
          minutes: visibleRanking[myIdx].totalFocusMinutes,
          above:
            myIdx > 0
              ? {
                  nickname: visibleRanking[myIdx - 1].nickname,
                  gapMinutes:
                    visibleRanking[myIdx - 1].totalFocusMinutes -
                    visibleRanking[myIdx].totalFocusMinutes,
                }
              : null,
        }
      : null;

  // 라이벌(핀) — 순위가 아니라 나 대비 비교 목록. 리그 범위와 무관하게 유지
  const rivals: RivalEntry[] = ranking
    .filter((m) => pinned.has(m.userId) && m.userId !== MY_USER_ID)
    .map((m) => ({
      userId: m.userId,
      nickname: m.nickname,
      tierLevel: m.tierLevel,
      minutes: m.totalFocusMinutes,
      deltaMinutes: m.totalFocusMinutes - (me?.totalFocusMinutes ?? 0),
    }))
    .sort((a, b) => b.minutes - a.minutes);

  function togglePin(userId: string) {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function scrollToMyRow() {
    // 위 여유 90 — 스크롤 후 내 행이 헤더/토글에 붙지 않게
    listRef.current?.scrollTo({ y: Math.max(myRowY.current - 90, 0), animated: true });
  }

  // 프로필 오버레이 열기 — 시안 prof 파생값(전체 순위·시험 리그 순위) 그대로
  function openProfile(member: RankedMember) {
    const examList = ranking.filter((m) => m.exam === member.exam);
    setSelected({
      userId: member.userId,
      nickname: member.nickname,
      tierLevel: member.tierLevel,
      minutes: member.totalFocusMinutes,
      globalRank: member.rank,
      examName: member.exam,
      examRank: examList.findIndex((m) => m.userId === member.userId) + 1,
      achievedRate: member.achievedRate,
      friendCount: member.friendCount,
      isFriend: friendIds.has(member.userId),
    });
  }

  function openProfileById(userId: string) {
    const member = ranking.find((m) => m.userId === userId);
    if (member) openProfile(member);
  }

  // 친구 탭 그리드 카드용 — 친구의 티어/시간은 랭킹에서 조회
  const friendMembers = FRIENDS.map((f) => ranking.find((m) => m.userId === f.userId)).filter(
    (m): m is RankedMember => m != null,
  );

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── 헤더: 제목 + 마감 카운트다운 (시안: 리그 탭에서만) ── */}
      {tab === 'league' && (
        <View style={s.header}>
          <Text style={s.headerTitle}>{title}</Text>
          <Text style={s.deadline} allowFontScaling={false}>
            {DEADLINE_LABEL}
          </Text>
        </View>
      )}

      {/* ── 리그/친구 세그먼트 ── */}
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

      {tab === 'league' ? (
        <>
          {/* ── 리그 범위 토글 — 내 시험 리그 ↔ 전체 ── */}
          <View style={s.scopeRow}>
            {myLeagueLabel != null && (
              <TouchableOpacity
                style={[s.scopeBtn, !viewAll ? s.scopeBtnOn : null]}
                activeOpacity={0.8}
                onPress={() => setShowAll(false)}
              >
                <Text style={[s.scopeText, !viewAll ? s.scopeTextOn : null]}>{myLeagueLabel}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.scopeBtn, viewAll ? s.scopeBtnOn : null]}
              activeOpacity={0.8}
              onPress={() => setShowAll(true)}
            >
              <Text style={[s.scopeText, viewAll ? s.scopeTextOn : null]}>전체</Text>
            </TouchableOpacity>
          </View>

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

          {/* ── 랭킹 (혼합 티어 — 내 시험/전체 범위) ── */}
          <ScrollView
            ref={listRef}
            style={s.list}
            contentContainerStyle={{
              paddingBottom: insets.bottom + TAB_BAR_SPACE + SHEET_COLLAPSED_SPACE + 12,
            }}
            showsVerticalScrollIndicator={false}
          >
            {visibleRanking.map((m, i) => {
              const isMe = m.userId === MY_USER_ID;
              return (
                <View
                  key={m.userId}
                  onLayout={
                    isMe
                      ? (e) => {
                          myRowY.current = e.nativeEvent.layout.y;
                        }
                      : undefined
                  }
                >
                  <RankRow
                    rank={i + 1}
                    nickname={m.nickname}
                    tierLevel={m.tierLevel}
                    minutes={m.totalFocusMinutes}
                    isMe={isMe}
                    pinned={pinned.has(m.userId)}
                    onPress={() => openProfile(m)}
                    onPin={isMe ? undefined : () => togglePin(m.userId)}
                  />
                </View>
              );
            })}
            {visibleRanking.length === 0 && (
              <Text style={s.emptyLeague}>아직 이 리그엔 아무도 없어요</Text>
            )}
          </ScrollView>
        </>
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

      {/* ── 하단 "내 순위" 시트 — 리그 탭에서만 ── */}
      {tab === 'league' && (
        <MyRankingSheet
          open={sheetOpen}
          onToggle={() => setSheetOpen((o) => !o)}
          leagueTitle={title}
          status={myStatus}
          onPressMyRank={scrollToMyRow}
          rivals={rivals}
          onPressRival={(r) => openProfileById(r.userId)}
          bottom={insets.bottom + TAB_BAR_SPACE + 2}
        />
      )}

      {/* ── 프로필 오버레이 ── */}
      <ProfileSheet target={selected} onClose={() => setSelected(null)} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },

  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  headerTitle: { ...T.text.title, color: T.ink },
  deadline: { ...T.text.caption, color: '#9C6B43' },

  segmentWrap: { paddingHorizontal: 18 },
  segmentWrapFriend: { paddingTop: 10, paddingBottom: 2 },
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

  scopeRow: { flexDirection: 'row', gap: 7, paddingHorizontal: 18, marginTop: 12 },
  scopeBtn: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  scopeBtnOn: { backgroundColor: T.accent, borderColor: T.accent },
  scopeText: { ...T.text.caption, color: '#5C5246' },
  scopeTextOn: { color: T.white, fontWeight: '700' },

  tierStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 18,
    marginTop: 10,
    marginBottom: 7,
    alignSelf: 'flex-start',
  },
  tierStripImg: { width: 22, height: 22, resizeMode: 'contain' },
  tierStripText: { ...T.text.caption, color: T.inkSub },

  list: { flex: 1, paddingHorizontal: 16 },
  emptyLeague: {
    ...T.text.caption,
    color: T.inkMuted,
    textAlign: 'center',
    paddingVertical: 28,
  },

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
