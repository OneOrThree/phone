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
  ARENA_RANKING,
  DEADLINE_LABEL,
  EXAM_CHIPS,
  FRIENDS,
  FRIEND_WEEKLY_MINUTES,
  MY_TIER,
  MY_USER_ID,
  RECEIVED_REQUESTS,
} from './mock';
import { RankRow } from './components/RankRow';
import { MyRankingSheet, type MyRankingEntry } from './components/MyRankingSheet';
import { ProfileSheet, type ProfileTarget } from './components/ProfileSheet';

// 리그 메인 (탭 2번째) — 마감 카운트다운 헤더 + 리그/친구 세그먼트 + 시험 칩(정적)
// + 아레나 랭킹 + 하단 "나만의 랭킹" 시트 + 프로필 오버레이.
// 데이터는 UI-first mock(./mock) — API 연동 시 fetch 결과로 스왑 (매핑은 mock.ts 주석 참고).

// 탭바가 차지하는 높이(홈 '오늘' 카드 marginBottom 선례와 동일 기준)
const TAB_BAR_SPACE = 74;
// 접힌 "나만의 랭킹" 시트가 가리는 높이 — 리스트 하단 패딩에 반영
const SHEET_COLLAPSED_SPACE = 96;

type TabKey = 'league' | 'friend';
const TAB_LABEL: Record<TabKey, string> = { league: '리그', friend: '친구' };

// 주간 집중 분 — 아레나 멤버는 랭킹 응답, 그 외 친구는 mock 맵에서
function minutesOf(userId: string): number {
  const arena = ARENA_RANKING.find((m) => m.userId === userId);
  return arena?.totalFocusMinutes ?? FRIEND_WEEKLY_MINUTES[userId] ?? 0;
}

export default function LeagueScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();

  const [tab, setTab] = useState<TabKey>('league');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<ProfileTarget | null>(null);
  // 핀 토글은 로컬 상태 — TODO: POST·DELETE /friends/{id}/pin 연동
  const [pinned, setPinned] = useState<Set<string>>(
    () => new Set(FRIENDS.filter((f) => f.isPinned).map((f) => f.userId)),
  );

  const myTierLevel = MY_TIER.tierLevel ?? 1;
  const myTier = tierByLevel(myTierLevel);

  function togglePin(userId: string) {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  // 프로필 오버레이 열기 — 아레나/친구 어디서 눌러도 userId로 통일
  function openProfileById(userId: string) {
    const arena = ARENA_RANKING.find((m) => m.userId === userId);
    const friend = FRIENDS.find((f) => f.userId === userId);
    if (!arena && !friend) return;
    setSelected({
      userId,
      nickname: arena?.nickname ?? friend?.nickname ?? '',
      tierLevel: friend?.tierLevel ?? myTierLevel,
      minutes: minutesOf(userId),
      seed: arena?.rank ?? FRIENDS.findIndex((f) => f.userId === userId) + 11,
      relation: friend ? 'FRIEND' : 'NONE',
    });
  }

  // "나만의 랭킹" = 나 + 핀 친구를 집중 시간순으로
  const me = ARENA_RANKING.find((m) => m.userId === MY_USER_ID);
  const sheetEntries: MyRankingEntry[] = [
    {
      userId: MY_USER_ID,
      nickname: me?.nickname ?? '나',
      tierLevel: myTierLevel,
      minutes: me?.totalFocusMinutes ?? 0,
      isMe: true,
    },
    ...[...pinned].map((id) => {
      const friend = FRIENDS.find((f) => f.userId === id);
      const arena = ARENA_RANKING.find((m) => m.userId === id);
      return {
        userId: id,
        nickname: friend?.nickname ?? arena?.nickname ?? '',
        tierLevel: friend?.tierLevel ?? myTierLevel,
        minutes: minutesOf(id),
        isMe: false,
      };
    }),
  ].sort((a, b) => b.minutes - a.minutes);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── 헤더: 제목 + 마감 카운트다운 ── */}
      <View style={s.header}>
        <Text style={s.headerTitle}>전체 리그</Text>
        <View style={s.deadlinePill}>
          <Ionicons name="time-outline" size={13} color={T.accentDeep} />
          <Text style={s.deadlineText} allowFontScaling={false}>
            {DEADLINE_LABEL}
          </Text>
        </View>
      </View>

      {/* ── 리그/친구 세그먼트 ── */}
      <View style={s.segmentWrap}>
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
          {/* ── 시험 칩 — 정적 UI (시험별 리그는 백엔드 미지원) ── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.chipsScroll}
            contentContainerStyle={s.chips}
          >
            {EXAM_CHIPS.map((label, i) => (
              <View key={label} style={[s.chip, i === 0 ? s.chipOn : null]}>
                <Text style={[s.chipText, i === 0 ? s.chipTextOn : null]}>{label}</Text>
              </View>
            ))}
          </ScrollView>

          {/* ── 내 티어 스트립 → 티어 안내 ── */}
          <TouchableOpacity
            style={s.tierStrip}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('TierGuide')}
          >
            <Image source={myTier.image} style={s.tierStripImg} />
            <Text style={s.tierStripText}>내 티어 · {myTier.name}</Text>
            <Ionicons name="chevron-forward" size={14} color={T.inkMuted} />
          </TouchableOpacity>

          {/* ── 아레나 랭킹 ── */}
          <ScrollView
            style={s.list}
            contentContainerStyle={{
              paddingBottom: insets.bottom + TAB_BAR_SPACE + SHEET_COLLAPSED_SPACE + 12,
            }}
            showsVerticalScrollIndicator={false}
          >
            {ARENA_RANKING.map((m) => {
              const isMe = m.userId === MY_USER_ID;
              return (
                <RankRow
                  key={m.userId}
                  rank={m.rank}
                  nickname={m.nickname}
                  tierLevel={myTierLevel}
                  minutes={m.totalFocusMinutes}
                  isMe={isMe}
                  pinned={!isMe && pinned.has(m.userId)}
                  onPress={() => openProfileById(m.userId)}
                  onPin={isMe ? undefined : () => togglePin(m.userId)}
                />
              );
            })}
          </ScrollView>
        </>
      ) : (
        /* ── 친구 탭 — 친구 추가 진입 + 친구 목록(핀 재사용) ── */
        <ScrollView
          style={s.list}
          contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_SPACE + 20 }}
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            style={s.addBtn}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('FriendAdd')}
          >
            <Ionicons name="person-add" size={16} color={T.white} />
            <Text style={s.addBtnText}>친구 추가하기</Text>
            {RECEIVED_REQUESTS.length > 0 && (
              <View style={s.reqBadge}>
                <Text style={s.reqBadgeText} allowFontScaling={false}>
                  {RECEIVED_REQUESTS.length}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          <Text style={s.friendCount}>내 친구 {FRIENDS.length}</Text>
          {FRIENDS.map((f) => (
            <RankRow
              key={f.userId}
              rank={null}
              nickname={f.nickname}
              tierLevel={f.tierLevel ?? 1}
              minutes={minutesOf(f.userId)}
              pinned={pinned.has(f.userId)}
              onPress={() => openProfileById(f.userId)}
              onPin={() => togglePin(f.userId)}
            />
          ))}
        </ScrollView>
      )}

      {/* ── 하단 "나만의 랭킹" 시트 — 리그 탭에서만 ── */}
      {tab === 'league' && (
        <MyRankingSheet
          open={sheetOpen}
          onToggle={() => setSheetOpen((o) => !o)}
          entries={sheetEntries}
          onPressEntry={(e) => openProfileById(e.userId)}
          bottom={insets.bottom + TAB_BAR_SPACE + 6}
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  headerTitle: { ...T.text.title, color: T.ink },
  deadlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FBF3E8',
    borderWidth: 1,
    borderColor: '#EAD9BC',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  deadlineText: { ...T.text.caption, color: T.accentDeep },

  segmentWrap: { paddingHorizontal: 18 },
  segment: { flexDirection: 'row', backgroundColor: '#F1E9DA', borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  segBtnOn: {
    backgroundColor: T.white,
    shadowColor: '#50371E',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segText: { ...T.text.label, color: T.inkMuted },
  segTextOn: { color: T.ink },

  chipsScroll: { flexGrow: 0, marginTop: 12 },
  chips: { paddingHorizontal: 18, gap: 7 },
  chip: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: T.accent, borderColor: T.accent },
  chipText: { ...T.text.caption, color: T.inkSub },
  chipTextOn: { color: T.white },

  tierStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginHorizontal: 18,
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  tierStripImg: { width: 24, height: 24, resizeMode: 'contain' },
  tierStripText: { ...T.text.caption, color: T.inkSub },

  list: { flex: 1, paddingHorizontal: 18 },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: T.accent,
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 12,
  },
  addBtnText: { ...T.text.label, fontSize: 16, color: T.white },
  reqBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: T.accentAlt,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  reqBadgeText: { fontSize: 12, fontWeight: '800', color: T.white },
  friendCount: { ...T.text.label, color: T.inkSub, marginTop: 16, marginBottom: 9 },
});
