import { useEffect, useRef, useState } from 'react';
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { tierByLevel } from '@/constants/tiers';
import { categoryForOccupation } from '@/constants/focusCategories';
import { getPublicProfile, getUserStats } from '@/services/userApi';
import { getFocusStatsByCategory, getHeatmap, getTodayStats } from '@/services/statsApi';
import type { PublicProfileResponse, UserStatsResponse } from '@/types/dto/user';
import type { HeatmapCellResponse, StatsPeriod, TodayStatsResponse } from '@/types/dto/stats';
import type { V2RootStackParamList } from '@/navigation/types';
import {
  deleteFriend,
  fetchFriends,
  fetchPinnedFriends,
  fetchSentRequests,
  pinFriend,
  sendFriendRequest,
  unpinFriend,
} from '@/services/friendsApi';
import {
  logFriendPinToggled,
  logFriendRequestSent,
  logFriendUnfriended,
} from '@/services/analyticsEvents';
import { fmtMinutes } from './format';
import { heatmapRange } from '@/screens/stats/format';
import { MemberAvatar } from './components/MemberAvatar';
import { TierBadge } from './components/TierBadge';
import { DuoDayChart } from './components/DuoDayChart';
import { SubjectCompareCard } from './components/SubjectCompareCard';
import { ComingSoon } from '@/screens/stats/ComingSoon';
import { TEASER_SUBJECTS, type CompareByDay, type SubjectCompare } from './mock';

// 프로필 상세 (GROMO-605 다른 사람 통계) — 실 API 연동.
// 공개 프로필(getPublicProfile): 아바타·이름·준비 시험(occupation)·친구 수·티어 → 항상 공개.
// 순위는 서버 rank(아레나 내) 대신 진입한 랭킹 목록의 rank 파라미터를 표시(GROMO-685).
// 통계(getUserStats): 요약(today=목표달성·오늘 집중, streak=연속)은 친구 여부/공개설정 무관 항상 공개(GROMO-746).
//   세부 차트(heatmap)만 대상 statVisibility 게이트 — null 이면 잠금 카드 → 친구 신청 유도.
// 요일별 집중·폰 사용 비교는 내 heatmap + 상대 heatmap 으로 실계산(월~일).
// 과목별 비교는 by-category?friends=(GROMO-624)로 실비교 — 겹치는 태그만, 겹침 없으면 안내 배너, 미확보 시 블러 티저.
// 친구 신청/끊기·핀 토글은 실 API(./friendsApi) — 관계는 통계 공개와 별개.

const THEIRS_FOCUS = T.compare.theirs;
const THEIRS_PHONE = T.compare.theirsPhone;
const UNFRIEND_INK = T.dangerInk;

// 히트맵 → 월~일(0=월..6=일) 분 배열.
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
  // rank = 진입한 랭킹 목록에서의 순위(어느 랭킹에서 눌렀느냐에 따라 값이 다름) — 서버 프로필
  // rank(아레나 내 순위)와 달라 목록 값을 그대로 표시한다. 랭킹 외 진입(검색·친구·요청)은
  // 미전달 → 순위 미표시 (GROMO-685).
  const { userId, nickname, tierLevel, rank } = route.params;

  // 친구 관계는 진입점 파라미터 + 서버 친구 목록, 핀은 파라미터 + 서버 핀 목록으로 관리(통계 공개와 별개).
  const [isFriend, setIsFriend] = useState(route.params.isFriend);
  const [isPinned, setIsPinned] = useState(route.params.isPinned ?? false);
  // 이 화면에서 핀을 토글했는지 — 마운트 시 핀 목록 조회가 토글 전 스냅샷으로 뒤늦게 도착해
  // 방금 누른 핀을 덮지 않게 가드(PR 267 리뷰 반영). 토글 후엔 낙관적 갱신+실패 롤백이 진실이다.
  const pinTouched = useRef(false);
  const [requested, setRequested] = useState(false);

  const [profile, setProfile] = useState<PublicProfileResponse | null>(null);
  const [stats, setStats] = useState<UserStatsResponse | null>(null);
  const [myHeatmap, setMyHeatmap] = useState<HeatmapCellResponse[]>([]);
  const [loading, setLoading] = useState(true);
  // 과목별 비교(겹치는 태그) — undefined = 미확보(블러 티저 유지), [] = 겹침 없음, N개 = 실비교.
  // GROMO-692: 오늘/이번주/이번달 탭 — `${userId}:${period}` 키로 캐시해 탭을 오가도 재조회 없이
  // 즉시 전환된다. 키에 userId 포함 — 지금은 프로필→프로필 직행 경로가 없지만, navigate 재사용으로
  // params만 바뀌는 진입이 생기면 이전 친구 데이터가 새 화면에 남는다(PR 252 리뷰 선반영).
  const [subjectPeriod, setSubjectPeriod] = useState<StatsPeriod>('WEEK');
  const [subjectCompareByKey, setSubjectCompareByKey] = useState<Record<string, SubjectCompare[]>>(
    {},
  );
  // 조회 시작 키 — 도착 상태를 effect 의존성으로 쓰면 다른 기간 도착마다 재실행된다(PR 252 리뷰)
  const subjectCompareFetched = useRef(new Set<string>());
  const subjectCompareUnmounted = useRef(false);
  useEffect(
    () => () => {
      subjectCompareUnmounted.current = true;
    },
    [],
  );
  // 상세 조회 실패 시 강등 폴백 — GROMO-640 이후 PUBLIC도 getUserStats가 상세(heatmap 포함)를
  // 채워주므로 평시엔 발동하지 않는다. getUserStats가 실패한 경우에만 /stats/today?friends=
  // (PUBLIC·친구 허용, GROMO-623)로 today를 직접 조회해 요약이라도 보여준다.
  const [publicStats, setPublicStats] = useState<{ today: TodayStatsResponse } | null>(null);

  // 공개 프로필 + 타 유저 통계 + 내 히트맵(비교용) 조회.
  useEffect(() => {
    let stale = false;
    (async () => {
      // 요일 비교는 이번 주(월~오늘) 기준 — 내 heatmap은 이번 주만 조회하고,
      // 타 유저 heatmap(서버가 최근 7일 고정 반환)은 렌더 시 이번 주만 걸러 쓴다.
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

  // 서버 친구 목록·핀 목록·보낸 요청으로 친구/핀/요청 상태 재동기화 — 검색·랭킹 진입은 isPinned도,
  // 이미 보낸 PENDING 요청도 모른 채 들어온다. 요청 상태를 안 채우면 이미 신청한 상대에게
  // '친구 신청' 버튼이 다시 노출돼 중복 신청이 가능해진다(서버는 409로 막지만 UI가 오해를 준다).
  // 핀은 친구 아니어도 가능(GROMO-609)이라 친구 목록의 isPinned가 아닌 핀 목록(GET /pins)으로 판정한다
  // — 친구 목록 기반이면 핀한 비친구가 진입 직후 핀 꺼짐으로 덮인다(GROMO-845).
  useEffect(() => {
    let stale = false;
    (async () => {
      const [list, pins, sent] = await Promise.all([
        fetchFriends().catch(() => null), // 실패 시 진입 파라미터 초기값 유지
        fetchPinnedFriends().catch(() => null), // 실패 시 핀 상태는 진입 파라미터 초기값 유지
        fetchSentRequests().catch(() => null), // 실패 시 요청 상태는 현재값 유지
      ]);
      if (stale) return;
      if (list) {
        setIsFriend(list.some((f) => f.userId === userId));
      }
      if (pins && !pinTouched.current) {
        setIsPinned(pins.some((p) => p.userId === userId));
      }
      if (sent) {
        // 이 화면에서 방금 누른 상태(true)를 조회 응답이 덮지 않게 OR 유지.
        setRequested((prev) => prev || sent.some((r) => r.userId === userId));
      }
    })();
    return () => {
      stale = true;
    };
  }, [userId]);

  // 핀 토글 — 낙관적 갱신, 실패 시 롤백 (서버 멱등이라 중복 탭 안전)
  async function togglePin() {
    pinTouched.current = true;
    const next = !isPinned;
    setIsPinned(next);
    try {
      if (next) {
        await pinFriend(userId);
      } else {
        await unpinFriend(userId);
      }
      logFriendPinToggled({ pinned: next }); // 서버 반영 성공 시에만 — 롤백되는 낙관 상태는 미집계
    } catch {
      setIsPinned(!next);
      Alert.alert('핀 변경 실패', '잠시 후 다시 시도해주세요.');
    }
  }

  async function requestFriend() {
    try {
      await sendFriendRequest(userId);
      setRequested(true);
      logFriendRequestSent({ source: 'friend_profile' }); // 성공 시에만 — 409(중복)는 미발행
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
            logFriendUnfriended();
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
  // 준비 시험 표시명 — 공개 프로필의 occupation 코드를 로컬 카테고리명으로 매핑.
  // 미설정·미로드면 null → 카드 숨김. (구 route 파라미터 exam은 리그 라벨이라 대상의 시험이 아니어서 폐기, GROMO-680)
  const examLabel = categoryForOccupation(profile?.occupation ?? null);

  // 세부 차트(요일 비교) 공개 여부 — heatmap 게이트(본인·친구·전체공개).
  // GROMO-746부터 today는 친구 여부/공개설정과 무관하게 항상 오므로 판정 기준은 heatmap (7/10 기획: 요약 상시 공개).
  const detailVisible = stats?.heatmap != null;
  // 강등 요약 — getUserStats 자체가 실패하고 /stats/*?friends= 폴백만 성공한 경우(요약·과목별만).
  const publicVisible = !detailVisible && publicStats != null;
  // 요약(목표달성·오늘 집중·연속) — 성공 응답이면 항상 공개, 실패 시에만 폴백이 채움.
  const summaryVisible = stats?.today != null || publicVisible;

  // 강등 폴백 조회 — getUserStats 호출 자체가 실패했을 때만 시도(성공 응답엔 today가 항상 있음, GROMO-746).
  // 폴백 게이트는 여전히 친구·PUBLIC만 허용이라 FRIENDS 비공개 대상은 404로 떨어져 빈 상태 유지.
  useEffect(() => {
    if (loading || stats != null) {
      setPublicStats(null);
      return;
    }
    let stale = false;
    (async () => {
      const t = await getTodayStats(userId).catch(() => null);
      if (stale || !t) return;
      setPublicStats({ today: t });
    })();
    return () => {
      stale = true;
    };
  }, [loading, stats, userId]);

  // 과목별 비교(GROMO-624) — 세부 공개(친구·본인·PUBLIC) 대상. 내 by-category + 상대
  // by-category를 태그명으로 매칭해 겹치는 과목만 비교. 한쪽이라도 실패하면 undefined 유지(블러 티저).
  // 기간은 선택 탭(GROMO-692)을 따르고, 이미 캐시된(조회 시작한) 키는 재조회하지 않는다.
  const canCompareSubjects = detailVisible || publicVisible;
  const subjectCompareKey = `${userId}:${subjectPeriod}`;
  const subjectCompare = canCompareSubjects ? subjectCompareByKey[subjectCompareKey] : undefined;
  useEffect(() => {
    if (!canCompareSubjects || subjectCompareFetched.current.has(subjectCompareKey)) return;
    subjectCompareFetched.current.add(subjectCompareKey);
    (async () => {
      const [mine, theirs] = await Promise.all([
        getFocusStatsByCategory(subjectPeriod).catch(() => null),
        getFocusStatsByCategory(subjectPeriod, userId).catch(() => null),
      ]);
      if (!mine || !theirs) {
        // 미확보 — 티저 유지. 시작 표시를 지워 탭 재방문·화면 재진입에서 다시 시도한다.
        subjectCompareFetched.current.delete(subjectCompareKey);
        return;
      }
      if (subjectCompareUnmounted.current) return;
      const mineByName = new Map(
        mine.items
          .filter((i) => i.tagName != null)
          .map((i) => [i.tagName as string, i.totalFocusMinutes]),
      );
      const rows: SubjectCompare[] = theirs.items
        .filter(
          (i): i is typeof i & { tagName: string } =>
            i.tagName != null && mineByName.has(i.tagName),
        )
        .map((i) => ({
          name: i.tagName,
          myMinutes: mineByName.get(i.tagName) ?? 0,
          theirMinutes: i.totalFocusMinutes,
        }));
      // 키 스코프 캐시라 뒤늦게 도착해도 자기 키에 쓰면 안전 — 언마운트 후 쓰기만 막는다
      setSubjectCompareByKey((prev) => ({ ...prev, [subjectCompareKey]: rows }));
    })();
  }, [canCompareSubjects, userId, subjectPeriod, subjectCompareKey]);

  // 요약 값 — getUserStats(항상 공개, GROMO-746), 실패 시엔 폴백 조회값 사용.
  const todayFocusMinutes =
    stats?.today?.focus.todayMinutes ?? publicStats?.today.focus.todayMinutes ?? 0;
  const streakDays = stats?.streak.currentStreak ?? 0;

  // 타 유저 heatmap은 서버가 최근 7일 고정 반환 — 이번 주(월~) 셀만 걸러 지난주 꼬리를 제거.
  const weekFrom = heatmapRange('WEEK').from;
  const theirWeekCells = (stats?.heatmap ?? []).filter((c) => c.date >= weekFrom);
  const focusByDay: CompareByDay = {
    mine: byWeekday(myHeatmap, (c) => c.totalFocusMinutes),
    theirs: byWeekday(theirWeekCells, (c) => c.totalFocusMinutes),
  };
  const phoneByDay: CompareByDay = {
    mine: byWeekday(myHeatmap, (c) => c.actualScreenTimeMinutes),
    theirs: byWeekday(theirWeekCells, (c) => c.actualScreenTimeMinutes),
  };
  // 상대 폰 사용이 이번 주 내내 0이면 미측정(스크린타임 미허용·구버전·미동기화)과 구분 불가 —
  // 0짜리 막대 비교는 무의미해 안내로 대체한다. 내 쪽 0은 그대로 차트(내 상태는 내가 안다).
  const theirPhoneMeasured = phoneByDay.theirs.some((m) => m > 0);

  // 과목별 비교 블록 — 겹치는 과목 실비교 / 미확보 시 블러 티저. 상세(친구) 분기와 PUBLIC
  // 분기가 공유한다. 겹침 없음([])은 카드 안 빈 상태로 안내(GROMO-692) — 배너로 카드를 통째로
  // 대체하면 다른 기간 탭으로 빠져나갈 수 없다.
  const subjectCompareBlock = subjectCompare ? (
    <View style={s.chartGap}>
      <SubjectCompareCard
        subjects={subjectCompare}
        opponentName={nickname}
        period={subjectPeriod}
        onPeriodChange={setSubjectPeriod}
      />
    </View>
  ) : (
    <View style={s.chartGap}>
      <ComingSoon note="같은 과목 공부량 비교를 준비하고 있어요">
        <SubjectCompareCard
          subjects={TEASER_SUBJECTS}
          opponentName={nickname}
          period={subjectPeriod}
          onPeriodChange={setSubjectPeriod}
        />
      </ComingSoon>
    </View>
  );

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── 헤더 (원형 백버튼 + 좌측 제목 + 우측 핀 토글 — 핀은 나만의 랭킹 고정용) ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={T.inkSub} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>프로필</Text>
        {/* 핀은 친구 아니어도 가능(GROMO-609) — 친구 여부와 무관하게 항상 노출(GROMO-845) */}
        <TouchableOpacity
          style={[s.pinBtn, isPinned && s.pinBtnOn]}
          onPress={togglePin}
          activeOpacity={0.7}
          hitSlop={6}
        >
          {/* 리그(RankRow·포디움·칩)와 동일한 압정 아이콘(MaterialCommunityIcons) — Ionicons 핀은 모양이 달라 혼동 */}
          <MaterialCommunityIcons
            name={isPinned ? 'pin' : 'pin-outline'}
            size={16}
            color={isPinned ? T.white : T.inkSub}
          />
        </TouchableOpacity>
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
        </View>

        {loading ? (
          <View style={s.loader}>
            <ActivityIndicator color={T.accent} />
          </View>
        ) : (
          <>
            {/* ── 요약: 현재 티어 + 오늘 집중 + 연속(현재) (티어·연속은 항상 공개) ── */}
            <View style={s.summaryRow}>
              <View style={s.ringCard}>
                {/* 현재 티어 — 뱃지 + 티어명 + 랭킹 등수 (항상 공개; 상단 티어 줄에서 이관) */}
                <TierBadge level={tier.level} size={56} />
                <Text style={s.ringLabel}>{tier.name}</Text>
                {rank != null && (
                  <Text style={s.ringRank} allowFontScaling={false}>
                    랭킹 {rank}위
                  </Text>
                )}
              </View>
              <View style={s.summaryCol}>
                <View style={s.summaryCard}>
                  <Text style={s.summaryLabel}>오늘 집중</Text>
                  <Text style={s.summaryValue} allowFontScaling={false}>
                    {summaryVisible ? fmtMinutes(todayFocusMinutes) : '비공개'}
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

            {/* ── 준비 시험 — 공개 프로필의 occupation(GROMO-747) 실값 표시, 미설정이면 카드 숨김 (GROMO-680) ── */}
            {examLabel != null && (
              <View style={s.examCard}>
                <View style={s.examIcon}>
                  <Ionicons name="calendar-outline" size={16} color={T.accentDeep} />
                </View>
                <View style={s.examCol}>
                  <Text style={s.examLabel}>준비 시험</Text>
                  <Text style={s.examValue}>{examLabel}</Text>
                </View>
              </View>
            )}

            {detailVisible ? (
              <>
                {/* 요일별 집중·폰 사용 비교 — 내 히트맵 vs 상대 히트맵(실데이터).
                    이번 주(월~일) 기준 — 아직 안 지난 요일은 0으로 표시. */}
                <View style={s.chartGap}>
                  <DuoDayChart
                    title="이번 주 요일별 집중시간"
                    data={focusByDay}
                    mineColor={T.accent}
                    theirsColor={THEIRS_FOCUS}
                    opponentName={nickname}
                  />
                </View>
                {theirPhoneMeasured ? (
                  <View style={s.chartGap}>
                    <DuoDayChart
                      title="이번 주 요일별 폰 사용시간"
                      data={phoneByDay}
                      mineColor={T.accentAlt}
                      theirsColor={THEIRS_PHONE}
                      opponentName={nickname}
                    />
                  </View>
                ) : (
                  <View style={[s.chartGap, s.noOverlapNote]}>
                    <Ionicons name="phone-portrait-outline" size={15} color={T.accent} />
                    <Text style={s.noOverlapText}>
                      {nickname}님의 폰 사용 기록이 아직 없어요. 측정이 쌓이면 여기서 비교돼요.
                    </Text>
                  </View>
                )}
                {subjectCompareBlock}
              </>
            ) : publicVisible ? (
              /* 강등 요약 — 상세(getUserStats) 실패, 폴백만 성공. 요약·과목별만 표시하고
                 요일 비교는 다음 진입에서 상세가 회복되면 자동으로 뜬다. */
              <>
                {subjectCompareBlock}
                <View style={[s.chartGap, s.noOverlapNote]}>
                  <Ionicons name="people-outline" size={15} color={T.accent} />
                  <Text style={s.noOverlapText}>
                    요일별 집중·폰 사용 비교를 지금 불러오지 못했어요.
                  </Text>
                </View>
              </>
            ) : (
              /* 세부 비교 잠금(친구 아님 + 친구공개 대상) — 요약은 위에서 항상 공개(GROMO-746), 차트만 잠금 */
              <View style={s.lockCard}>
                <View style={s.lockCircle}>
                  <Ionicons name="lock-closed" size={18} color={T.accent} />
                </View>
                <Text style={s.lockTitle}>친구만 볼 수 있어요</Text>
                <Text style={s.lockSub}>
                  친구가 되면 요일별 집중·폰 사용,{'\n'}과목별 비교를 볼 수 있어요.
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
  root: { flex: 1, backgroundColor: T.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.md,
    paddingHorizontal: T.space.xl,
    paddingTop: T.space.sm,
    paddingBottom: T.space.sm,
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
  scrollContent: { paddingHorizontal: T.space.xl, paddingBottom: T.space.lg },

  // 아바타·이름·티어
  heroCol: { alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm, marginTop: T.space.sm },
  name: { ...T.text.stat, color: T.ink, maxWidth: 200 },
  friendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.xs,
    backgroundColor: T.track,
    borderRadius: 999,
    paddingHorizontal: T.space.md,
    paddingVertical: 3,
  },
  friendPillText: { ...T.text.caption, fontSize: 11, fontWeight: '700', color: T.inkSub },

  loader: { paddingVertical: 48, alignItems: 'center' },

  // 요약(링 + 이번 주/연속)
  summaryRow: {
    flexDirection: 'row',
    gap: T.space.md,
    marginTop: T.space.xl,
    marginBottom: T.space.md,
  },
  ringCard: {
    width: 104,
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    padding: T.space.md,
  },
  ringLabel: { ...T.text.caption, fontSize: 11, color: T.inkSub },
  ringRank: {
    ...T.text.caption,
    fontSize: 13,
    fontWeight: '800',
    color: T.accentDeep,
    textAlign: 'center',
  },
  summaryCol: { flex: 1, gap: T.space.md },
  summaryCard: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.md,
  },
  summaryLabel: { ...T.text.caption, fontSize: 11, fontWeight: '500', color: T.inkMuted },
  summaryValue: {
    ...T.text.subtitle,
    fontWeight: '800',
    color: T.ink,
    marginTop: T.space.xs,
    fontVariant: ['tabular-nums'],
  },

  // 준비 시험
  examCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 14,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.md,
    marginBottom: T.space.lg,
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

  chartGap: { marginTop: T.space.md },

  // 겹치는 과목 없음 안내(시안 '겹침 없음' 분기)
  noOverlapNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: T.space.sm,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 13,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.md,
  },
  noOverlapText: { ...T.text.caption, flex: 1, fontWeight: '600', color: T.link, lineHeight: 19 },

  // 상세 통계 잠금(비공개)
  lockCard: {
    marginTop: T.space.md,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingHorizontal: T.space.xxl,
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
    marginBottom: T.space.md,
  },
  lockTitle: { ...T.text.label, fontWeight: '700', color: T.ink },
  lockSub: {
    ...T.text.caption,
    fontWeight: '500',
    color: T.inkSub,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: T.space.xs,
  },

  // 하단 CTA
  ctaWrap: { paddingHorizontal: T.space.xl, paddingTop: T.space.md },
  requestBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: T.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
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
    backgroundColor: T.track,
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
    gap: T.space.sm,
  },
  unfriendText: { ...T.text.label, fontWeight: '700', color: UNFRIEND_INK },
});
