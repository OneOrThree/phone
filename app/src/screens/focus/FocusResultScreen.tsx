import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import { STORAGE_KEYS } from '@/types/storage';
import { getFocusPeriodStats, getStreak, getHeatmap } from '@/services/statsApi';
import type {
  FocusPeriodStatsResponse,
  StreakResponse,
  HeatmapCellResponse,
} from '@/types/dto/stats';
import { localDateStr, todayStr } from '@/utils/localDate';
import type { V2RootStackParamList } from '@/navigation/types';
import { useSubjects } from '@/store/SubjectContext';
import { hm } from '@/screens/stats/format';
import { hms } from './format';
import { fetchFriendsAverage } from '@/services/compareAverages';
import { ComingSoon } from '@/screens/stats/ComingSoon';

// 집중 결과 화면 — Claude Design Gromo.dc.html 14번(첫 집중 완료) 레이아웃 기준.
// GROMO-598: 화면·진입·이번 집중(00:00:00)·과목별 누적(로컬 SubjectContext — 방금 세션 즉시 반영)·CTA. 코인 미표기.
// GROMO-603(집중 완료 통계): 스트릭 채우기(첫 완료 변형에만 — 월~일 출석 체크) + 이번 주 집중시간(요일 막대)
//   + 나 vs 3축(친구/전체/같은 카테고리) 주간 비교. 축별 독립 로딩 — 카드는 즉시 뜨고 도착한 축부터 채워진다.
//   전체·같은 카테고리는 오늘(일 단위) 집계 API가 없어 블러 티저 — 서버 일 평균 API 생기면 연결.

const WEEK_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
const BAR_H = 46;

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

  const today = todayStr();
  const days = thisWeekDates();
  // 방금 끝낸 세션은 업로드 직후라 서버 집계(week·heatmap)에 아직 없을 수 있다(리뷰 반영).
  // 오늘 값은 max(서버, 방금 세션 분)로 바닥을 깔고, 주간 합계에도 그 차이만큼 더해
  // 결과 화면이 0/이전 값으로 보이지 않게 한다(이중 집계 없음 — max라 서버 반영 후엔 그대로).
  const sessionMin = Math.round(focusSeconds / 60);
  const serverToday = cellByDate[today]?.totalFocusMinutes ?? 0;
  const adjustedToday = Math.max(serverToday, sessionMin);
  const weekTotal = (week?.totalFocusMinutes ?? 0) + (adjustedToday - serverToday);
  const dayMinutes = (d: string) =>
    d === today ? adjustedToday : (cellByDate[d]?.totalFocusMinutes ?? 0);
  const maxMin = Math.max(...days.map(dayMinutes), 1);
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
              <Text style={s.streakTitle}>이번 주 집중 스트릭 채우기 완료!</Text>
              {streak && streak.currentStreak > 0 ? (
                <Text style={s.streakBadge}>{streak.currentStreak}일 연속</Text>
              ) : null}
            </View>
            <View style={s.dotRow}>
              {days.map((date, i) => {
                const cell = cellByDate[date];
                const isToday = date === today;
                // 출석 = 그날 집중 기록 존재. 방금 끝낸 세션은 서버 집계에 아직 없을 수 있어 오늘은 즉시 채움.
                const done =
                  (cell != null && (cell.sessionCount > 0 || cell.totalFocusMinutes > 0)) ||
                  (isToday && focusSeconds > 0);
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

        {/* 이번 주 집중시간 — 총합 + 요일 막대(나) */}
        <View style={s.card}>
          <View style={s.rowBetween}>
            <Text style={s.cardTitle}>이번 주 집중시간</Text>
            <Text style={s.cardValue}>{hm(weekTotal)}</Text>
          </View>
          <View style={s.barRow}>
            {days.map((date, i) => {
              const min = dayMinutes(date);
              const isToday = date === today;
              const h = min > 0 ? Math.max((min / maxMin) * BAR_H, 4) : 0;
              return (
                <View key={date} style={s.barCol}>
                  <View style={s.barTrack}>
                    <View
                      style={[s.bar, { height: h, backgroundColor: isToday ? T.accent : T.sand }]}
                    />
                  </View>
                  <Text style={[s.barDay, isToday ? s.barDayToday : null]}>{WEEK_LABELS[i]}</Text>
                </View>
              );
            })}
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
              {ahead ? '▲' : '▼'} {hm(Math.abs(delta))}
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
              <Text style={s.cmpValueMine}>{hm(mine)}</Text>
            </View>
            <View style={s.cmpTrack}>
              <View style={[s.cmpFill, { width: w(mine), backgroundColor: T.accent }]} />
            </View>
          </View>
          <View style={s.cmpBlock}>
            <View style={s.rowBetween}>
              <Text style={s.cmpLabel}>{cur.label}</Text>
              <Text style={s.cmpValue}>{hm(avg)}</Text>
            </View>
            <View style={s.cmpTrack}>
              <View style={[s.cmpFill, s.cmpFillAvg, { width: w(avg) }]} />
            </View>
          </View>
          <Text style={s.cmpCaption}>
            {ahead
              ? `${cur.label}보다 ${hm(Math.abs(delta))} 더 집중했어요.`
              : `${cur.label}까지 ${hm(Math.abs(delta))} 남았어요. 오늘도 한 걸음!`}
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
                  <Text style={s.cmpValueMine}>1시간 30분</Text>
                </View>
                <View style={s.cmpTrack}>
                  <View style={[s.cmpFill, s.cmpTeaserMine]} />
                </View>
              </View>
              <View style={s.cmpBlock}>
                <View style={s.rowBetween}>
                  <Text style={s.cmpLabel}>{cur.label}</Text>
                  <Text style={s.cmpValue}>1시간 2분</Text>
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

  // 이번 주 집중시간 막대
  barRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, marginTop: 6 },
  barCol: { flex: 1, alignItems: 'center', gap: 5 },
  barTrack: { height: BAR_H, justifyContent: 'flex-end' },
  bar: { width: 14, borderTopLeftRadius: 5, borderTopRightRadius: 5 },
  barDay: { ...T.text.caption, fontSize: 10, color: T.inkMuted },
  barDayToday: { color: T.accent, fontWeight: '700' },

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
