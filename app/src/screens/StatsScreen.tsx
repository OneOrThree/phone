import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { StatsPeriod, HeatmapCellResponse } from '@/types/dto/stats';
import { logStatsViewed, logStatsPeriodChanged } from '@/services/analyticsEvents';
import {
  fetchGlobalAverage,
  fetchCategoryAverage,
  fetchFriendsAverage,
} from '@/services/compareAverages';
import { useStatsData } from './stats/useStatsData';
import { ComingSoon } from './stats/ComingSoon';
import { fetchTodayFocusSessions } from '@/screens/focus/focusRestore';
import { getFocusTags } from '@/services/focusApi';
import { getHeatmap } from '@/services/statsApi';
import { useSubjects } from '@/store/SubjectContext';
import { localDateStr, todayStr } from '@/utils/localDate';
import { fmtMinutes, axisCeil, fmtAxis } from '@/utils/timeFormat';
import {
  PERIOD_TABS,
  periodLabel,
  prevLabel,
  periodKey,
  heatmapBars,
  tenMinuteFocusSlots,
  focusGoalRate,
  grassLevel,
  type FocusSlotSegment,
  type StatBar,
} from './stats/format';

// v2 내 통계 화면(GROMO-604) — 홈 '오늘' 카드의 '자세히'에서 진입.
// 상단 고정 필터(기간 일/주/월) 아래로 ST1~ST9 지표 스크롤. 과목 칩 필터는 제거(GROMO-761 — 과목별 섹션과 중복).
// 실데이터: 집중시간·폰사용·전대비·목표달성·잔디·총공부량(나)·과목별(나).
// 준비 중: 비교(친구/전체/같은 카테고리)·합격자·주별 누적 — 소스 미비로 스텁.

const CHART_H = 120;
// 잔디 강도 0..4 색(빈 칸 → 진한 초록).
const GRASS = T.grass;
const FOCUS_COLOR = T.greenDeep;
const PHONE_COLOR = T.accent;

export default function StatsScreen() {
  const navigation = useNavigation();
  const [period, setPeriod] = useState<StatsPeriod>('WEEK');
  const { data, loading } = useStatsData(period);

  // 화면 진입(포커스마다 1회) 로깅.
  useFocusEffect(
    useCallback(() => {
      logStatsViewed();
    }, []),
  );

  const onPeriod = (p: StatsPeriod) => {
    if (p === period) return;
    setPeriod(p);
    logStatsPeriodChanged({ period: periodKey(p) });
  };

  const firstLoad = loading && data.focus === null && data.heatmap.length === 0;

  // 차트 제목의 단위 라벨 — 막대 구성과 일치(일=오늘 단일, 주=요일별, 월=주차별 합산; heatmapBars 참고)
  const granularity = period === 'DAY' ? '오늘' : period === 'WEEK' ? '요일별' : '주차별';

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── 헤더 ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={T.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>통계</Text>
        <View style={s.backBtn} />
      </View>

      {/* ── 고정 필터: 기간(일/주/월) — 과목 칩 필터는 제거(과목별 섹션이 전체를 보여줘 중복) ── */}
      <View style={s.filters}>
        <View style={s.segment}>
          {PERIOD_TABS.map((t) => {
            const on = period === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[s.segBtn, on ? s.segBtnOn : null]}
                onPress={() => onPeriod(t.key)}
                activeOpacity={0.8}
              >
                <Text style={[s.segText, on ? s.segTextOn : null]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {firstLoad ? (
        <View style={s.loader}>
          <ActivityIndicator color={T.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {/* ST1 총 공부량 (나) + 비교 — 주간은 리그 랭킹·친구 통계 기반 실비교(GROMO-761), 일/월은 준비중 */}
          <SectionCard title="총 공부량" caption={periodLabel(period)}>
            <Text style={s.bigStat}>{fmtMinutes(data.focus?.totalFocusMinutes ?? 0)}</Text>
            {period === 'WEEK' ? (
              <CompareWeek myMinutes={data.focus?.totalFocusMinutes ?? 0} />
            ) : (
              <CompareStub />
            )}
          </SectionCard>

          {/* 타임테이블(일) — 오늘 세션 실데이터, 총 공부량 바로 아래(GROMO-761) */}
          {period === 'DAY' && (
            <SectionCard title="타임테이블" caption="오늘">
              <FocusTimetable />
            </SectionCard>
          )}

          {/* ST2 과목별 공부량 (나) */}
          <SectionCard title="과목별 공부량" caption={periodLabel(period)}>
            <CategoryBars
              items={data.category?.items ?? []}
              total={data.category?.totalFocusMinutes ?? 0}
            />
          </SectionCard>

          {/* ST3 합격자 비교 — 실그래프 + 블러 티저(합격자 데이터 준비 중). 주 탭은 핸드폰 사용량 아래로 이동 */}
          {period !== 'WEEK' && (
            <SectionCard title="합격자와 비교" caption="과목별">
              <ComingSoon note="합격자 데이터가 쌓이면 보여드릴게요">
                <PasserCompareChart />
              </ComingSoon>
            </SectionCard>
          )}

          {/* ST4 — 주 탭은 이번 달 주별 공부시간(heatmap 주차 합산 실데이터), 월 탭은 누적 티저 유지.
              일 탭은 타임테이블이 총 공부량 아래로 대체 */}
          {period === 'WEEK' && (
            <SectionCard title={`${new Date().getMonth() + 1}월 주별 공부시간`}>
              <MonthWeeklyFocus />
            </SectionCard>
          )}
          {period === 'MONTH' && (
            <SectionCard title="주별 누적 공부 비율">
              <ComingSoon note="주별 누적 비율을 준비하고 있어요">
                <WeeklyCumulativeChart />
              </ComingSoon>
            </SectionCard>
          )}

          {/* ST5 집중시간 차트 — 일 탭은 숨김(타임테이블이 대체), 주=요일별·월=주차별 */}
          {period !== 'DAY' && (
            <SectionCard title={`${granularity} 집중시간`} caption={periodLabel(period)}>
              <Text style={[s.bigStat, { color: FOCUS_COLOR }]}>
                {fmtMinutes(data.focus?.totalFocusMinutes ?? 0)}
              </Text>
              {period === 'WEEK' ? (
                <LineChart
                  bars={heatmapBars(period, data.heatmap, (c) => c.totalFocusMinutes)}
                  color={FOCUS_COLOR}
                />
              ) : (
                <BarChart
                  bars={heatmapBars(period, data.heatmap, (c) => c.totalFocusMinutes)}
                  color={FOCUS_COLOR}
                />
              )}
            </SectionCard>
          )}

          {/* ST6 핸드폰 사용량 차트 — 제목은 기간 단위 따라(오늘/요일별/주차별) */}
          <SectionCard title={`${granularity} 핸드폰 사용량`} caption={periodLabel(period)}>
            <Text style={[s.bigStat, { color: PHONE_COLOR }]}>
              {fmtMinutes(data.screenTime?.currentMinutes ?? 0)}
            </Text>
            {period === 'WEEK' ? (
              <LineChart
                bars={heatmapBars(period, data.heatmap, (c) => c.actualScreenTimeMinutes)}
                color={PHONE_COLOR}
              />
            ) : (
              <BarChart
                bars={heatmapBars(period, data.heatmap, (c) => c.actualScreenTimeMinutes)}
                color={PHONE_COLOR}
              />
            )}
          </SectionCard>

          {/* 합격자 비교(주) — 요일별 핸드폰 사용량 아래 배치 */}
          {period === 'WEEK' && (
            <SectionCard title="합격자와 비교" caption="과목별">
              <ComingSoon note="합격자 데이터가 쌓이면 보여드릴게요">
                <PasserCompareChart />
              </ComingSoon>
            </SectionCard>
          )}

          {/* ST7 전(前) 대비 */}
          <SectionCard title={`${prevLabel(period)} 대비`}>
            <DeltaRow
              label="집중"
              delta={data.focus?.deltaMinutes ?? 0}
              base={data.focus?.previousTotalFocusMinutes ?? 0}
              lowerIsBetter={false}
            />
            <DeltaRow
              label="폰 사용"
              delta={data.screenTime?.deltaMinutes ?? 0}
              base={data.screenTime?.previousMinutes ?? 0}
              lowerIsBetter
            />
          </SectionCard>

          {/* ST8 목표 달성 */}
          <SectionCard title="목표 달성" caption={periodLabel(period)}>
            <GoalBlock period={period} data={data} />
          </SectionCard>

          {/* ST9 공부 잔디 (Streak) — 일 탭에선 숨김(하루 데이터로는 잔디가 무의미) */}
          {period !== 'DAY' && (
            <SectionCard title="공부 잔디">
              <View style={s.streakRow}>
                <View style={s.streakItem}>
                  <Text style={s.streakValue}>{data.streak?.currentStreak ?? 0}일</Text>
                  <Text style={s.streakLabel}>연속</Text>
                </View>
                <View style={s.streakDivider} />
                <View style={s.streakItem}>
                  <Text style={s.streakValue}>{data.streak?.longestStreak ?? 0}일</Text>
                  <Text style={s.streakLabel}>최장</Text>
                </View>
              </View>
              <GrassGrid cells={data.heatmap} />
              <Text style={s.grassHint}>공부시간이 많을수록 칸이 진해져요</Text>
            </SectionCard>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── 서브 컴포넌트 ──

function SectionCard({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardTitle}>{title}</Text>
        {caption ? <Text style={s.cardCaption}>{caption}</Text> : null}
      </View>
      {children}
    </View>
  );
}

// ST1 비교(주간 실데이터) — 전체/같은 카테고리는 리그 랭킹(주간 아레나 집계) 평균, 친구는 친구별
// 주간 집중 합계 평균(compareAverages 공용 헬퍼). 리그가 주간 집계라 '주' 탭에서만 유효 —
// 일/월은 서버 평균 집계 API(be-요청사항 5번) 전까지 CompareStub(준비중) 유지 (GROMO-761).
function CompareWeek({ myMinutes }: { myMinutes: number }) {
  const [axis, setAxis] = useState<'FRIENDS' | 'ALL' | 'CATEGORY'>('ALL');
  const [loaded, setLoaded] = useState(false);
  const [avgs, setAvgs] = useState<{
    global: number | null;
    category: { avg: number | null; label: string | null };
    friends: { avg: number | null; count: number };
  }>({ global: null, category: { avg: null, label: null }, friends: { avg: null, count: 0 } });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [global, category, friends] = await Promise.all([
        fetchGlobalAverage(),
        fetchCategoryAverage(),
        fetchFriendsAverage('WEEK'),
      ]);
      if (cancelled) return;
      setAvgs({ global, category, friends });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const AXES = [
    { key: 'FRIENDS', label: '친구' },
    { key: 'ALL', label: '전체' },
    { key: 'CATEGORY', label: '같은 카테고리' },
  ] as const;
  const avg =
    axis === 'ALL' ? avgs.global : axis === 'FRIENDS' ? avgs.friends.avg : avgs.category.avg;
  const avgLabel =
    axis === 'ALL'
      ? '전체 평균'
      : axis === 'FRIENDS'
        ? '친구 평균'
        : `${avgs.category.label ?? '같은 카테고리'} 평균`;
  // 축별 빈 상태 안내 — 친구 없음/준비 시험 미설정은 원인을 알려주고, 그 외엔 조회 실패로 안내.
  const emptyNote =
    axis === 'FRIENDS' && avgs.friends.count === 0
      ? '아직 친구가 없어요'
      : axis === 'CATEGORY' && !avgs.category.label
        ? '준비 시험을 설정하면 비교할 수 있어요'
        : '비교 데이터를 불러오지 못했어요';
  const denom = Math.max(myMinutes, avg ?? 0, 1);

  return (
    <View style={s.compare}>
      <View style={s.compareChips}>
        {AXES.map((a) => (
          <TouchableOpacity
            key={a.key}
            style={[s.compareChip, axis === a.key ? s.compareChipOn : null]}
            onPress={() => setAxis(a.key)}
            activeOpacity={0.8}
          >
            <Text style={[s.compareChipText, axis === a.key ? s.compareChipTextOn : null]}>
              {a.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {!loaded ? (
        <View style={s.compareLoading}>
          <ActivityIndicator color={T.accent} size="small" />
        </View>
      ) : avg == null ? (
        <Text style={s.emptyText}>{emptyNote}</Text>
      ) : (
        <View style={s.teaserPad}>
          <View style={s.teaserRowHead}>
            <Text style={s.teaserLabelMine}>나</Text>
            <Text style={s.teaserValueMine}>{fmtMinutes(myMinutes)}</Text>
          </View>
          <View style={s.teaserTrack}>
            <View
              style={[s.teaserFill, s.teaserFillMine, { width: `${(myMinutes / denom) * 100}%` }]}
            />
          </View>
          <View style={[s.teaserRowHead, s.teaserRowGap]}>
            <Text style={s.teaserLabel}>{avgLabel}</Text>
            <Text style={s.teaserValue}>{fmtMinutes(avg)}</Text>
          </View>
          <View style={s.teaserTrack}>
            <View style={[s.teaserFill, s.teaserFillAvg, { width: `${(avg / denom) * 100}%` }]} />
          </View>
        </View>
      )}
    </View>
  );
}

// ST1 비교 자리(일/월) — 실그래프(나 vs 평균 수평 바) + 블러 티저. 서버 평균 API가 붙으면 걷어낸다.
function CompareStub() {
  return (
    <View style={s.compare}>
      <View style={s.compareChips}>
        {['친구', '전체', '같은 카테고리'].map((c, i) => (
          <View key={c} style={[s.compareChip, i === 1 ? s.compareChipOn : null]}>
            <Text style={[s.compareChipText, i === 1 ? s.compareChipTextOn : null]}>{c}</Text>
          </View>
        ))}
      </View>
      <ComingSoon note="비교 데이터를 준비하고 있어요">
        <View style={s.teaserPad}>
          <View style={s.teaserRowHead}>
            <Text style={s.teaserLabelMine}>나</Text>
            <Text style={s.teaserValueMine}>22시간</Text>
          </View>
          <View style={s.teaserTrack}>
            <View style={[s.teaserFill, s.teaserFillMine]} />
          </View>
          <View style={[s.teaserRowHead, s.teaserRowGap]}>
            <Text style={s.teaserLabel}>전체 평균</Text>
            <Text style={s.teaserValue}>16시간</Text>
          </View>
          <View style={s.teaserTrack}>
            <View style={[s.teaserFill, s.teaserFillAvg]} />
          </View>
        </View>
      </ComingSoon>
    </View>
  );
}

// ST3 티저 — 과목별 나 vs 합격자 이중 수평 바(시안 레이아웃). 데이터는 표시용 고정값.
const PASSER_ROWS = [
  { name: '노동법', mine: 78, passer: 92 },
  { name: '행정쟁송법', mine: 55, passer: 70 },
  { name: '사회보험법', mine: 40, passer: 62 },
];

function PasserCompareChart() {
  return (
    <View style={s.teaserPad}>
      {PASSER_ROWS.map((r, i) => (
        <View key={r.name} style={i > 0 ? s.teaserRowGap : null}>
          <View style={s.teaserRowHead}>
            <Text style={s.teaserLabel}>{r.name}</Text>
          </View>
          <View style={s.teaserTrack}>
            <View style={[s.teaserFill, { width: `${r.mine}%`, backgroundColor: T.accent }]} />
          </View>
          <View style={[s.teaserTrack, s.teaserTrackGap]}>
            <View style={[s.teaserFill, s.teaserFillPasser, { width: `${r.passer}%` }]} />
          </View>
        </View>
      ))}
      <View style={s.teaserLegend}>
        <View style={s.teaserLegendItem}>
          <View style={[s.teaserDot, { backgroundColor: T.accent }]} />
          <Text style={s.teaserLegendText}>나</Text>
        </View>
        <View style={s.teaserLegendItem}>
          <View style={[s.teaserDot, s.teaserDotPasser]} />
          <Text style={s.teaserLegendText}>합격자 평균</Text>
        </View>
      </View>
    </View>
  );
}

// ST4(주) 해당월 주별 공부시간 — 이달 1일이 낀 주(월~일)의 월요일부터 오늘까지 heatmap을
// 달력 주 단위로 합산, 가로축은 실제 날짜 구간(예: 6/29~7/5)으로 표기. 전용 집계 API 없이
// 파생 계산(GROMO-761). 이번 주 막대는 강조(current).
function MonthWeeklyFocus() {
  const [bars, setBars] = useState<StatBar[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const now = new Date();
      const monthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
      // 이달 1일이 속한 주의 월요일 — 첫 주가 전월에 걸치면 전월 날짜부터 시작(예: 7월 첫 주 = 6/29~7/5)
      const dow = monthFirst.getDay(); // 0=일..6=토
      const weekStart0 = new Date(monthFirst);
      weekStart0.setDate(monthFirst.getDate() - (dow === 0 ? 6 : dow - 1));
      const cells = await getHeatmap(localDateStr(weekStart0), todayStr()).catch(
        () => [] as HeatmapCellResponse[],
      );
      if (cancelled) return;
      const startMs = weekStart0.getTime();
      // 해당 월의 모든 주를 미리 기재 — 말일이 낀 주까지 포함(아직 안 온 주는 0으로 빈 막대)
      const monthLast = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const weekCount = Math.floor((monthLast.getTime() - startMs) / (7 * 86400e3)) + 1;
      const thisWeekIdx = Math.floor((now.getTime() - startMs) / (7 * 86400e3));
      const sums: number[] = new Array(weekCount).fill(0);
      for (const c of cells) {
        const [y, m, d] = c.date.split('-').map(Number);
        const idx = Math.floor((new Date(y, m - 1, d).getTime() - startMs) / (7 * 86400e3));
        if (idx >= 0 && idx < weekCount) sums[idx] += c.totalFocusMinutes;
      }
      setBars(
        sums.map((v, i) => {
          const ws = new Date(weekStart0);
          ws.setDate(weekStart0.getDate() + i * 7);
          const we = new Date(ws);
          we.setDate(ws.getDate() + 6);
          // 달이 바뀌는 주만 월 표기(6/29~7/5), 같은 달 안의 주는 날짜만(6~12)
          const label =
            ws.getMonth() === we.getMonth()
              ? `${ws.getDate()}~${we.getDate()}`
              : `${ws.getMonth() + 1}/${ws.getDate()}~${we.getMonth() + 1}/${we.getDate()}`;
          return { label, value: v, current: i === thisWeekIdx, future: i > thisWeekIdx };
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (bars === null) {
    return (
      <View style={s.compareLoading}>
        <ActivityIndicator color={T.accent} size="small" />
      </View>
    );
  }
  return <LineChart bars={bars} color={FOCUS_COLOR} />;
}

// ST4 티저(월) — 1주~4주 누적 상승 막대(시안 레이아웃). 데이터는 표시용 고정값.
const CUMULATIVE = [28, 52, 74, 100];

function WeeklyCumulativeChart() {
  return (
    <View style={[s.teaserPad, s.teaserBars]}>
      {CUMULATIVE.map((v, i) => (
        <View key={i} style={s.teaserBarCol}>
          <View style={s.teaserBarTrack}>
            <View style={[s.teaserBar, { height: `${v}%` }]} />
          </View>
          <Text style={s.teaserLegendText}>{i + 1}주</Text>
        </View>
      ))}
    </View>
  );
}

// ST4(일) 시간대별 집중 타임테이블 — 스터디 플래너식 격자. 한 줄 = 1시간(칸 6개 × 10분),
// 첫 줄 오전 6시 → 다음날 새벽 5시까지 24줄. 격자는 항상 그려지고, 오늘 세션(GET /focus-session)이
// 겹친 슬롯만 칠해진다(칠 농도 = 슬롯 내 집중 비율). 서버 집계 없이 세션 구간만으로 계산(GROMO-761).
const TIMETABLE_HOURS = Array.from({ length: 24 }, (_, i) => (i + 6) % 24);

function FocusTimetable() {
  const { subjects } = useSubjects();
  const [slots, setSlots] = useState<FocusSlotSegment[][] | null>(null);
  // 서버 tagId → 태그명 (과목 색 매칭용). 로컬 과목 id는 서버 tagId와 다를 수 있어 이름으로 잇는다.
  const [tagNames, setTagNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [sessions, tags] = await Promise.all([
        fetchTodayFocusSessions().catch(() => []),
        getFocusTags().catch(() => []),
      ]);
      if (cancelled) return;
      setTagNames(new Map(tags.map((t) => [t.tagId, t.name])));
      setSlots(tenMinuteFocusSlots(sessions));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (slots === null) {
    return (
      <View style={s.compareLoading}>
        <ActivityIndicator color={T.accent} size="small" />
      </View>
    );
  }

  // 구간의 과목 색 — tagId → 태그명 → 로컬 과목 색. 미분류·매칭 실패는 기본 집중색.
  const colorForTag = (tagId: string | null): string => {
    const name = tagId ? tagNames.get(tagId) : undefined;
    const subject = name ? subjects.find((x) => x.name === name) : undefined;
    return subject?.color ?? FOCUS_COLOR;
  };

  // 왼쪽 범례 — 오늘 타임테이블에 등장한 과목만, 과목 순서대로. 텍스트를 형광펜처럼 과목 색으로 칠한다.
  const usedNames = new Set(
    slots
      .flat()
      .map((seg) => (seg.tagId ? tagNames.get(seg.tagId) : undefined))
      .filter((name): name is string => name != null),
  );
  const legendSubjects = subjects.filter((x) => usedNames.has(x.name));

  return (
    <View>
      <View style={s.ttLayout}>
        {/* 범례 칼럼은 비어도 자리를 유지 — 격자 크기가 범례 유무와 무관하게 고정되도록 */}
        <View style={s.ttLegendCol}>
          {legendSubjects.map((sub) => (
            <Text
              key={sub.id}
              style={[s.ttLegendText, { backgroundColor: sub.color }]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {sub.name}
            </Text>
          ))}
        </View>
        <View style={s.ttGrid}>
          {TIMETABLE_HOURS.map((hour) => (
            <View key={hour} style={s.ttRow}>
              <Text style={s.ttHourLabel} allowFontScaling={false}>
                {hour}
              </Text>
              {Array.from({ length: 6 }, (_, i) => {
                const segments = slots[hour * 6 + i];
                return (
                  <View key={i} style={s.ttCell}>
                    {/* 슬롯 내 실제 집중 위치 그대로 칠함 — 3:35~3:45 집중이면 3:30 칸 오른쪽 절반 */}
                    {segments.map((seg, j) => (
                      <View
                        key={j}
                        style={[
                          s.ttCellFill,
                          {
                            backgroundColor: colorForTag(seg.tagId),
                            left: `${seg.start * 100}%`,
                            width: `${(seg.end - seg.start) * 100}%`,
                          },
                        ]}
                      />
                    ))}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </View>
      <Text style={s.grassHint}>한 칸 = 10분 · 집중한 과목 색으로 칠해져요</Text>
    </View>
  );
}

// 선그래프 — BarChart와 같은 데이터(StatBar[])·세로축 구조를 쓰되 값을 점+꺾은선으로 잇는다(주 탭, GROMO-761).
// 점의 x좌표는 아래 라벨 칼럼(flex 균등 분할)의 중앙과 일치. 직선·원은 SVG가 필요해 react-native-svg 사용.
const DOT_PAD = 6; // 점(최대 r 4.5)이 캔버스 경계에서 잘리지 않게 사방 여유
function LineChart({ bars, color }: { bars: StatBar[]; color: string }) {
  const [plotW, setPlotW] = useState(0);
  if (bars.length === 0) {
    return <Text style={s.emptyText}>아직 기록이 없어요</Text>;
  }
  const axisMax = axisCeil(Math.max(...bars.map((b) => b.value), 1));
  const step = plotW / bars.length;
  // 아직 오지 않은 구간(future)은 라벨만 남기고 선·점에서 제외 — x좌표는 원래 칼럼 위치 유지
  const pts = bars
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => !b.future)
    .map(({ b, i }) => ({
      x: step * (i + 0.5),
      y: CHART_H - (b.value / axisMax) * CHART_H,
      current: b.current,
    }));
  return (
    <View style={s.chartPlotRow}>
      {/* 세로축 — 상한·⅔·⅓ 눈금 3줄 (막대 차트와 동일) */}
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
      <View style={s.chartPlot} onLayout={(e) => setPlotW(e.nativeEvent.layout.width)}>
        <View style={[s.chartGridLine, s.chartGridTop]} />
        <View style={[s.chartGridLine, s.chartGridUpper]} />
        <View style={[s.chartGridLine, s.chartGridLower]} />
        <View style={[s.chartGridLine, s.chartGridBottom]} />
        {plotW > 0 && (
          // 캔버스를 점 반지름만큼 사방으로 키우고 음수 마진으로 되돌림 — 상단(최댓값)·바닥(0)의
          // 점이 캔버스 경계에서 잘리지 않게 (SVG는 자기 영역 밖을 클리핑)
          <Svg width={plotW + DOT_PAD * 2} height={CHART_H + DOT_PAD * 2} style={s.lineSvg}>
            <Polyline
              points={pts.map((p) => `${p.x + DOT_PAD},${p.y + DOT_PAD}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={2}
            />
            {pts.map((p, i) => (
              <Circle
                key={i}
                cx={p.x + DOT_PAD}
                cy={p.y + DOT_PAD}
                r={p.current ? 4.5 : 3}
                fill={color}
              />
            ))}
          </Svg>
        )}
        <View style={s.lineLabelRow}>
          {bars.map((b, i) => (
            <Text
              key={`${b.label}-${i}`}
              style={[s.lineLabel, b.current ? [s.lineLabelCur, { color }] : null]}
              allowFontScaling={false}
            >
              {b.label}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

function BarChart({ bars, color }: { bars: StatBar[]; color: string }) {
  if (bars.length === 0) {
    return <Text style={s.emptyText}>아직 기록이 없어요</Text>;
  }
  // 세로축 상한 — 보기 좋은 값으로 올림하고 막대도 같은 기준으로 정규화해 눈금과 일치(GROMO-761)
  const axisMax = axisCeil(Math.max(...bars.map((b) => b.value), 1));
  return (
    <View style={s.chartPlotRow}>
      {/* 세로축 — 상한·⅔·⅓ 눈금 3줄 (그리드라인 높이에 맞춰 절대 배치, 상한은 3의 배수라 전부 정수 분) */}
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
        <View style={s.chart}>
          {bars.map((b, i) => {
            const h = Math.max((b.value / axisMax) * CHART_H, 3);
            return (
              <View key={`${b.label}-${i}`} style={s.barCol}>
                <View style={s.barTrack}>
                  <View
                    style={[
                      s.bar,
                      { height: h, backgroundColor: color, opacity: b.current ? 1 : 0.32 },
                    ]}
                  />
                </View>
                <Text style={[s.barLabel, b.current ? { color, fontWeight: '800' } : null]}>
                  {b.label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function CategoryBars({
  items,
  total,
}: {
  items: { tagId: string | null; tagName: string | null; totalFocusMinutes: number }[];
  total: number;
}) {
  if (items.length === 0) {
    return <Text style={s.emptyText}>아직 기록이 없어요</Text>;
  }
  const denom = total || 1;
  return (
    <View style={s.catList}>
      {items.map((it, i) => {
        const pct = Math.round((it.totalFocusMinutes / denom) * 100);
        const color = T.subjectPalette[i % T.subjectPalette.length];
        return (
          <View key={it.tagId ?? `untagged-${i}`} style={s.catRow}>
            <View style={s.catHead}>
              <Text style={s.catName} numberOfLines={1}>
                {it.tagName ?? '미분류'}
              </Text>
              <Text style={s.catValue}>{fmtMinutes(it.totalFocusMinutes)}</Text>
            </View>
            <View style={s.catTrack}>
              <View
                style={[s.catFill, { width: `${Math.max(pct, 2)}%`, backgroundColor: color }]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function DeltaRow({
  label,
  delta,
  base,
  lowerIsBetter,
}: {
  label: string;
  delta: number;
  base: number;
  lowerIsBetter: boolean;
}) {
  const pct = base > 0 ? Math.round((Math.abs(delta) / base) * 100) : null;
  const up = delta > 0;
  const flat = delta === 0;
  const good = flat ? false : lowerIsBetter ? !up : up;
  const arrow = flat ? '–' : up ? '▲' : '▼';
  const color = flat ? T.inkMuted : good ? T.successInk : T.dangerInk;
  return (
    <View style={s.deltaRow}>
      <Text style={s.deltaLabel}>{label}</Text>
      <View style={s.deltaValueWrap}>
        <Text style={[s.deltaArrow, { color }]}>{arrow}</Text>
        <Text style={[s.deltaPct, { color }]}>{pct === null ? '–' : `${pct}%`}</Text>
        <Text style={s.deltaMin}>{flat ? '변화 없어요' : `${fmtMinutes(Math.abs(delta))}`}</Text>
      </View>
    </View>
  );
}

function GoalBlock({
  period,
  data,
}: {
  period: StatsPeriod;
  data: ReturnType<typeof useStatsData>['data'];
}) {
  // DAY: 오늘 목표 달성률. WEEK/MONTH: 달성일/경과일.
  if (period === 'DAY') {
    const f = data.today?.focus;
    const percent = f?.progressPercent ?? 0;
    const achieved = f?.goalAchieved ?? false;
    return (
      <View>
        <Text style={[s.bigStat, { color: achieved ? T.successInk : T.ink }]}>{percent}%</Text>
        <Text style={s.goalSub}>
          목표 {fmtMinutes(f?.goalMinutes ?? 0)} 중 {fmtMinutes(f?.todayMinutes ?? 0)}{' '}
          {achieved ? '달성 ✓' : ''}
        </Text>
      </View>
    );
  }
  const rate = focusGoalRate(data.heatmap);
  return (
    <View>
      <Text style={[s.bigStat, { color: T.successInk }]}>{rate.percent}%</Text>
      <Text style={s.goalSub}>
        {rate.total}일 중 {rate.achieved}일 달성
      </Text>
    </View>
  );
}

function GrassGrid({ cells }: { cells: HeatmapCellResponse[] }) {
  if (cells.length === 0) {
    return <Text style={s.emptyText}>아직 기록이 없어요</Text>;
  }
  return (
    <View style={s.grassWrap}>
      {cells.map((c) => (
        <View
          key={c.date}
          style={[s.grassCell, { backgroundColor: GRASS[grassLevel(c.totalFocusMinutes)] }]}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.paperLight },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...T.text.subtitle, color: T.ink },

  // 고정 필터
  filters: { paddingHorizontal: 18, paddingBottom: 10, gap: 10 },
  segment: {
    flexDirection: 'row',
    backgroundColor: T.sandLight,
    borderRadius: 12,
    padding: 3,
  },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  segBtnOn: {
    backgroundColor: T.white,
    shadowColor: T.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segText: { ...T.text.label, color: T.inkMuted },
  segTextOn: { color: T.ink },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingBottom: 40, gap: 14 },

  // 카드 공통
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardTitle: { ...T.text.heading, color: T.ink },
  cardCaption: { ...T.text.caption, color: T.inkMuted },
  bigStat: { ...T.text.title, color: T.ink },
  emptyText: { ...T.text.body, color: T.inkMuted, paddingVertical: 8 },

  // ST1 비교 스텁
  compare: { marginTop: 14, gap: 8 },
  compareLoading: { paddingVertical: 20, alignItems: 'center' },
  // 준비 중 티저 공용(가짜 차트) 스타일
  teaserPad: { paddingVertical: 4 },
  teaserRowHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  teaserRowGap: { marginTop: 12 },
  teaserLabelMine: { ...T.text.caption, fontWeight: '700', color: T.ink },
  teaserValueMine: { ...T.text.caption, fontWeight: '800', color: T.accent },
  teaserLabel: { ...T.text.caption, fontWeight: '600', color: T.inkSub },
  teaserValue: { ...T.text.caption, fontWeight: '700', color: T.inkSub },
  teaserTrack: { height: 10, borderRadius: 5, backgroundColor: T.sandLight, overflow: 'hidden' },
  teaserTrackGap: { marginTop: 4 },
  teaserFill: { height: 10, borderRadius: 5 },
  teaserFillMine: { width: '86%', backgroundColor: T.accent },
  teaserFillAvg: { width: '62%', backgroundColor: T.compare.avg },
  teaserFillPasser: { backgroundColor: T.compare.theirs },
  teaserDotPasser: { backgroundColor: T.compare.theirs },
  teaserLegend: { flexDirection: 'row', gap: 14, marginTop: 12 },
  teaserLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  teaserDot: { width: 9, height: 9, borderRadius: 2 },
  teaserLegendText: { ...T.text.caption, fontSize: 11, color: T.inkSub },
  teaserBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 14, height: 120 },
  teaserBarCol: { flex: 1, alignItems: 'center', gap: 6 },
  teaserBarTrack: { flex: 1, width: 26, justifyContent: 'flex-end' },
  teaserBar: { width: 26, borderRadius: 7, backgroundColor: T.greenDeep, opacity: 0.85 },

  compareChips: { flexDirection: 'row', gap: 8 },
  compareChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: T.sandLight,
  },
  compareChipText: { ...T.text.caption, color: T.inkMuted },
  compareChipOn: { backgroundColor: T.accent },
  compareChipTextOn: { color: T.white, fontWeight: '700' },
  compareNote: { ...T.text.caption, color: T.inkFaint },

  // 준비중 스텁 카드
  stubCard: { gap: 8 },
  stubBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
  },
  stubBadgeText: { ...T.text.caption, color: T.accentDeep },
  stubNote: { ...T.text.body, color: T.inkMuted },

  // 막대 차트
  chartPlotRow: { flexDirection: 'row', marginTop: 14 },
  // 선그래프 — 확장 캔버스를 음수 마진으로 되돌려 레이아웃(격자 정렬)은 그대로 유지
  lineSvg: {
    marginTop: -DOT_PAD,
    marginBottom: -DOT_PAD,
    marginLeft: -DOT_PAD,
    marginRight: -DOT_PAD,
  },
  // 선그래프 라벨 — 점 x좌표(칼럼 중앙)와 정렬되도록 균등 분할
  lineLabelRow: { flexDirection: 'row', marginTop: 8 },
  lineLabel: { ...T.text.caption, fontSize: 10, color: T.inkMuted, flex: 1, textAlign: 'center' },
  lineLabelCur: { fontWeight: '800' },
  chartAxisCol: { width: 36, height: CHART_H },
  chartAxisLabel: {
    ...T.text.caption,
    position: 'absolute',
    right: 6,
    fontSize: 9,
    color: T.inkMuted,
  },
  chartAxisTop: { top: -5 },
  chartAxisUpper: { top: CHART_H / 3 - 5 },
  chartAxisLower: { top: (CHART_H * 2) / 3 - 5 },
  chartPlot: { flex: 1 },
  chartGridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: T.paperAlt,
  },
  chartGridTop: { top: 0 },
  chartGridUpper: { top: CHART_H / 3 },
  chartGridLower: { top: (CHART_H * 2) / 3 },
  chartGridBottom: { top: CHART_H },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  barCol: { flex: 1, alignItems: 'center', gap: 8 },
  // 시간대별 타임테이블 — 왼쪽 과목 범례(형광펜 하이라이트) + 격자(한 줄 1시간 = 10분×6칸)
  ttLayout: { flexDirection: 'row', gap: 12, marginTop: 14 },
  ttLegendCol: { width: 76, gap: 6, paddingTop: 2, alignItems: 'flex-start' },
  ttLegendText: {
    ...T.text.caption,
    fontSize: 11,
    color: T.ink,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
  },
  ttGrid: { flex: 1, gap: 3 },
  ttRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ttHourLabel: { ...T.text.caption, fontSize: 9, color: T.inkMuted, width: 18, textAlign: 'right' },
  ttCell: {
    flex: 1,
    height: 14,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: T.paperAlt,
    backgroundColor: T.white,
    overflow: 'hidden',
  },
  ttCellFill: { position: 'absolute', top: 0, bottom: 0, backgroundColor: FOCUS_COLOR },
  barTrack: { height: CHART_H, justifyContent: 'flex-end' },
  bar: { width: 16, borderRadius: 6 },
  barLabel: { ...T.text.caption, color: T.inkMuted },

  // 과목별 비율 바
  catList: { gap: 12 },
  catRow: { gap: 6 },
  catHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  catName: { ...T.text.label, color: T.ink, flex: 1, marginRight: 8 },
  catValue: { ...T.text.label, color: T.inkSub },
  catTrack: { height: 10, borderRadius: 5, backgroundColor: T.sandLight, overflow: 'hidden' },
  catFill: { height: 10, borderRadius: 5 },

  // 전 대비
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  deltaLabel: { ...T.text.label, color: T.inkSub },
  deltaValueWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  deltaArrow: { ...T.text.label },
  deltaPct: { ...T.text.subtitle },
  deltaMin: { ...T.text.caption, color: T.inkMuted },

  // 목표 달성
  goalSub: { ...T.text.body, color: T.inkSub, marginTop: 4 },

  // 스트릭 + 잔디
  streakRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  streakItem: { flex: 1, alignItems: 'center', gap: 2 },
  streakDivider: { width: 1, height: 28, backgroundColor: T.divider },
  streakValue: { ...T.text.stat, color: T.ink },
  streakLabel: { ...T.text.caption, color: T.inkMuted },
  grassWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  grassCell: { width: 16, height: 16, borderRadius: 4 },
  grassHint: { ...T.text.caption, color: T.inkMuted, marginTop: 10 },
});
