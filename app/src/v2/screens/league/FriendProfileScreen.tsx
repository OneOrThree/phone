import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { T } from '@/v2/constants/theme';
import { tierByLevel } from '@/v2/constants/tiers';
import CircularGauge from '@/v2/components/CircularGauge';
import type { V2RootStackParamList } from '@/v2/navigation/types';
import { COMPARE_FALLBACK, PROFILE_COMPARE, RANKING, TEASER_SUBJECTS } from './mock';
import {
  deleteFriend,
  fetchFriends,
  pinFriend,
  sendFriendRequest,
  unpinFriend,
} from './friendsApi';
import { fmtHourMin } from './format';
import { MemberAvatar } from './components/MemberAvatar';
import { SubjectCompareCard } from './components/SubjectCompareCard';
import { DuoDayChart } from './components/DuoDayChart';

// 프로필 상세 (root stack, 풀스크린) — 시안 "프로필 · 비친구/친구/겹치는 과목 없음" 3분기.
// 공통: 아바타·이름·친구 pill·티어 pill → 요약(목표 달성 링·이번 주 집중·연속) → 준비 시험.
// 분기: 비친구        = 과목 비교 카드를 블러 티저로 잠금 + [친구 신청] CTA
//       친구·과목 겹침 = 과목별 비교 + 요일별 집중·폰 사용 비교 + [친구 끊기]
//       친구·겹침 없음 = 안내 배너 + 요일별 비교 2종 + [친구 끊기]
// 친구 신청(POST /friends/requests)·끊기(DELETE /friends/{id})는 실API(./friendsApi).
// 요약·비교 통계는 아직 mock — TODO: 프로필 통계/비교 API 백엔드 협의 후 교체.

// 시안 비교 색 — 상대(보라) / 폰 사용 상대(연보라). 나(폰 사용)는 T.accentAlt
const THEIRS_FOCUS = '#9A6FB0';
const THEIRS_PHONE = '#B08FC4';
// 친구 끊기 텍스트 색(시안 고유색)
const UNFRIEND_INK = '#9A5A48';

export default function FriendProfileScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<V2RootStackParamList, 'FriendProfile'>>();
  const { userId, nickname, tierLevel, exam } = route.params;

  // 랭킹(mock)에 있는 유저면 요약 표시값, 실유저는 0 기본값 — TODO: 프로필 통계 API
  const member = RANKING.find((m) => m.userId === userId);
  const tier = tierByLevel(tierLevel);

  // 친구 여부는 진입점(그리드/검색 relation/랭킹)이 전달 — 끊으면 즉시 비친구(잠금) 분기 전환
  const [isFriend, setIsFriend] = useState(route.params.isFriend);
  const [isPinned, setIsPinned] = useState(route.params.isPinned ?? false);
  const [requested, setRequested] = useState(false);

  // 서버 친구 목록으로 친구/핀 상태 재동기화 — 검색·랭킹 진입은 isPinned를 모른 채 들어온다
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

  // 핀 토글 — 낙관적 갱신, 실패 시 롤백 (서버는 멱등이라 중복 탭 안전)
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

  const compare = PROFILE_COMPARE[userId] ?? COMPARE_FALLBACK;
  const hasOverlap = compare.subjects.length > 0;

  async function requestFriend() {
    try {
      await sendFriendRequest(userId);
      setRequested(true);
    } catch (e) {
      // 409 = 이미 친구/이미 보낸 요청 — 요청됨으로 간주 (mock 랭킹 유저는 404가 나 실패 안내)
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
        {/* ── 아바타·이름·친구 수·티어 ── */}
        <View style={s.heroCol}>
          <MemberAvatar size={96} />
          <View style={s.nameRow}>
            <Text style={s.name} numberOfLines={1}>
              {nickname}
            </Text>
            <View style={s.friendPill}>
              <Ionicons name="person-outline" size={11} color={T.inkSub} />
              <Text style={s.friendPillText} allowFontScaling={false}>
                친구 {member?.friendCount ?? 0}
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
        </View>

        {/* ── 요약: 목표 달성 링 + 이번 주 집중·연속 ── */}
        <View style={s.summaryRow}>
          <View style={s.ringCard}>
            <CircularGauge
              size={64}
              progress={member?.achievedRate ?? 0}
              trackColor="#EFE7D8"
              progressColor={T.accent}
            >
              <Text style={s.ringValue} allowFontScaling={false}>
                {Math.round((member?.achievedRate ?? 0) * 100)}%
              </Text>
            </CircularGauge>
            <Text style={s.ringLabel}>목표 달성</Text>
          </View>
          <View style={s.summaryCol}>
            <View style={s.summaryCard}>
              <Text style={s.summaryLabel}>이번 주 집중</Text>
              <Text style={s.summaryValue} allowFontScaling={false}>
                {fmtHourMin(member?.totalFocusMinutes ?? 0)}
              </Text>
            </View>
            <View style={s.summaryCard}>
              <Text style={s.summaryLabel}>연속</Text>
              <Text style={s.summaryValue} allowFontScaling={false}>
                {member?.streakDays ?? 0}일
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

        {isFriend ? (
          <>
            {/* 과목 겹침 → 과목별 비교 / 없음 → 안내 배너 */}
            {hasOverlap ? (
              <SubjectCompareCard subjects={compare.subjects} opponentName={nickname} />
            ) : (
              <View style={s.noOverlapNote}>
                <Ionicons name="star" size={15} color={T.accent} />
                <Text style={s.noOverlapText}>
                  겹치는 공부 과목이 없습니다. 요일별 집중·폰 사용시간으로 비교해요.
                </Text>
              </View>
            )}
            <View style={s.chartGap}>
              <DuoDayChart
                title="이번 주 요일별 집중시간"
                data={compare.focusByDay}
                mineColor={T.accent}
                theirsColor={THEIRS_FOCUS}
                opponentName={nickname}
              />
            </View>
            <View style={s.chartGap}>
              <DuoDayChart
                title="이번 주 요일별 폰 사용시간"
                data={compare.phoneByDay}
                mineColor={T.accentAlt}
                theirsColor={THEIRS_PHONE}
                opponentName={nickname}
              />
            </View>
          </>
        ) : (
          /* 비친구 — 비교 카드 블러 티저(잠금) */
          <View style={s.teaserWrap}>
            <SubjectCompareCard subjects={TEASER_SUBJECTS} opponentName={nickname} />
            <BlurView intensity={26} tint="light" style={StyleSheet.absoluteFill} />
            <View style={s.lockOverlay}>
              <View style={s.lockCircle}>
                <Ionicons name="lock-closed" size={18} color={T.accent} />
              </View>
              <Text style={s.lockTitle}>친구만 볼 수 있어요</Text>
              <Text style={s.lockSub}>
                친구가 되면 과목별 공부량을{'\n'}나와 비교해서 볼 수 있어요.
              </Text>
            </View>
          </View>
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

  // 겹치는 과목 없음 안내
  noOverlapNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  noOverlapText: { ...T.text.caption, flex: 1, fontWeight: '600', color: T.link, lineHeight: 19 },

  chartGap: { marginTop: 12 },

  // 비친구 블러 티저
  teaserWrap: { borderRadius: 16, overflow: 'hidden' },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  lockCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  lockTitle: { ...T.text.caption, fontWeight: '700', color: T.ink },
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
