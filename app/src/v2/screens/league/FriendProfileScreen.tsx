import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { T } from '@/constants/theme';
import { tierByLevel } from '@/constants/tiers';
import CircularGauge from '@/components/CircularGauge';
import { getPublicProfile, getUserStats } from '@/services/userApi';
import { getHeatmap } from '@/services/statsApi';
import type { PublicProfileResponse, UserStatsResponse } from '@/types/dto/user';
import type { HeatmapCellResponse } from '@/types/dto/stats';
import type { V2RootStackParamList } from '@/navigation/types';
import {
  deleteFriend,
  fetchFriends,
  pinFriend,
  sendFriendRequest,
  unpinFriend,
} from './friendsApi';
import { fmtHourMin } from './format';
import { heatmapRange } from '@/v2/screens/stats/format';
import { MemberAvatar } from './components/MemberAvatar';
import { DuoDayChart } from './components/DuoDayChart';
import { SubjectCompareCard } from './components/SubjectCompareCard';
import { ComingSoon } from '@/v2/screens/stats/ComingSoon';
import { TEASER_SUBJECTS, type CompareByDay } from './mock';

// 프로필 상세 (GROMO-605 다른 사람 통계) — 실 API 연동.
// 공개 프로필(getPublicProfile): 아바타·이름·친구 수·티어·전체 랭킹 → 항상 공개.
// 상세 통계(getUserStats): 목표달성·이번 주 집중·스트릭·요일 비교 → 대상 statVisibility(친구공개/전체공개)에 따라.
//   today/heatmap 이 오면 공개(친구 또는 전체공개), null 이면 잠금 → 친구 신청 유도.
// 요일별 집중·폰 사용 비교는 내 heatmap + 상대 heatmap 으로 실계산(월~일). 과목별 비교는 준비 중(친구 by-category 대기, GROMO-624).
// 친구 신청/끊기·핀 토글은 실 API(./friendsApi) — 관계는 통계 공개와 별개.

const THEIRS_FOCUS = '#9A6FB0';
const THEIRS_PHONE = '#B08FC4';
const UNFRIEND_INK = '#9A5A48';

// 최근 7일 히트맵 → 월~일(0=월..6=일) 분 배열.
function byWeekday(
  cells: HeatmapCellResponse[],
  pick: (c: HeatmapCellResponse) => number,
): number[] {
  const arr = [0, 0, 0, 0, 0, 0, 0];
  for (const c of cells) {
    const [y, m, d] = c.date.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay(); // 0=일..6=토
    arr[dow === 0 ? 6 : dow - 1] += pick(c);
  }
  return arr;
}

export default function FriendProfileScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<V2RootStackParamList, 'FriendProfile'>>();
  const { userId, nickname, tierLevel, exam } = route.params;

  // 친구 관계·핀은 진입점 파라미터 + 서버 친구 목록으로 관리(통계 공개와 별개).
  const [isFriend, setIsFriend] = useState(route.params.isFriend);
  const [isPinned, setIsPinned] = useState(route.params.isPinned ?? false);
  const [requested, setRequested] = useState(false);

  const [profile, setProfile] = useState<PublicProfileResponse | null>(null);
  const [stats, setStats] = useState<UserStatsResponse | null>(null);
  const [myHeatmap, setMyHeatmap] = useState<HeatmapCellResponse[]>([]);
  const [loading, setLoading] = useState(true);

  // 공개 프로필 + 타 유저 통계 + 내 히트맵(비교용) 조회.
  useEffect(() => {
    let stale = false;
    (async () => {
      const { from, to } = heatmapRange('WEEK');
      const [p, st, mine] = await Promise.all([
        getPublicProfile(userId).catch(() => null),
        getUserStats(userId).catch(() => null),
        getHeatmap(from, to).catch(() => [] as HeatmapCellResponse[]),
      ]);
      if (stale) return;
      setProfile(p);
      setStats(st);
      setMyHeatmap(mine);
      setLoading(false);
    })();
    return () => {
      stale = true;
    };
  }, [userId]);

  // 서버 친구 목록으로 친구/핀 상태 재동기화 — 검색·랭킹 진입은 isPinned를 모른 채 들어온다.
  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        const list = await fetchFriends();
        if (stale) return;
        const mine = list.find((f) => f.userId === userId);
        setIsFriend(mine != null);
        setIsPinned(mine?.isPinned ?? false);
      } catch {
        // 실패 시 진입 파라미터 초기값 유지
      }
    })();
    return () => {
      stale = true;
    };
  }, [userId]);

  // 핀 토글 — 낙관적 갱신, 실패 시 롤백 (서버 멱등이라 중복 탭 안전)
  async function togglePin() {
    const next = !isPinned;
    setIsPinned(next);
    try {
      if (next) {
        await pinFriend(userId);
      } else {
        await unpinFriend(userId);
      }
    } catch {
      setIsPinned(!next);
      Alert.alert('핀 변경 실패', '잠시 후 다시 시도해주세요.');
    }
  }

  async function requestFriend() {
    try {
      await sendFriendRequest(userId);
      setRequested(true);
    } catch (e) {
      // 409 = 이미 친구/이미 보낸 요청 — 요청됨으로 간주
      if (axios.isAxiosError(e) && e.response?.status === 409) {
        setRequested(true);
      } else {
        Alert.alert('친구 신청 실패', '잠시 후 다시 시도해주세요.');
      }
    }
  }

  function unfriend() {
    Alert.alert('친구 끊기', `${nickname}님과 친구를 끊을까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '끊기',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteFriend(userId);
            setIsFriend(false);
          } catch (e) {
            // 404 = 이미 친구 아님 — 화면도 비친구로 전환
            if (axios.isAxiosError(e) && e.response?.status === 404) {
              setIsFriend(false);
            } else {
              Alert.alert('친구 끊기 실패', '잠시 후 다시 시도해주세요.');
            }
          }
        },
      },
    ]);
  }

  const tier = tierByLevel(profile?.currentTier ?? tierLevel);
  const friendCount = profile?.friendCount ?? 0;
  const rank = profile?.rank ?? null;

  // 상세 통계 공개 여부 — today/heatmap 이 오면 공개(친구 또는 대상이 전체공개). 관계와 별개.
  const statsVisible = stats?.today != null;
  const goalPercent = stats?.today?.focus.progressPercent ?? 0;
  const weekFocusMinutes = (stats?.heatmap ?? []).reduce((a, c) => a + c.totalFocusMinutes, 0);
  const streakDays = stats?.streak.currentStreak ?? 0;

  const focusByDay: CompareByDay = {
    mine: byWeekday(myHeatmap, (c) => c.totalFocusMinutes),
    theirs: byWeekday(stats?.heatmap ?? [], (c) => c.totalFocusMinutes),
  };
  const phoneByDay: CompareByDay = {
    mine: byWeekday(myHeatmap, (c) => c.actualScreenTimeMinutes),
    theirs: byWeekday(stats?.heatmap ?? [], (c) => c.actualScreenTimeMinutes),
  };

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── 헤더 (원형 백버튼 + 좌측 제목 + 우측 핀 토글 — 핀은 나만의 랭킹 고정용) ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color="#5C5246" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>프로필</Text>
        {isFriend && (
          <TouchableOpacity
            style={[s.pinBtn, isPinned && s.pinBtnOn]}
            onPress={togglePin}
            activeOpacity={0.7}
            hitSlop={6}
          >
            <Ionicons
              name={isPinned ? 'pin' : 'pin-outline'}
              size={16}
              color={isPinned ? T.white : T.inkSub}
            />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 아바타·이름·친구 수·티어·전체 랭킹 ── */}
        <View style={s.heroCol}>
          <MemberAvatar size={96} />
          <View style={s.nameRow}>
            <Text style={s.name} numberOfLines={1}>
              {nickname}
            </Text>
            <View style={s.friendPill}>
              <Ionicons name="person-outline" size={11} color={T.inkSub} />
              <Text style={s.friendPillText} allowFontScaling={false}>
                친구 {friendCount}
              </Text>
            </View>
          </View>
          <LinearGradient
            colors={['#D49A4E', T.accent]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.tierPill}
          >
            <Ionicons name="star" size={12} color={T.white} />
            <Text style={s.tierPillText}>{tier.name}</Text>
          </LinearGradient>
          {rank != null && <Text style={s.rankText}>전체 랭킹 {rank}위</Text>}
        </View>

        {loading ? (
          <View style={s.loader}>
            <ActivityIndicator color={T.accent} />
          </View>
        ) : (
          <>
            {/* ── 요약: 목표 달성 링 + 이번 주 집중 + 연속 (비공개면 상세는 잠금, 연속은 항상) ── */}
            <View style={s.summaryRow}>
              <View style={s.ringCard}>
                <CircularGauge
                  size={64}
                  progress={statsVisible ? goalPercent / 100 : 0}
                  trackColor="#EFE7D8"
                  progressColor={T.accent}
                >
                  {statsVisible ? (
                    <Text style={s.ringValue} allowFontScaling={false}>
                      {goalPercent}%
                    </Text>
                  ) : (
                    <Ionicons name="lock-closed" size={15} color={T.inkMuted} />
                  )}
                </CircularGauge>
                <Text style={s.ringLabel}>목표 달성</Text>
              </View>
              <View style={s.summaryCol}>
                <View style={s.summaryCard}>
                  <Text style={s.summaryLabel}>이번 주 집중</Text>
                  <Text style={s.summaryValue} allowFontScaling={false}>
                    {statsVisible ? fmtHourMin(weekFocusMinutes) : '비공개'}
                  </Text>
                </View>
                <View style={s.summaryCard}>
                  <Text style={s.summaryLabel}>연속</Text>
                  <Text style={s.summaryValue} allowFontScaling={false}>
                    {streakDays}일
                  </Text>
                </View>
              </View>
            </View>

            {/* ── 준비 시험 — 실유저 응답엔 아직 없어 값이 있을 때만 표시(TODO: 백엔드 협의) ── */}
            {exam != null && (
              <View style={s.examCard}>
                <View style={s.examIcon}>
                  <Ionicons name="calendar-outline" size={16} color={T.accentDeep} />
                </View>
                <View style={s.examCol}>
                  <Text style={s.examLabel}>준비 시험</Text>
                  <Text style={s.examValue}>{exam}</Text>
                </View>
              </View>
            )}

            {statsVisible ? (
              <>
                {/* 요일별 집중·폰 사용 비교 — 내 히트맵 vs 상대 히트맵(실데이터) */}
                <View style={s.chartGap}>
                  <DuoDayChart
                    title="이번 주 요일별 집중시간"
                    data={focusByDay}
                    mineColor={T.accent}
                    theirsColor={THEIRS_FOCUS}
                    opponentName={nickname}
                  />
                </View>
                <View style={s.chartGap}>
                  <DuoDayChart
                    title="이번 주 요일별 폰 사용시간"
                    data={phoneByDay}
                    mineColor={T.accentAlt}
                    theirsColor={THEIRS_PHONE}
                    opponentName={nickname}
                  />
                </View>
                {/* 과목별 비교 — 친구 by-category 대기(GROMO-624). 실카드 + 블러 티저 */}
                <View style={s.chartGap}>
                  <ComingSoon note="같은 과목 공부량 비교를 준비하고 있어요">
                    <SubjectCompareCard subjects={TEASER_SUBJECTS} opponentName={nickname} />
                  </ComingSoon>
                </View>
              </>
            ) : (
              /* 비공개(친구 아님 + 친구공개 대상) — 상세 통계 잠금 */
              <View style={s.lockCard}>
                <View style={s.lockCircle}>
                  <Ionicons name="lock-closed" size={18} color={T.accent} />
                </View>
                <Text style={s.lockTitle}>친구만 볼 수 있어요</Text>
                <Text style={s.lockSub}>
                  친구가 되면 집중·폰 사용 통계를{'\n'}나와 비교해서 볼 수 있어요.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* ── 하단 고정 CTA — 친구면 끊기(아웃라인), 비친구면 신청(강조) ── */}
      <View style={[s.ctaWrap, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
        {isFriend ? (
          <TouchableOpacity style={s.unfriendBtn} activeOpacity={0.85} onPress={unfriend}>
            <Ionicons name="person-remove-outline" size={16} color={UNFRIEND_INK} />
            <Text style={s.unfriendText}>친구 끊기</Text>
          </TouchableOpacity>
        ) : requested ? (
          <View style={s.requestedBtn}>
            <Text style={s.requestedText}>요청됨</Text>
          </View>
        ) : (
          <TouchableOpacity style={s.requestBtn} activeOpacity={0.85} onPress={requestFriend}>
            <Ionicons name="person-add" size={17} color={T.white} />
            <Text style={s.requestText}>친구 신청</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F1EADD' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 8,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { ...T.text.heading, fontWeight: '800', color: T.ink, flex: 1 },
  pinBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBtnOn: { backgroundColor: T.accent, borderColor: T.accent },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 16 },

  // 아바타·이름·티어
  heroCol: { alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  name: { ...T.text.stat, color: T.ink, maxWidth: 200 },
  friendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFE7D8',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  friendPillText: { ...T.text.caption, fontSize: 11, fontWeight: '700', color: '#5C5246' },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingLeft: 10,
    paddingRight: 13,
    paddingVertical: 5,
    marginTop: 9,
  },
  tierPillText: { ...T.text.caption, fontSize: 12, fontWeight: '700', color: T.white },
  rankText: { ...T.text.caption, color: T.inkSub, marginTop: 8 },

  loader: { paddingVertical: 48, alignItems: 'center' },

  // 요약(링 + 이번 주/연속)
  summaryRow: { flexDirection: 'row', gap: 10, marginTop: 18, marginBottom: 10 },
  ringCard: {
    width: 104,
    alignItems: 'center',
    gap: 6,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    padding: 12,
  },
  ringValue: { ...T.text.label, fontWeight: '800', color: T.ink },
  ringLabel: { ...T.text.caption, fontSize: 11, color: T.inkSub },
  summaryCol: { flex: 1, gap: 10 },
  summaryCard: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  summaryLabel: { ...T.text.caption, fontSize: 11, fontWeight: '500', color: T.inkMuted },
  summaryValue: {
    ...T.text.subtitle,
    fontWeight: '800',
    color: T.ink,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },

  // 준비 시험
  examCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  examIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: T.caramel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  examCol: { flex: 1 },
  examLabel: { ...T.text.caption, fontSize: 11, fontWeight: '500', color: T.inkMuted },
  examValue: { ...T.text.label, fontWeight: '700', color: T.ink },

  chartGap: { marginTop: 12 },

  // 상세 통계 잠금(비공개)
  lockCard: {
    marginTop: 12,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
  },
  lockCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: T.paperLight,
    borderWidth: 1,
    borderColor: T.paperAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  lockTitle: { ...T.text.label, fontWeight: '700', color: T.ink },
  lockSub: {
    ...T.text.caption,
    fontWeight: '500',
    color: T.inkSub,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 4,
  },

  // 하단 CTA
  ctaWrap: { paddingHorizontal: 18, paddingTop: 12 },
  requestBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: T.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    shadowColor: T.accent,
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  requestText: { ...T.text.body, fontWeight: '700', color: T.white },
  requestedBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: '#EFE7D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestedText: { ...T.text.body, fontWeight: '700', color: T.inkSub },
  unfriendBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  unfriendText: { ...T.text.label, fontWeight: '700', color: UNFRIEND_INK },
});
