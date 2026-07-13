import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, { cubicBezier } from 'react-native-reanimated';
import { T } from '@/constants/theme';
import { STORAGE_KEYS } from '@/types/storage';
import { getFocusPeriodStats, getStreak, getHeatmap, getTodayStats } from '@/services/statsApi';
import type {
  FocusPeriodStatsResponse,
  StreakResponse,
  HeatmapCellResponse,
} from '@/types/dto/stats';
import { localDateStr, todayStr } from '@/utils/localDate';
import type { V2RootStackParamList } from '@/navigation/types';
import { useSubjects } from '@/store/SubjectContext';
import { fmtMinutes, axisCeil, fmtAxis } from '@/utils/timeFormat';
import { hms } from './format';
import { fetchFriendsAverage } from '@/services/compareAverages';
import { ComingSoon } from '@/screens/stats/ComingSoon';
import { useFocus } from '@/store/FocusContext';
import { useUser } from '@/store/UserContext';

// 집중 결과 화면 — Claude Design Gromo.dc.html 14번(첫 집중 완료) 레이아웃 기준.
// GROMO-598: 화면·진입·이번 집중(00:00:00)·과목별 누적(로컬 SubjectContext — 방금 세션 즉시 반영)·CTA. 코인 미표기.
// GROMO-603(집중 완료 통계): 스트릭 채우기(첫 완료 변형에만 — 월~일 출석 체크) + 이번 주 집중시간(요일 막대)
//   + 나 vs 3축(친구/전체/같은 카테고리) 주간 비교. 축별 독립 로딩 — 카드는 즉시 뜨고 도착한 축부터 채워진다.
//   전체·같은 카테고리는 오늘(일 단위) 집계 API가 없어 블러 티저 — 서버 일 평균 API 생기면 연결.

const WEEK_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
// 차트 트랙 높이 — 세로축 ⅓ 간격 눈금·라벨이 겹치지 않을 만큼 확보(GROMO-683)
const BAR_H = 72;
// GROMO-682: 스트릭(출석 ✓) 인정 최소 기준 — 하루 누적 10분
const STREAK_MIN_DAILY_MINUTES = 10;
// 진입 시 막대가 바닥부터 자라는 키프레임(GROMO-683) — height 애니메이션은 매 프레임
// 레이아웃 패스를 유발하므로 scaleY 변환 사용(s.bar의 transformOrigin: 'bottom'과 조합).
const growUp = { from: { transform: [{ scaleY: 0 }] } };
// 막대별 진입 애니메이션 — 왼쪽부터 80ms 시차. fillMode backwards로 딜레이 동안
// scaleY 0(접힌 상태)을 유지해 먼저 그려지는 튐 방지. 이징은 목표를 살짝 넘었다가
// 자리 잡는 overshoot 곡선(easeOutBack) — 500ms ease-out은 너무 빨라 체감이 안 됐음.
const barEnterAnim = (index: number) =>
  ({
    animationName: growUp,
    animationDuration: '800ms',
    animationDelay: `${index * 80}ms`,
    animationTimingFunction: cubicBezier(0.34, 1.56, 0.64, 1),
    animationFillMode: 'backwards',
  }) as const;

// 이번 주 월~일 날짜('YYYY-MM-DD') 배열.
function thisWeekDates(): string[] {
  const now = new Date();
  const dow = now.getDay(); // 0=일..6=토
  const toMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + toMonday);
  return Array.from({ length: 7 }, (_, i) =>
    localDateStr(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)),
  );
}

export default function FocusResultScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<V2RootStackParamList>>();
  const { params } = useRoute<RouteProp<V2RootStackParamList, 'FocusResult'>>();
  const { focusSeconds, subjectName } = params;
  const { subjects } = useSubjects();
  // 목표 달성 판정용(GROMO-630) — 로컬 누적(오늘 전체)·로컬 목표. 서버 조회가 늦거나 실패해도 판정 가능.
  const { todayFocusSeconds } = useFocus();
  const { goalSeconds: userGoalSeconds } = useUser();

  const [firstTime, setFirstTime] = useState(false);
  const [week, setWeek] = useState<FocusPeriodStatsResponse | null>(null);
  const [streak, setStreak] = useState<StreakResponse | null>(null);
  const [cellByDate, setCellByDate] = useState<Record<string, HeatmapCellResponse>>({});
  // 오늘 비교 — 친구 축만 일 단위 실데이터(전체·카테고리는 리그가 주간 집계뿐이라 서버 집계 필요).
  // undefined = 로딩 중, avg null = 미확보(폴백 문구)
  const [friendDayAvg, setFriendDayAvg] = useState<
    { avg: number | null; count: number } | undefined
  >(undefined);

  // 첫 완료 판별 — 로컬 플래그. 없으면 이번이 첫 완료로 보고 플래그를 남긴다.
  useEffect(() => {
    (async () => {
      const done = await AsyncStorage.getItem(STORAGE_KEYS.focusFirstDone);
      setFirstTime(done == null);
      if (done == null) AsyncStorage.setItem(STORAGE_KEYS.focusFirstDone, '1').catch(() => {});
    })();
  }, []);

  // 집중 완료 통계(GROMO-603) — 핵심 지표(이번 주 합계·연속일·요일별)는 한 묶음으로 빠르게,
  // 비교 3축은 독립 로딩(느린 축이 빠른 축·핵심 지표를 막지 않게).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const days = thisWeekDates();
      const [w, st, cells] = await Promise.all([
        getFocusPeriodStats('WEEK').catch(() => null),
        getStreak().catch(() => null),
        getHeatmap(days[0], todayStr()).catch(() => [] as HeatmapCellResponse[]),
      ]);
      if (cancelled) return;
      setWeek(w);
      setStreak(st);
      const map: Record<string, HeatmapCellResponse> = {};
      for (const c of cells) map[c.date] = c;
      setCellByDate(map);
    })();
    fetchFriendsAverage('DAY').then((v) => !cancelled && setFriendDayAvg(v));
    return () => {
      cancelled = true;
    };
  }, []);

  // 목표 달성 판정(GROMO-630) — 결과 화면은 판정·예약만 하고, 모달은 결과 화면을 닫은 뒤
  // 홈 진입 시 뜬다(오스카 결정). 누적은 로컬(FocusContext — 방금 세션 포함)과 서버 중 큰 값,
  // 목표는 서버 우선·실패 시 로컬 — 방금 세션 업로드가 서버 집계에 늦어도(레이스) 놓치지 않는다.
  // '연속 목표달성'은 일별 달성 플래그(heatmap)를 어제부터 뒤로 세어 오늘을 더한다 —
  // '연속 공부'(하루 10분 스트릭)와 다른 값이므로 getStreak을 쓰지 않는다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const today = todayStr();
        if ((await AsyncStorage.getItem(STORAGE_KEYS.focusGoalCelebratedDate)) === today) return;
        const rawPending = await AsyncStorage.getItem(STORAGE_KEYS.focusGoalCelebratePending);
        if (rawPending) {
          try {
            // 오늘 예약이 이미 있으면 재판정 불필요(깨진 값은 아래에서 덮어씀)
            if ((JSON.parse(rawPending) as { date?: string }).date === today) return;
          } catch {
            /* noop */
          }
        }
        const stats = await getTodayStats().catch(() => null);
        const goalMin = stats ? stats.focus.goalMinutes : Math.round(userGoalSeconds / 60);
        const todayMin = Math.max(
          stats?.focus.todayMinutes ?? 0,
          Math.floor(todayFocusSeconds / 60),
        );
        const achieved =
          goalMin > 0 && ((stats?.focus.goalAchieved ?? false) || todayMin >= goalMin);
        if (!achieved) return;
        const from = new Date();
        from.setDate(from.getDate() - 60);
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const cells = await getHeatmap(localDateStr(from), localDateStr(yesterday)).catch(
          () => [] as HeatmapCellResponse[],
        );
        const achievedByDate = new Map(cells.map((c) => [c.date, c.focusGoalAchieved]));
        let days = 1; // 오늘(방금 달성)
        const d = new Date();
        d.setDate(d.getDate() - 1);
        while (achievedByDate.get(localDateStr(d))) {
          days += 1;
          d.setDate(d.getDate() - 1);
        }
        if (cancelled) return;
        await AsyncStorage.setItem(
          STORAGE_KEYS.focusGoalCelebratePending,
          JSON.stringify({ date: today, days }),
        );
      } catch {
        // 판정 실패 시 축하 생략 — 다음 결과 화면 진입에서 재판정된다
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [todayFocusSeconds, userGoalSeconds]);

  const today = todayStr();
  const days = thisWeekDates();
  // 방금 끝낸 세션은 업로드 직후라 서버 집계(week·heatmap)에 아직 없을 수 있다(리뷰 반영).
  // 오늘 값은 max(서버, 방금 세션 분)로 바닥을 깔고, 주간 합계에도 그 차이만큼 더해
  // 결과 화면이 0/이전 값으로 보이지 않게 한다(이중 집계 없음 — max라 서버 반영 후엔 그대로).
  const sessionMin = Math.round(focusSeconds / 60);
  const serverToday = cellByDate[today]?.totalFocusMinutes ?? 0;
  const adjustedToday = Math.max(serverToday, sessionMin);
  // 스트릭 판정용 오늘 충족 여부(GROMO-682) — 반올림(sessionMin)을 쓰면 9분 30초가 10분으로
  // 인정되므로 판정에는 방금 세션을 내림으로 계산(표시용 adjustedToday와 분리).
  const todayStreakDone =
    Math.max(serverToday, Math.floor(focusSeconds / 60)) >= STREAK_MIN_DAILY_MINUTES;
  const weekTotal = (week?.totalFocusMinutes ?? 0) + (adjustedToday - serverToday);
  const dayMinutes = (d: string) =>
    d === today ? adjustedToday : (cellByDate[d]?.totalFocusMinutes ?? 0);
  // 세로축 상한 — 최대치를 보기 좋은 눈금으로 올림(통계 차트와 동일 규칙, GROMO-683)
  const axisMax = axisCeil(Math.max(...days.map(dayMinutes), 1));
  // 이번 집중 시간 — 세션 타이머와 같은 디지털 표기(00:00:00).
  const focusLabel = hms(focusSeconds);
  // 과목별 누적(로컬) — 방금 세션까지 즉시 반영. 기록 있는 과목만, 많은 순.
  const subjectRows = [...subjects]
    .filter((x) => x.accumulatedSeconds > 0)
    .sort((a, b) => b.accumulatedSeconds - a.accumulatedSeconds);

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* 헤더 — 축하 문구 */}
        <View style={s.header}>
          <Text style={s.title}>{firstTime ? '첫 집중 완료!' : '집중 완료!'}</Text>
          <Text style={s.sub}>
            {firstTime ? '오늘 첫 걸음을 뗐어요 🎉' : `${subjectName} · 꾸준함이 쌓이고 있어요`}
          </Text>
        </View>

        {/* 이번 집중 — 과목명 큰 글씨 + 00:00:00, 바로 아래 과목별 누적 집중(로컬) */}
        <View style={s.card}>
          <Text style={s.miniLabel}>이번 집중</Text>
          {/* 과목명 + 시간 — 수평 배치(과목이 주인공, 시간은 오른쪽) */}
          <View style={s.focusRow}>
            <Text style={s.bigStat} numberOfLines={1}>
              {subjectName}
            </Text>
            <Text style={s.focusTime}>{focusLabel}</Text>
          </View>

          {subjectRows.length > 0 ? (
            <View style={s.catSection}>
              <Text style={s.catHeading}>과목별 집중 현황</Text>
              {/* 과목 + 시간만 쭉 (드로어 '과목별 집중 현황'과 동일 패턴) */}
              <View style={s.subjectList}>
                {subjectRows.map((x) => (
                  <View key={x.id} style={s.subjectRow}>
                    <View style={[s.subjectDot, { backgroundColor: x.color }]} />
                    <Text style={s.subjectName} numberOfLines={1}>
                      {x.name}
                    </Text>
                    <Text style={s.subjectTime}>{hms(x.accumulatedSeconds)}</Text>
                  </View>
                ))}
              </View>
              {/* 맨 아래 — 전체 대비 과목별 비율 바(flex 세그먼트 분할) */}
              <View style={s.ratioTrack}>
                {subjectRows.map((x) => (
                  <View
                    key={x.id}
                    style={{ flex: x.accumulatedSeconds, backgroundColor: x.color }}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>

        {/* 이번 주 스트릭 채우기 — 첫 집중 완료 변형(시안 14번)에만. 출석체크: 그날 집중했으면 ✓ */}
        {firstTime ? (
          <LinearGradient
            colors={[T.accentBg, T.sand]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.streakCard}
          >
            <View style={s.streakHead}>
              <View style={s.streakIcon}>
                <Ionicons name="flame" size={13} color={T.white} />
              </View>
              {/* 오늘 10분 미달이면 '완료'가 판정(빈 ✓·안내 문구)과 모순되므로 제목 분기 */}
              <Text style={s.streakTitle}>
                {todayStreakDone
                  ? '이번 주 집중 스트릭 채우기 완료!'
                  : '이번 주 집중 스트릭을 채워봐요!'}
              </Text>
              {streak && streak.currentStreak > 0 ? (
                <Text style={s.streakBadge}>{streak.currentStreak}일 연속</Text>
              ) : null}
            </View>
            <View style={s.dotRow}>
              {days.map((date, i) => {
                const cell = cellByDate[date];
                const isToday = date === today;
                // 출석 = 하루 누적 10분 이상(GROMO-682). 오늘은 방금 세션이 서버 집계에
                // 아직 없을 수 있어 보정한 판정값(todayStreakDone)을 쓴다.
                const done = isToday
                  ? todayStreakDone
                  : cell != null && cell.totalFocusMinutes >= STREAK_MIN_DAILY_MINUTES;
                const future = date > today;
                return (
                  <View key={date} style={s.dotCol}>
                    <View style={[s.dot, done ? s.dotOn : null, future ? s.dotFuture : null]}>
                      {done ? <Ionicons name="checkmark" size={15} color={T.white} /> : null}
                    </View>
                    <Text style={[s.dotDay, isToday ? s.dotDayToday : null]}>{WEEK_LABELS[i]}</Text>
                  </View>
                );
              })}
            </View>
          </LinearGradient>
        ) : null}

        {/* 스트릭 기준 안내(GROMO-682) — 오늘 누적이 10분 미만이면 채워지는 조건을 알려준다 */}
        {!todayStreakDone ? (
          <View style={s.streakNotice}>
            <Ionicons name="flame-outline" size={14} color={T.accentDeep} />
            <Text style={s.streakNoticeText}>하루 10분 이상 집중하면 연속 기록이 채워져요</Text>
          </View>
        ) : null}

        {/* 이번 주 집중시간 — 총합 + 요일 막대(나). 세로축·눈금은 통계 차트 패턴 재사용(GROMO-683) */}
        <View style={s.card}>
          <View style={s.rowBetween}>
            <Text style={s.cardTitle}>이번 주 집중시간</Text>
            <Text style={s.cardValue}>{fmtMinutes(weekTotal)}</Text>
          </View>
          <View style={s.chartPlotRow}>
            {/* 세로축 — 상한·⅔·⅓ 눈금 3줄 (StatsScreen 차트와 동일 패턴) */}
            <View style={s.chartAxisCol}>
              <Text style={[s.chartAxisLabel, s.chartAxisTop]} allowFontScaling={false}>
                {fmtAxis(axisMax)}
              </Text>
              <Text style={[s.chartAxisLabel, s.chartAxisUpper]} allowFontScaling={false}>
                {fmtAxis((axisMax * 2) / 3)}
              </Text>
              <Text style={[s.chartAxisLabel, s.chartAxisLower]} allowFontScaling={false}>
                {fmtAxis(axisMax / 3)}
              </Text>
            </View>
            <View style={s.chartPlot}>
              <View style={[s.chartGridLine, s.chartGridTop]} />
              <View style={[s.chartGridLine, s.chartGridUpper]} />
              <View style={[s.chartGridLine, s.chartGridLower]} />
              <View style={[s.chartGridLine, s.chartGridBottom]} />
              <View style={s.barRow}>
                {days.map((date, i) => {
                  const min = dayMinutes(date);
                  const isToday = date === today;
                  const h = min > 0 ? Math.max((min / axisMax) * BAR_H, 4) : 0;
                  return (
                    <View key={date} style={s.barCol}>
                      <View style={s.barTrack}>
                        <Animated.View
                          style={[
                            s.bar,
                            { height: h, backgroundColor: isToday ? T.accent : T.sand },
                            barEnterAnim(i),
                          ]}
                        />
                      </View>
                      <Text style={[s.barDay, isToday ? s.barDayToday : null]}>
                        {WEEK_LABELS[i]}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        </View>

        {/* 나 vs 3축 비교(오늘) — 카드는 즉시 뜨고 친구 평균 도착 시 채워진다 */}
        <CompareCard mine={adjustedToday} friends={friendDayAvg} />
      </ScrollView>

      {/* 하단 CTA — 홈으로 / 다시 집중 */}
      <View style={s.footer}>
        <TouchableOpacity
          style={s.homeBtn}
          activeOpacity={0.85}
          onPress={() => navigation.popToTop()}
        >
          <Text style={s.homeText}>홈으로</Text>
        </TouchableOpacity>
        {/* 스택: Main → FocusCategory → FocusResult(세션을 replace) — 새 화면을 쌓지 않고
            아래 깔린 기존 과목 선택으로 goBack(중복 스택 방지, 리뷰 반영) */}
        <TouchableOpacity
          style={s.againBtn}
          activeOpacity={0.85}
          onPress={() => navigation.goBack()}
        >
          <Text style={s.againText}>다시 집중</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// 나 vs 비교축 카드(오늘) — 3축(친구/전체/같은 카테고리) 셀렉터 + 수평 바 2개. 미달도 격려체.
// 친구만 오늘 실데이터(/stats/focus?period=DAY&friends=). 전체·같은 카테고리는 리그가 주간 집계뿐이라
// 일 단위 서버 집계가 생기면 연결 — 그때까지 "준비 중" 안내.
type CompareAxis = 'friends' | 'all' | 'category';

function CompareCard({
  mine,
  friends,
}: {
  mine: number;
  friends: { avg: number | null; count: number } | undefined;
}) {
  const [axis, setAxis] = useState<CompareAxis>('friends');
  const meta: Record<
    CompareAxis,
    { chip: string; label: string; avg: number | null; loading: boolean; empty: string }
  > = {
    friends: {
      chip: '친구',
      label: '친구 평균',
      avg: friends?.avg ?? null,
      loading: friends === undefined,
      empty:
        friends?.count === 0
          ? '아직 친구가 없어요. 친구를 추가하고 비교해봐요!'
          : '친구 평균을 불러오지 못했어요',
    },
    all: {
      chip: '전체',
      label: '전체 평균',
      avg: null,
      loading: false,
      empty: '오늘 기준 전체 평균은 준비 중이에요',
    },
    category: {
      chip: '같은 카테고리',
      label: '같은 카테고리 평균',
      avg: null,
      loading: false,
      empty: '오늘 기준 같은 카테고리 평균은 준비 중이에요',
    },
  };
  const cur = meta[axis];
  const avg = cur.avg;
  const delta = avg != null ? mine - avg : 0;
  const ahead = delta >= 0;
  const max = Math.max(mine, avg ?? 0, 1);
  const w = (v: number) => `${Math.max((v / max) * 100, 2)}%` as const;
  return (
    <View style={s.card}>
      <View style={s.rowBetween}>
        <Text style={s.cardTitle}>오늘 비교</Text>
        {avg != null ? (
          <View style={[s.deltaBadge, ahead ? s.deltaBadgeUp : s.deltaBadgeDown]}>
            <Text style={[s.deltaBadgeText, { color: ahead ? T.successInk : T.dangerInk }]}>
              {ahead ? '▲' : '▼'} {fmtMinutes(Math.abs(delta))}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={s.axisRow}>
        {(['friends', 'all', 'category'] as CompareAxis[]).map((a) => {
          const on = axis === a;
          return (
            <TouchableOpacity
              key={a}
              style={[s.axisChip, on ? s.axisChipOn : null]}
              onPress={() => setAxis(a)}
              activeOpacity={0.8}
            >
              <Text style={[s.axisChipText, on ? s.axisChipTextOn : null]}>{meta[a].chip}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {avg != null ? (
        <>
          <View style={s.cmpBlock}>
            <View style={s.rowBetween}>
              <Text style={s.cmpLabelMine}>나</Text>
              <Text style={s.cmpValueMine}>{fmtMinutes(mine)}</Text>
            </View>
            <View style={s.cmpTrack}>
              <View style={[s.cmpFill, { width: w(mine), backgroundColor: T.accent }]} />
            </View>
          </View>
          <View style={s.cmpBlock}>
            <View style={s.rowBetween}>
              <Text style={s.cmpLabel}>{cur.label}</Text>
              <Text style={s.cmpValue}>{fmtMinutes(avg)}</Text>
            </View>
            <View style={s.cmpTrack}>
              <View style={[s.cmpFill, s.cmpFillAvg, { width: w(avg) }]} />
            </View>
          </View>
          <Text style={s.cmpCaption}>
            {ahead
              ? `${cur.label}보다 ${fmtMinutes(Math.abs(delta))} 더 집중했어요.`
              : `${cur.label}까지 ${fmtMinutes(Math.abs(delta))} 남았어요. 오늘도 한 걸음!`}
          </Text>
        </>
      ) : cur.loading || axis === 'friends' ? (
        // 로딩·친구 없음(액션 유도)은 텍스트 안내
        <Text style={s.cmpCaption}>{cur.loading ? '불러오는 중…' : cur.empty}</Text>
      ) : (
        // 준비 중(전체·같은 카테고리) — 실그래프 + 블러 티저
        <View style={s.cmpTeaserGap}>
          <ComingSoon note={cur.empty}>
            <View>
              <View style={s.cmpBlock}>
                <View style={s.rowBetween}>
                  <Text style={s.cmpLabelMine}>나</Text>
                  <Text style={s.cmpValueMine}>01:30:00</Text>
                </View>
                <View style={s.cmpTrack}>
                  <View style={[s.cmpFill, s.cmpTeaserMine]} />
                </View>
              </View>
              <View style={s.cmpBlock}>
                <View style={s.rowBetween}>
                  <Text style={s.cmpLabel}>{cur.label}</Text>
                  <Text style={s.cmpValue}>01:02:00</Text>
                </View>
                <View style={s.cmpTrack}>
                  <View style={[s.cmpFill, s.cmpTeaserAvg]} />
                </View>
              </View>
            </View>
          </ComingSoon>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },
  scroll: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24, gap: 12 },

  header: { gap: 4, paddingVertical: 4 },
  title: { ...T.text.stat, color: T.ink },
  sub: { ...T.text.label, fontWeight: '500', color: T.inkSub },

  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 18,
    paddingHorizontal: 17,
    paddingVertical: 16,
    gap: 6,
  },
  miniLabel: { ...T.text.caption, fontSize: 11, fontWeight: '500', color: T.inkMuted },
  miniSub: { ...T.text.caption, color: T.inkMuted },
  focusRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  bigStat: { ...T.text.display, color: T.ink, flexShrink: 1 },
  focusTime: { ...T.text.stat, color: T.accent, fontVariant: ['tabular-nums'] },

  // 과목별 집중 현황 (이번 집중 카드 하단 — 드로어와 동일 패턴: 행 목록 + 비율 바)
  catSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: T.divider,
  },
  catHeading: { ...T.text.caption, fontWeight: '700', color: T.inkSub, marginBottom: 10 },
  subjectList: { gap: 10 },
  subjectRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  subjectDot: { width: 8, height: 8, borderRadius: 4 },
  subjectName: { flex: 1, ...T.text.caption, color: T.ink },
  subjectTime: {
    ...T.text.caption,
    fontWeight: '700',
    color: T.inkSub,
    fontVariant: ['tabular-nums'],
  },
  ratioTrack: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    backgroundColor: T.caramel,
    overflow: 'hidden',
    marginTop: 13,
  },

  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  cardTitle: { ...T.text.label, fontWeight: '700', color: T.ink },
  cardValue: { ...T.text.subtitle, color: T.accent },

  // 스트릭 채우기 카드
  streakCard: {
    borderRadius: 20,
    paddingHorizontal: 17,
    paddingVertical: 16,
    gap: 14,
  },
  streakHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  streakIcon: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakTitle: { ...T.text.label, fontWeight: '800', color: T.ink, flex: 1 },
  streakBadge: { ...T.text.caption, color: T.accentDeep },
  dotRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dotCol: { alignItems: 'center', gap: 5 },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotOn: { backgroundColor: T.greenDeep, borderColor: T.greenDeep },
  dotFuture: { opacity: 0.4 },
  dotDay: { ...T.text.caption, fontSize: 10, color: T.inkMuted },
  dotDayToday: { color: T.accentDeep, fontWeight: '800' },

  // 스트릭 기준 안내(GROMO-682)
  streakNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: T.accentBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  streakNoticeText: { ...T.text.caption, fontWeight: '500', color: T.accentDeep, flex: 1 },

  // 이번 주 집중시간 막대
  barRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  barCol: { flex: 1, alignItems: 'center', gap: 5 },
  barTrack: { height: BAR_H, justifyContent: 'flex-end' },
  bar: { width: 14, borderTopLeftRadius: 5, borderTopRightRadius: 5, transformOrigin: 'bottom' },
  barDay: { ...T.text.caption, fontSize: 10, color: T.inkMuted },
  barDayToday: { color: T.accent, fontWeight: '700' },
  // 세로축·눈금(GROMO-683) — StatsScreen 차트 축 패턴과 동일 구조
  chartPlotRow: { flexDirection: 'row', marginTop: 6 },
  chartAxisCol: { width: 36, height: BAR_H },
  chartAxisLabel: {
    ...T.text.caption,
    position: 'absolute',
    right: 6,
    fontSize: 9,
    color: T.inkMuted,
  },
  chartAxisTop: { top: -5 },
  chartAxisUpper: { top: BAR_H / 3 - 5 },
  chartAxisLower: { top: (BAR_H * 2) / 3 - 5 },
  chartPlot: { flex: 1 },
  chartGridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: T.paperAlt,
  },
  chartGridTop: { top: 0 },
  chartGridUpper: { top: BAR_H / 3 },
  chartGridLower: { top: (BAR_H * 2) / 3 },
  chartGridBottom: { top: BAR_H },

  // 나 vs 비교축(3축 셀렉터)
  axisRow: { flexDirection: 'row', gap: 7, marginTop: 4 },
  axisChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: T.chipBg,
    borderWidth: 1,
    borderColor: T.chipBorder,
  },
  axisChipOn: { backgroundColor: T.accent, borderColor: T.accent },
  axisChipText: { ...T.text.caption, fontSize: 11, color: T.inkSub },
  axisChipTextOn: { color: T.white, fontWeight: '700' },
  deltaBadge: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 },
  deltaBadgeUp: { backgroundColor: T.successBg },
  deltaBadgeDown: { backgroundColor: T.dangerBg },
  deltaBadgeText: { ...T.text.caption, fontSize: 11, fontWeight: '700' },
  cmpBlock: { gap: 5, marginTop: 8 },
  cmpLabelMine: { ...T.text.caption, fontWeight: '700', color: T.ink },
  cmpValueMine: { ...T.text.caption, fontWeight: '800', color: T.accent },
  cmpLabel: { ...T.text.caption, color: T.inkSub },
  cmpValue: { ...T.text.caption, fontWeight: '700', color: T.inkSub },
  cmpTrack: { height: 10, borderRadius: 5, backgroundColor: T.track, overflow: 'hidden' },
  cmpFill: { height: 10, borderRadius: 5 },
  cmpFillAvg: { backgroundColor: T.compare.avg },
  cmpCaption: { ...T.text.caption, fontWeight: '500', color: T.link, marginTop: 10 },
  // 준비 중 티저(가짜 비교 바) — 블러 아래 깔리는 표시용 고정값
  cmpTeaserGap: { marginTop: 8 },
  cmpTeaserMine: { width: '82%', backgroundColor: T.accent },
  cmpTeaserAvg: { width: '58%', backgroundColor: T.compare.avg },

  // 하단 CTA
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
  },
  homeBtn: {
    flex: 1,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  homeText: { ...T.text.subtitle, color: T.inkSub },
  againBtn: {
    flex: 1.4,
    backgroundColor: T.accent,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  againText: { ...T.text.subtitle, color: T.white },
});
