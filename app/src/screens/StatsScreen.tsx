import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polygon, Polyline } from 'react-native-svg';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { CardOrderEditor } from './stats/CardOrderEditor';
import { STORAGE_KEYS } from '@/types/storage';
import { fetchTodayFocusSessions, sessionFocusSeconds } from '@/screens/focus/focusRestore';
import { getAllFocusSessions, getFocusTags } from '@/services/focusApi';
import type { FocusSessionResponse } from '@/types/dto/focus';
import { getHeatmap } from '@/services/statsApi';
import { useSubjects } from '@/store/SubjectContext';
import { localDateStr, todayStr } from '@/utils/localDate';
import { fmtMinutes, axisCeil, fmtAxis, hms } from '@/utils/timeFormat';
import {
  PERIOD_TABS,
  periodLabel,
  prevLabel,
  periodKey,
  heatmapBars,
  tenMinuteFocusSlots,
  focusGoalRate,
  grassLevel,
  dailyFirstStartMinutes,
  firstStartPoints,
  mergeCardOrder,
  type FocusSlotSegment,
  type StatBar,
  type StartTimePoint,
} from './stats/format';

// v2 내 통계 화면(GROMO-604) — 홈 '오늘' 카드의 '자세히'에서 진입.
// 상단 고정 필터(기간 일/주/월) 아래로 ST1~ST9 지표 스크롤.
// 실데이터: 집중시간·폰사용·전대비·목표달성·잔디·총공부량(나)·과목별(나).
// 준비 중: 비교(친구/전체/같은 카테고리)·합격자·주별 누적 — 소스 미비로 스텁.

const CHART_H = 120;
// 잔디 강도 0..4 색(빈 칸 → 진한 초록).
const GRASS = T.grass;
const FOCUS_COLOR = T.greenDeep;
const PHONE_COLOR = T.accent;

// 히트맵 셀 → 지표 추출기 — 렌더마다 재생성되지 않게 모듈 상수(훅 의존성 안정화)
const pickFocus = (c: HeatmapCellResponse) => c.totalFocusMinutes;
const pickScreenTime = (c: HeatmapCellResponse) => c.actualScreenTimeMinutes;

// 달력 일 번호 — UTC 자정으로 정규화해 DST가 있는 시간대에서도 일수 차이가 정확(리뷰 반영)
const dayNumber = (y: number, monthIdx: number, d: number) =>
  Math.floor(Date.UTC(y, monthIdx, d) / 86400e3);

export default function StatsScreen() {
  const navigation = useNavigation();
  const [period, setPeriod] = useState<StatsPeriod>('WEEK');
  const { data, loading } = useStatsData(period);
  const [editing, setEditing] = useState(false);
  // 카드 순서(탭별, GROMO-762) — AsyncStorage에서 로드, 드래그 확정 시마다 저장.
  // 로드 완료 전에 그리면 기본 순서가 잠깐 보였다 튀므로 플래그로 막는다.
  const [cardOrder, setCardOrder] = useState<Record<string, string[]>>({});
  const [orderLoaded, setOrderLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.statsCardOrder)
      .then((raw) => {
        if (raw) setCardOrder(JSON.parse(raw));
      })
      .catch(() => {}) // 조회·파싱 실패 → 기본 순서
      .finally(() => setOrderLoaded(true));
  }, []);

  const onReorderCards = (keys: string[]) => {
    const next = { ...cardOrder, [period]: keys };
    setCardOrder(next);
    AsyncStorage.setItem(STORAGE_KEYS.statsCardOrder, JSON.stringify(next)).catch(() => {});
  };

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

  // 카드 목록(현재 탭) — push 순서가 기본 순서(기존 렌더 순서 그대로). key는 순서 저장(AsyncStorage)에
  // 쓰이므로 바꾸면 유저가 저장한 순서와 어긋난다(GROMO-762).
  const month = new Date().getMonth() + 1;
  const cards: { key: string; node: ReactNode }[] = [];

  // ST1 총 공부량 (나) + 비교 — 주간은 리그 랭킹·친구 통계 기반 실비교(GROMO-761), 일/월은 준비중
  cards.push({
    key: 'total',
    node: (
      <SectionCard key="total" title="총 공부량" caption={periodLabel(period)}>
        <Text style={s.bigStat}>{fmtMinutes(data.focus?.totalFocusMinutes ?? 0)}</Text>
        {period === 'WEEK' ? (
          <CompareWeek myMinutes={data.focus?.totalFocusMinutes ?? 0} />
        ) : (
          <CompareStub />
        )}
      </SectionCard>
    ),
  });

  // ST2 과목별 공부량 (나) — 총 공부량 바로 아래. 주/월 탭은 도넛(비중), 일 탭은 가로 막대
  cards.push({
    key: 'category',
    node: (
      <SectionCard key="category" title="과목별 공부량" caption={periodLabel(period)}>
        {period !== 'DAY' ? (
          <CategoryDonut
            items={data.category?.items ?? []}
            total={data.category?.totalFocusMinutes ?? 0}
          />
        ) : (
          <CategoryBars
            items={data.category?.items ?? []}
            total={data.category?.totalFocusMinutes ?? 0}
          />
        )}
      </SectionCard>
    ),
  });

  // 타임테이블(일) — 오늘 세션 실데이터, 과목별 공부량 아래(GROMO-761)
  if (period === 'DAY') {
    cards.push({
      key: 'timetable',
      node: (
        <SectionCard key="timetable" title="타임테이블" caption="오늘">
          <FocusTimetable />
        </SectionCard>
      ),
    });
  }

  // 해당월 주별 공부시간·핸드폰 사용량(월) — 과목별 아래. heatmap 주차 합산 실데이터(GROMO-761)
  if (period === 'MONTH') {
    cards.push({
      key: 'monthWeeklyFocus',
      node: (
        <SectionCard key="monthWeeklyFocus" title={`${month}월 주별 공부시간`}>
          <MonthWeeklyChart pick={pickFocus} color={FOCUS_COLOR} />
        </SectionCard>
      ),
    });
    cards.push({
      key: 'monthWeeklyPhone',
      node: (
        <SectionCard key="monthWeeklyPhone" title={`${month}월 주별 핸드폰 사용량`}>
          <MonthWeeklyChart pick={pickScreenTime} color={PHONE_COLOR} />
        </SectionCard>
      ),
    });
  }

  // ST5·ST6 요일별 집중시간·핸드폰 사용량(주) — 일 탭은 타임테이블이, 월 탭은 'N월 주별'이 대체
  if (period === 'WEEK') {
    cards.push({
      key: 'weekdayFocus',
      node: (
        <SectionCard key="weekdayFocus" title="요일별 집중시간" caption={periodLabel(period)}>
          <Text style={[s.bigStat, { color: FOCUS_COLOR }]}>
            총 {fmtMinutes(data.focus?.totalFocusMinutes ?? 0)}
          </Text>
          <LineChart
            bars={heatmapBars(period, data.heatmap, (c) => c.totalFocusMinutes)}
            color={FOCUS_COLOR}
          />
        </SectionCard>
      ),
    });
    cards.push({
      key: 'weekdayPhone',
      node: (
        <SectionCard key="weekdayPhone" title="요일별 핸드폰 사용량" caption={periodLabel(period)}>
          <Text style={[s.bigStat, { color: PHONE_COLOR }]}>
            총 {fmtMinutes(data.screenTime?.currentMinutes ?? 0)}
          </Text>
          <LineChart
            bars={heatmapBars(period, data.heatmap, (c) => c.actualScreenTimeMinutes)}
            color={PHONE_COLOR}
          />
        </SectionCard>
      ),
    });
  }

  // 첫 시작 시각 추이(주·월) — 일별 첫 세션 startedAt 기반(GROMO-762).
  // 월 탭은 주별 평균값이라 제목에 명시(다른 'N월 ~' 카드와 표기 통일)
  if (period !== 'DAY') {
    const firstStartTitle =
      period === 'WEEK' ? '요일별 첫 집중 시작 시각' : `${month}월 첫 집중 시작 시각 평균`;
    cards.push({
      key: 'firstStart',
      node: (
        <SectionCard
          key="firstStart"
          title={firstStartTitle}
          caption={period === 'WEEK' ? '이번 주' : undefined}
        >
          {/* key로 탭 전환 시 리마운트 — 이전 기간 점이 새 라벨 위에 잠깐 보이는 것 방지 */}
          <FirstStartChart key={period} period={period} />
        </SectionCard>
      ),
    });
  }

  // 최장 연속 집중(일·주·월) — 기간 내 최장 세션 기록(GROMO-762)
  cards.push({
    key: 'longest',
    node: (
      <SectionCard key="longest" title="최장 연속 집중" caption={periodLabel(period)}>
        <LongestSessionStat key={period} period={period} />
      </SectionCard>
    ),
  });

  // ST3 합격자 비교 — 레이더 티저 + 블러(데이터 준비 중)
  cards.push({
    key: 'passer',
    node: (
      <SectionCard key="passer" title="합격자와 비교" caption="과목별">
        <ComingSoon note="합격자 데이터가 쌓이면 보여드릴게요">
          <PasserCompareChart />
        </ComingSoon>
      </SectionCard>
    ),
  });

  // ST7 전(前) 대비
  cards.push({
    key: 'delta',
    node: (
      <SectionCard key="delta" title={`${prevLabel(period)} 대비`}>
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
    ),
  });

  // ST8 목표 달성
  cards.push({
    key: 'goal',
    node: (
      <SectionCard key="goal" title="목표 달성" caption={periodLabel(period)}>
        <GoalBlock period={period} data={data} />
      </SectionCard>
    ),
  });

  // ST9 공부 잔디 (Streak) — 일 탭에선 숨김(하루 데이터로는 잔디가 무의미)
  if (period !== 'DAY') {
    cards.push({
      key: 'grass',
      node: (
        <SectionCard key="grass" title="공부 잔디">
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
          {/* 주 탭은 월~일 7칸 한 줄, 월 탭은 해당 월 전체 날짜 7칸씩 그리드 */}
          {period === 'WEEK' ? (
            <WeekGrassRow cells={data.heatmap} />
          ) : (
            <MonthGrassGrid cells={data.heatmap} />
          )}
          <Text style={s.grassHint}>공부시간이 많을수록 칸이 진해져요</Text>
        </SectionCard>
      ),
    });
  }

  // 저장된 순서 적용 — 저장이 없거나 이후 새 카드가 생겼으면 기본 순서에 병합
  const orderedKeys = mergeCardOrder(
    cards.map((c) => c.key),
    cardOrder[period],
  );
  const byKey = new Map(cards.map((c) => [c.key, c]));
  const orderedCards = orderedKeys.flatMap((k) => byKey.get(k) ?? []);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* ── 헤더 ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={T.ink} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>통계</Text>
        {/* 카드 순서 편집 토글(GROMO-762) — 연필로 진입, 체크로 완료. 순서는 드래그를 놓을 때마다 저장 */}
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => setEditing((v) => !v)}
          activeOpacity={0.7}
        >
          <Ionicons name={editing ? 'checkmark' : 'pencil'} size={20} color={T.ink} />
        </TouchableOpacity>
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

      {firstLoad || !orderLoaded ? (
        <View style={s.loader}>
          <ActivityIndicator color={T.accent} />
        </View>
      ) : editing ? (
        // 순서 편집 모드 — 실제 카드 오른쪽 위 핸들을 잡아 카드를 끌어 순서 변경. 탭을 바꾸면 그 탭 순서 편집(탭별 저장)
        <CardOrderEditor key={period} cards={orderedCards} onReorder={onReorderCards} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {orderedCards.map((c) => c.node)}
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

  // 화면 재진입마다 재조회 — 리뷰 반영(타임테이블과 동일 패턴)
  useFocusEffect(
    useCallback(() => {
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
    }, []),
  );

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
// ST3 티저 — 과목별 나 vs 합격자 평균 레이더 차트(표시용 고정값, ComingSoon 블러 아래에 깔림).
const RADAR_AXES = [
  { name: '노동법', mine: 0.78, passer: 0.92 },
  { name: '민법', mine: 0.5, passer: 0.75 },
  { name: '행정쟁송법', mine: 0.55, passer: 0.7 },
  { name: '사회보험법', mine: 0.4, passer: 0.62 },
  { name: '경영학', mine: 0.65, passer: 0.6 },
];
const RADAR_SIZE = 210;
const RADAR_R = 72;

// 축 i의 반지름 비율 frac(0~1) 지점 좌표 — 12시 방향부터 시계 방향 균등 분할
function radarPoint(i: number, frac: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / RADAR_AXES.length;
  return {
    x: RADAR_SIZE / 2 + RADAR_R * frac * Math.cos(angle),
    y: RADAR_SIZE / 2 + RADAR_R * frac * Math.sin(angle),
  };
}

function radarPolygon(fracs: number[]): string {
  return fracs
    .map((f, i) => {
      const p = radarPoint(i, f);
      return `${p.x},${p.y}`;
    })
    .join(' ');
}

function PasserCompareChart() {
  return (
    <View style={s.radarWrap}>
      <View style={s.radarCanvas}>
        <Svg width={RADAR_SIZE} height={RADAR_SIZE}>
          {/* 배경 격자 — ⅓·⅔·1 폴리곤 + 중심에서 꼭짓점으로 축선 */}
          {[1 / 3, 2 / 3, 1].map((lv) => (
            <Polygon
              key={lv}
              points={radarPolygon(RADAR_AXES.map(() => lv))}
              fill="none"
              stroke={T.paperAlt}
              strokeWidth={1}
            />
          ))}
          {RADAR_AXES.map((_, i) => {
            const p = radarPoint(i, 1);
            return (
              <Line
                key={i}
                x1={RADAR_SIZE / 2}
                y1={RADAR_SIZE / 2}
                x2={p.x}
                y2={p.y}
                stroke={T.paperAlt}
                strokeWidth={1}
              />
            );
          })}
          {/* 합격자 평균 → 나 순서로 겹쳐 그림 */}
          <Polygon
            points={radarPolygon(RADAR_AXES.map((a) => a.passer))}
            fill={T.compare.theirs}
            fillOpacity={0.18}
            stroke={T.compare.theirs}
            strokeWidth={1.5}
          />
          <Polygon
            points={radarPolygon(RADAR_AXES.map((a) => a.mine))}
            fill={T.accent}
            fillOpacity={0.25}
            stroke={T.accent}
            strokeWidth={2}
          />
        </Svg>
        {/* 축 라벨 — 꼭짓점 바깥에 절대 배치 */}
        {RADAR_AXES.map((a, i) => {
          const p = radarPoint(i, 1.28);
          return (
            <Text
              key={a.name}
              style={[s.radarLabel, { left: p.x - 40, top: p.y - 8 }]}
              allowFontScaling={false}
            >
              {a.name}
            </Text>
          );
        })}
      </View>
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

// 해당월 주별 차트(월 탭) — 이달 1일이 낀 주(월~일)의 월요일부터 heatmap을 달력 주 단위로 합산,
// 가로축은 실제 날짜 구간(예: 6/29~7/5)·해당월 전체 주 미리 기재·미래 주는 선 미표시. 전용 집계 API
// 없이 파생 계산(GROMO-761). 지표(pick)·색만 바꿔 공부시간/핸드폰 사용량이 공유한다.
function MonthWeeklyChart({
  pick,
  color,
}: {
  pick: (c: HeatmapCellResponse) => number;
  color: string;
}) {
  const [bars, setBars] = useState<StatBar[] | null>(null);

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 최신 반영(리뷰 반영, useStatsData와 동일 패턴)
  useFocusEffect(
    useCallback(() => {
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
        // 주차 인덱스는 달력 일수 차이 기준 — 경과 ms 나눗셈은 DST 전환일에 하루가 23/25시간이라 어긋난다(리뷰 반영)
        const startDay = dayNumber(
          weekStart0.getFullYear(),
          weekStart0.getMonth(),
          weekStart0.getDate(),
        );
        // 해당 월의 모든 주를 미리 기재 — 말일이 낀 주까지 포함(아직 안 온 주는 0으로 빈 막대)
        const monthLast = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const weekCount =
          Math.floor(
            (dayNumber(monthLast.getFullYear(), monthLast.getMonth(), monthLast.getDate()) -
              startDay) /
              7,
          ) + 1;
        const thisWeekIdx = Math.floor(
          (dayNumber(now.getFullYear(), now.getMonth(), now.getDate()) - startDay) / 7,
        );
        const sums: number[] = new Array(weekCount).fill(0);
        for (const c of cells) {
          const [y, m, d] = c.date.split('-').map(Number);
          const idx = Math.floor((dayNumber(y, m - 1, d) - startDay) / 7);
          if (idx >= 0 && idx < weekCount) sums[idx] += pick(c);
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
    }, [pick]),
  );

  if (bars === null) {
    return (
      <View style={s.compareLoading}>
        <ActivityIndicator color={T.accent} size="small" />
      </View>
    );
  }
  return <LineChart bars={bars} color={color} />;
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

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 방금 세션이 타임테이블에 반영(리뷰 반영)
  useFocusEffect(
    useCallback(() => {
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
    }, []),
  );

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

// 첫 시작 시각 추이(주·월) — 일별 첫 세션 startedAt을 점으로만 찍는다(선 연결 없음, GROMO-762).
// 세로축은 시각이라 LineChart(0부터 시작하는 분량 축)를 못 쓰고 전용 축을 그린다. 시간표처럼
// 이른 시각이 위 — 시작이 빨라지면 점이 올라간다. 주=요일별, 월=주별 평균. 서버 집계 없이 세션 조회만으로 계산.
function FirstStartChart({ period }: { period: StatsPeriod }) {
  const [points, setPoints] = useState<StartTimePoint[] | null>(null);
  const [plotW, setPlotW] = useState(0);

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 방금 세션이 반영(타임테이블과 동일 패턴)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // 조회 시작점: 주=이번 주 월요일, 월=이달 1일이 낀 주의 월요일('N월 주별' 차트와 동일 구간).
        // 서버 /focus-session은 startedAt 필터라 '그날 시작한 세션'과 정확히 일치한다.
        const now = new Date();
        const from = new Date(
          period === 'WEEK' ? now : new Date(now.getFullYear(), now.getMonth(), 1),
        );
        const dow = from.getDay(); // 0=일..6=토
        from.setDate(from.getDate() - (dow === 0 ? 6 : dow - 1));
        from.setHours(0, 0, 0, 0);
        // 조회 실패 → 빈 차트("아직 기록이 없어요")로 표시
        const all = await getAllFocusSessions(from.toISOString(), new Date().toISOString()).catch(
          () => [] as FocusSessionResponse[],
        );
        if (cancelled) return;
        setPoints(firstStartPoints(period, dailyFirstStartMinutes(all)));
      })();
      return () => {
        cancelled = true;
      };
    }, [period]),
  );

  if (points === null) {
    return (
      <View style={s.compareLoading}>
        <ActivityIndicator color={T.accent} size="small" />
      </View>
    );
  }

  const vals = points.filter((p) => !p.future && p.minutes != null).map((p) => p.minutes as number);
  if (vals.length === 0) {
    return <Text style={s.emptyText}>아직 기록이 없어요</Text>;
  }

  // 세로축 경계 — 정시로 내리고 폭을 3시간 배수로 맞춰 ⅓·⅔ 눈금도 정시가 되게 한다
  let axisMin = Math.floor(Math.min(...vals) / 60) * 60;
  const span = Math.max(180, Math.ceil((Math.max(...vals) - axisMin) / 180) * 180);
  let axisMax = axisMin + span;
  if (axisMax > 1440) {
    // 심야 시작이면 축이 24시를 넘지 않게 아래로 내림
    axisMax = 1440;
    axisMin = 1440 - span;
  }
  const fmtClock = (m: number) => `${Math.floor(m / 60)}시`;
  const step = plotW / points.length;
  // 미래 구간·기록 없는 날은 라벨만 남기고 점에서 제외(0으로 찍으면 '자정 시작'으로 왜곡)
  const pts = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.future && p.minutes != null)
    .map(({ p, i }) => ({
      x: step * (i + 0.5),
      y: (((p.minutes as number) - axisMin) / (axisMax - axisMin)) * CHART_H,
    }));
  return (
    <View>
      <View style={s.chartPlotRow}>
        {/* 세로축 — 위가 이른 시각. 분량 축과 달리 바닥이 0이 아니라 4눈금 모두 라벨 */}
        <View style={s.chartAxisCol}>
          <Text style={[s.chartAxisLabel, s.chartAxisTop]} allowFontScaling={false}>
            {fmtClock(axisMin)}
          </Text>
          <Text style={[s.chartAxisLabel, s.chartAxisUpper]} allowFontScaling={false}>
            {fmtClock(axisMin + span / 3)}
          </Text>
          <Text style={[s.chartAxisLabel, s.chartAxisLower]} allowFontScaling={false}>
            {fmtClock(axisMin + (span * 2) / 3)}
          </Text>
          <Text style={[s.chartAxisLabel, s.chartAxisBottom]} allowFontScaling={false}>
            {fmtClock(axisMax)}
          </Text>
        </View>
        <View style={s.chartPlot} onLayout={(e) => setPlotW(e.nativeEvent.layout.width)}>
          <View style={[s.chartGridLine, s.chartGridTop]} />
          <View style={[s.chartGridLine, s.chartGridUpper]} />
          <View style={[s.chartGridLine, s.chartGridLower]} />
          <View style={[s.chartGridLine, s.chartGridBottom]} />
          {plotW > 0 && (
            <Svg width={plotW + DOT_PAD * 2} height={CHART_H + DOT_PAD * 2} style={s.lineSvg}>
              {/* 선 없이 점만이라 크게(r 5, DOT_PAD 안) — 오늘 강조는 크기 대신 라벨 볼드만 */}
              {pts.map((p, i) => (
                <Circle key={i} cx={p.x + DOT_PAD} cy={p.y + DOT_PAD} r={5} fill={FOCUS_COLOR} />
              ))}
            </Svg>
          )}
          <View style={s.lineLabelRow}>
            {points.map((p, i) => (
              <Text
                key={`${p.label}-${i}`}
                style={[s.lineLabel, p.current ? [s.lineLabelCur, { color: FOCUS_COLOR }] : null]}
                allowFontScaling={false}
              >
                {p.label}
              </Text>
            ))}
          </View>
        </View>
      </View>
      <Text style={s.grassHint}>그날 처음 집중을 시작한 시각 · 위로 갈수록 이른 시각이에요</Text>
    </View>
  );
}

// 최장 연속 집중(일·주·월) — 기간 내 가장 긴 세션(endedAt−startedAt, 방해시간 미차감)을 HH:MM:SS로.
// 기간 귀속은 앱의 '오늘' 규칙(홈 정산·타임테이블)과 동일하게 종료 시점 기준 — 기간 시작 하루 전부터
// 받아 endedAt으로 거른다. 월은 이달 1일부터('N월 주별'류의 주 정렬과 달리 달 자체의 기록이라 1일 기준).
function LongestSessionStat({ period }: { period: StatsPeriod }) {
  const [seconds, setSeconds] = useState<number | null>(null); // null=로딩 · 0=기록 없음

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 방금 세션이 반영(타임테이블과 동일 패턴)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        let sessions: FocusSessionResponse[];
        if (period === 'DAY') {
          sessions = await fetchTodayFocusSessions().catch(() => []);
        } else {
          // 기간 시작(로컬 자정): 주=이번 주 월요일, 월=이달 1일
          const now = new Date();
          const dow = now.getDay(); // 0=일..6=토
          const start =
            period === 'WEEK'
              ? new Date(
                  now.getFullYear(),
                  now.getMonth(),
                  now.getDate() + (dow === 0 ? -6 : 1 - dow),
                )
              : new Date(now.getFullYear(), now.getMonth(), 1);
          // 자정 걸친 세션 포함 위해 하루 전부터 받아 endedAt으로 거른다(fetchTodayFocusSessions와 동일 방식)
          const from = new Date(start);
          from.setDate(from.getDate() - 1);
          const all = await getAllFocusSessions(from.toISOString(), now.toISOString()).catch(
            () => [] as FocusSessionResponse[],
          );
          sessions = all.filter((x) => Date.parse(x.endedAt) >= start.getTime());
        }
        if (cancelled) return;
        setSeconds(sessions.reduce((mx, x) => Math.max(mx, sessionFocusSeconds(x)), 0));
      })();
      return () => {
        cancelled = true;
      };
    }, [period]),
  );

  if (seconds === null) {
    return (
      <View style={s.compareLoading}>
        <ActivityIndicator color={T.accent} size="small" />
      </View>
    );
  }
  if (seconds <= 0) {
    return <Text style={s.emptyText}>아직 기록이 없어요</Text>;
  }
  return (
    <View>
      <Text style={[s.bigStat, { color: FOCUS_COLOR }]}>{hms(seconds)}</Text>
      <Text style={s.grassHint}>한 번에 가장 오래 이어간 집중 세션이에요</Text>
    </View>
  );
}

// ST2(주) 과목별 공부량 도넛 — 과목별 비중을 링 구간(strokeDasharray)으로 그리고 가운데에 총합,
// 우측 범례에 과목·비중을 표시(GROMO-761). 색은 CategoryBars와 동일하게 팔레트 순서 배정.
const DONUT_SIZE = 132;
const DONUT_STROKE = 20;

function CategoryDonut({
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
  const half = DONUT_SIZE / 2;
  const r = (DONUT_SIZE - DONUT_STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  let acc = 0;
  const segs = items.map((it, i) => {
    const seg = {
      frac: it.totalFocusMinutes / denom,
      offset: acc,
      color: T.subjectPalette[i % T.subjectPalette.length],
      name: it.tagName ?? '미분류',
    };
    acc += seg.frac;
    return seg;
  });
  return (
    <View style={s.donutRow}>
      <View style={s.donutWrap}>
        <Svg width={DONUT_SIZE} height={DONUT_SIZE}>
          <Circle
            cx={half}
            cy={half}
            r={r}
            stroke={T.track}
            strokeWidth={DONUT_STROKE}
            fill="none"
          />
          {segs.map((sg, i) => (
            <Circle
              key={i}
              cx={half}
              cy={half}
              r={r}
              stroke={sg.color}
              strokeWidth={DONUT_STROKE}
              fill="none"
              strokeDasharray={`${sg.frac * circumference} ${circumference}`}
              strokeDashoffset={-sg.offset * circumference}
              transform={`rotate(-90 ${half} ${half})`}
            />
          ))}
        </Svg>
        {/* 가운데 총합 — 12시 방향부터 시계 방향으로 구간이 채워진다 */}
        <View style={s.donutCenter}>
          <Text style={s.donutCenterValue} allowFontScaling={false}>
            {fmtMinutes(total)}
          </Text>
          <Text style={s.donutCenterLabel}>총 공부</Text>
        </View>
      </View>
      <View style={s.donutLegend}>
        {segs.map((sg, i) => (
          <View key={i} style={s.donutLegendRow}>
            <View style={[s.donutLegendDot, { backgroundColor: sg.color }]} />
            <Text style={s.donutLegendName} numberOfLines={1}>
              {sg.name}
            </Text>
            <Text style={s.donutLegendPct} allowFontScaling={false}>
              {Math.round(sg.frac * 100)}%
            </Text>
          </View>
        ))}
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

// ST9(주) 공부 잔디 한 줄 — 월~일 7칸 정사각형 고정, 공부량이 많을수록 진해진다(GROMO-761).
// 아직 안 온 요일은 빈 칸(레벨 0)으로 자리만 유지.
const WEEK_DAYS = ['월', '화', '수', '목', '금', '토', '일'];

function WeekGrassRow({ cells }: { cells: HeatmapCellResponse[] }) {
  const minutesByDay = [0, 0, 0, 0, 0, 0, 0];
  for (const c of cells) {
    const [y, m, d] = c.date.split('-').map(Number);
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0=월..6=일
    minutesByDay[dow] = c.totalFocusMinutes;
  }
  return (
    <View style={s.weekGrassRow}>
      {WEEK_DAYS.map((d, i) => (
        <View key={d} style={s.weekGrassCol}>
          <View
            style={[s.weekGrassCell, { backgroundColor: GRASS[grassLevel(minutesByDay[i])] }]}
          />
          <Text style={s.weekGrassLabel} allowFontScaling={false}>
            {d}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ST9(월) 공부 잔디 — 해당 월 전체 날짜(말일까지)를 한 줄 7칸씩 정사각형으로 미리 그림(GROMO-761).
// 아직 안 온 날짜는 빈 칸(레벨 0)으로 자리만 유지.
function MonthGrassGrid({ cells }: { cells: HeatmapCellResponse[] }) {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const minutesByDate = new Map(cells.map((c) => [c.date, c.totalFocusMinutes]));
  const days = Array.from({ length: lastDay }, (_, i) =>
    localDateStr(new Date(now.getFullYear(), now.getMonth(), i + 1)),
  );
  const rows: string[][] = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
  return (
    <View style={s.monthGrass}>
      {rows.map((row, ri) => (
        <View key={ri} style={s.monthGrassRow}>
          {row.map((date) => (
            <View
              key={date}
              style={[
                s.monthGrassCell,
                { backgroundColor: GRASS[grassLevel(minutesByDate.get(date) ?? 0)] },
              ]}
            />
          ))}
        </View>
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
  teaserFill: { height: 10, borderRadius: 5 },
  teaserFillMine: { width: '86%', backgroundColor: T.accent },
  teaserFillAvg: { width: '62%', backgroundColor: T.compare.avg },
  teaserDotPasser: { backgroundColor: T.compare.theirs },
  // 합격자 레이더 티저 — 라벨은 꼭짓점 바깥 절대 배치
  radarWrap: { alignItems: 'center', paddingVertical: 4 },
  radarCanvas: { width: RADAR_SIZE, height: RADAR_SIZE },
  radarLabel: {
    ...T.text.caption,
    position: 'absolute',
    width: 80,
    textAlign: 'center',
    fontSize: 10,
    color: T.inkSub,
  },
  teaserLegend: { flexDirection: 'row', gap: 14, marginTop: 12 },
  teaserLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  teaserDot: { width: 9, height: 9, borderRadius: 2 },
  teaserLegendText: { ...T.text.caption, fontSize: 11, color: T.inkSub },

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
  // 과목별 도넛 — 링 + 가운데 총합 + 우측 범례
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 },
  donutWrap: {
    width: DONUT_SIZE,
    height: DONUT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutCenter: { position: 'absolute', alignItems: 'center' },
  donutCenterValue: { ...T.text.label, fontWeight: '800', color: T.ink },
  donutCenterLabel: { ...T.text.caption, fontSize: 10, color: T.inkSub, marginTop: 2 },
  donutLegend: { flex: 1, gap: 8 },
  donutLegendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  donutLegendDot: { width: 10, height: 10, borderRadius: 3 },
  donutLegendName: { ...T.text.caption, color: T.ink, flex: 1 },
  donutLegendPct: { ...T.text.caption, fontWeight: '700', color: T.inkSub },
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
  chartAxisBottom: { top: CHART_H - 5 }, // 시각 축(첫 시작 시각) 전용 — 바닥이 0이 아니라 라벨 필요
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
  // 월 탭 잔디 — 해당 월 전체 날짜, 한 줄 7칸(작은 정사각형), 블록 가운데 정렬
  monthGrass: { gap: 6, marginTop: 4, alignSelf: 'center' },
  monthGrassRow: { flexDirection: 'row', gap: 6 },
  monthGrassCell: { width: 24, height: 24, borderRadius: 6 },
  // 주 탭 잔디 한 줄 — 월 탭과 같은 24px 정사각형 + 요일 라벨, 블록 가운데 정렬
  weekGrassRow: { flexDirection: 'row', gap: 6, marginTop: 4, alignSelf: 'center' },
  weekGrassCol: { alignItems: 'center', gap: 4 },
  weekGrassCell: { width: 24, height: 24, borderRadius: 6 },
  weekGrassLabel: { ...T.text.caption, fontSize: 10, color: T.inkMuted },
  grassHint: { ...T.text.caption, color: T.inkMuted, marginTop: 10 },
});
