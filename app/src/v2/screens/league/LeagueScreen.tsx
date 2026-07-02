import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';
import { tierByLevel } from '@/v2/constants/tiers';
import type { V2RootStackParamList } from '@/v2/navigation/types';
import {
  DEADLINE_LABEL,
  EXAM_CHIPS,
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
import { MyRankingSheet, type MyRankingEntry } from './components/MyRankingSheet';
import { ProfileSheet, type ProfileTarget } from './components/ProfileSheet';

// 리그 메인 (탭 2번째) — 시안 "리그 메인 · 전체 랭킹 · 핀/모달/프로필" + "친구 탭".
// 리그 탭: 제목/마감 + 세그먼트 + 시험 칩(mock 로컬 필터) + 혼합 티어 랭킹 + 하단 나만의 랭킹 시트.
// 친구 탭: 친구 검색·추가 엔트리 + 친구 2열 그리드. 데이터는 UI-first mock(./mock).

// 탭바가 차지하는 높이(홈 '오늘' 카드 marginBottom 선례와 동일 기준)
const TAB_BAR_SPACE = 74;
// 접힌 "나만의 랭킹" 시트가 가리는 높이 — 리스트 하단 패딩에 반영
const SHEET_COLLAPSED_SPACE = 132;

type TabKey = 'league' | 'friend';
const TAB_LABEL: Record<TabKey, string> = { league: '리그', friend: '친구' };

export default function LeagueScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  const [tab, setTab] = useState<TabKey>('league');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<ProfileTarget | null>(null);
  const [examFilter, setExamFilter] = useState(EXAM_CHIPS[0]);
  // 핀 토글은 로컬 상태 — TODO: POST·DELETE /friends/{id}/pin 연동
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(INITIAL_PINS));

  const friendIds = new Set(FRIENDS.map((f) => f.userId));

  // 시험 칩 필터 — mock 로컬 동작 (시안 examTitle: '전체 리그' / '{시험} 리그')
  const isAll = examFilter === EXAM_CHIPS[0];
  const visibleRanking = isAll ? RANKING : RANKING.filter((m) => m.exam === examFilter);
  const title = isAll ? '전체 리그' : `${examFilter} 리그`;

  const myTier = tierByLevel(MY_TIER.tierLevel ?? 1);

  function togglePin(userId: string) {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  // 프로필 오버레이 열기 — 시안 prof 파생값(전체 순위·시험 리그 순위) 그대로
  function openProfile(member: RankedMember) {
    const examList = RANKING.filter((m) => m.exam === member.exam);
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
    const member = RANKING.find((m) => m.userId === userId);
    if (member) openProfile(member);
  }

  // "나만의 랭킹" = 나 + 핀 경쟁자를 집중 시간순으로 (시안 myGroup)
  const me = RANKING.find((m) => m.userId === MY_USER_ID);
  const sheetEntries: MyRankingEntry[] = [
    ...(me
      ? [
          {
            userId: MY_USER_ID,
            nickname: me.nickname,
            tierLevel: me.tierLevel,
            minutes: me.totalFocusMinutes,
            isMe: true,
          },
        ]
      : []),
    ...RANKING.filter((m) => pinned.has(m.userId) && m.userId !== MY_USER_ID).map((m) => ({
      userId: m.userId,
      nickname: m.nickname,
      tierLevel: m.tierLevel,
      minutes: m.totalFocusMinutes,
      isMe: false,
    })),
  ].sort((a, b) => b.minutes - a.minutes);

  // 친구 탭 그리드 카드용 — 친구의 티어/시간은 랭킹에서 조회
  const friendMembers = FRIENDS.map((f) => RANKING.find((m) => m.userId === f.userId)).filter(
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
          {/* ── 시험 칩 — mock 로컬 필터 ── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.chipsScroll}
            contentContainerStyle={s.chips}
          >
            {EXAM_CHIPS.map((label) => {
              const on = label === examFilter;
              return (
                <TouchableOpacity
                  key={label}
                  style={[s.chip, on ? s.chipOn : null]}
                  activeOpacity={0.8}
                  onPress={() => setExamFilter(label)}
                >
                  <Text style={[s.chipText, on ? s.chipTextOn : null]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

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

          {/* ── 랭킹 (혼합 티어 전체/시험 랭킹) ── */}
          <ScrollView
            style={s.list}
            contentContainerStyle={{
              paddingBottom: insets.bottom + TAB_BAR_SPACE + SHEET_COLLAPSED_SPACE + 12,
            }}
            showsVerticalScrollIndicator={false}
          >
            {visibleRanking.map((m, i) => {
              const isMe = m.userId === MY_USER_ID;
              return (
                <RankRow
                  key={m.userId}
                  rank={i + 1}
                  nickname={m.nickname}
                  tierLevel={m.tierLevel}
                  minutes={m.totalFocusMinutes}
                  isMe={isMe}
                  pinned={pinned.has(m.userId)}
                  onPress={() => openProfile(m)}
                  onPin={isMe ? undefined : () => togglePin(m.userId)}
                />
              );
            })}
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
                <MemberAvatar size={48} tierLevel={m.tierLevel} />
                <Text style={s.friendName} numberOfLines={1}>
                  {m.nickname}
                </Text>
                <Text style={s.friendTier}>{tierByLevel(m.tierLevel).name}</Text>
                <Text style={s.friendTime} allowFontScaling={false}>
                  {fmtMinutes(m.totalFocusMinutes)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}

      {/* ── 하단 "나만의 랭킹" 시트 — 리그 탭에서만 ── */}
      {tab === 'league' && (
        <MyRankingSheet
          open={sheetOpen}
          onToggle={() => setSheetOpen((o) => !o)}
          entries={sheetEntries}
          pinCount={pinned.size}
          onPressEntry={(e) => openProfileById(e.userId)}
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
  headerTitle: { fontSize: 23, fontWeight: '800', letterSpacing: -0.5, color: T.ink },
  deadline: { fontSize: 13, fontWeight: '600', color: '#9C6B43' },

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

  chipsScroll: { flexGrow: 0, marginTop: 12 },
  chips: { paddingHorizontal: 18, gap: 7 },
  chip: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: T.accent, borderColor: T.accent },
  chipText: { fontSize: 13, fontWeight: '600', color: '#5C5246' },
  chipTextOn: { color: T.white, fontWeight: '700' },

  tierStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 18,
    marginTop: 9,
    marginBottom: 7,
    alignSelf: 'flex-start',
  },
  tierStripImg: { width: 22, height: 22, resizeMode: 'contain' },
  tierStripText: { fontSize: 12, fontWeight: '600', color: T.inkSub },

  list: { flex: 1, paddingHorizontal: 16 },

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
  addTitle: { fontSize: 14, fontWeight: '800', color: '#5C3D22' },
  addSub: { fontSize: 11, fontWeight: '500', color: '#A88D6E' },

  friendCount: { fontSize: 14, fontWeight: '700', color: T.ink, marginBottom: 12, marginLeft: 4 },
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
  friendName: { fontSize: 14, fontWeight: '700', color: T.ink, marginTop: 8 },
  friendTier: { fontSize: 11, fontWeight: '600', color: T.inkSub, marginTop: 2 },
  friendTime: {
    fontSize: 14,
    fontWeight: '800',
    color: T.accent,
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
});
