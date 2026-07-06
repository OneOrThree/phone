import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/constants/theme';
import type { StatsPeriod, HeatmapCellResponse } from '@/types/dto/stats';
import {
  logStatsViewed,
  logStatsPeriodChanged,
  logStatsTagFilterSelected,
} from '@/services/analyticsEvents';
import { useStatsData } from './stats/useStatsData';
import {
  hm,
  PERIOD_TABS,
  periodLabel,
  prevLabel,
  periodKey,
  heatmapBars,
  focusGoalRate,
  grassLevel,
  type StatBar,
} from './stats/format';

// v2 내 통계 화면(GROMO-604) — 홈 '오늘' 카드의 '자세히'에서 진입.
// 상단 고정 필터(기간 일/주/월 + 과목) 아래로 ST1~ST9 지표 스크롤.
// 실데이터: 집중시간·폰사용·전대비·목표달성·잔디·총공부량(나)·과목별(나).
// 준비 중: 비교(친구/전체/같은 카테고리)·합격자·주별 누적 — 소스 미비로 스텁.

const CHART_H = 120;
// 잔디 강도 0..4 색(빈 칸 → 진한 초록).
const GRASS = ['#ECE2D1', '#DCE8CE', '#B9D3A0', '#8FB86F', T.greenDeep];
const FOCUS_COLOR = T.greenDeep;
const PHONE_COLOR = T.accent;

type TagFilter = 'ALL' | string; // 'ALL' | tagId

export default function StatsScreen() {
  const navigation = useNavigation();
  const [period, setPeriod] = useState<StatsPeriod>('WEEK');
  const [tag, setTag] = useState<TagFilter>('ALL');
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

  const onTag = (id: TagFilter) => {
    if (id === tag) return;
    setTag(id);
    logStatsTagFilterSelected({ is_all: id === 'ALL' });
  };

  const firstLoad = loading && data.focus === null && data.heatmap.length === 0;

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

      {/* ── 고정 필터: 기간 + 과목 ── */}
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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tagRow}
        >
          <TagChip label="전체" on={tag === 'ALL'} onPress={() => onTag('ALL')} />
          {data.tags.map((t) => (
            <TagChip
              key={t.tagId}
              label={t.name}
              on={tag === t.tagId}
              onPress={() => onTag(t.tagId)}
            />
          ))}
        </ScrollView>
      </View>

      {firstLoad ? (
        <View style={s.loader}>
          <ActivityIndicator color={T.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {/* ST1 총 공부량 (나) + 비교 준비중 */}
          <SectionCard title="총 공부량" caption={periodLabel(period)}>
            <Text style={s.bigStat}>{hm(data.focus?.totalFocusMinutes ?? 0)}</Text>
            <CompareStub />
          </SectionCard>

          {/* ST2 과목별 공부량 (나) */}
          <SectionCard title="과목별 공부량" caption={periodLabel(period)}>
            <CategoryBars
              items={data.category?.items ?? []}
              total={data.category?.totalFocusMinutes ?? 0}
              selectedTag={tag}
            />
          </SectionCard>

          {/* ST3 합격자 비교 (준비 중) */}
          <StubCard title="합격자와 비교" note="합격자 데이터 준비 중이에요" />

          {/* ST4 주별 누적 공부 비율 (준비 중) */}
          <StubCard title="주별 누적 공부 비율" note="준비 중이에요" />

          {/* ST5 포커스 집중시간 */}
          <SectionCard title="포커스 집중시간" caption={periodLabel(period)}>
            <Text style={[s.bigStat, { color: FOCUS_COLOR }]}>
              {hm(data.focus?.totalFocusMinutes ?? 0)}
            </Text>
            <BarChart
              bars={heatmapBars(period, data.heatmap, (c) => c.totalFocusMinutes)}
              color={FOCUS_COLOR}
            />
          </SectionCard>

          {/* ST6 폰 사용량 */}
          <SectionCard title="폰 사용량" caption="집중 시간과 대비돼요">
            <Text style={[s.bigStat, { color: PHONE_COLOR }]}>
              {hm(data.screenTime?.currentMinutes ?? 0)}
            </Text>
            <BarChart
              bars={heatmapBars(period, data.heatmap, (c) => c.actualScreenTimeMinutes)}
              color={PHONE_COLOR}
            />
          </SectionCard>

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

          {/* ST9 공부 잔디 (Streak) */}
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
            <Text style={s.grassHint}>공부시간이 많은 날일수록 칸이 진해져요</Text>
          </SectionCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── 서브 컴포넌트 ──

function TagChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[s.chip, on ? s.chipOn : null]} onPress={onPress} activeOpacity={0.8}>
      <Text style={[s.chipText, on ? s.chipTextOn : null]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

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

function StubCard({ title, note }: { title: string; note: string }) {
  return (
    <View style={[s.card, s.stubCard]}>
      <Text style={s.cardTitle}>{title}</Text>
      <View style={s.stubBadge}>
        <Text style={s.stubBadgeText}>준비 중</Text>
      </View>
      <Text style={s.stubNote}>{note}</Text>
    </View>
  );
}

// ST1 비교 자리 — 소스(친구/전체/같은 카테고리) 붙기 전까지 셀렉터만 노출.
function CompareStub() {
  return (
    <View style={s.compare}>
      <View style={s.compareChips}>
        {['친구', '전체', '같은 카테고리'].map((c) => (
          <View key={c} style={s.compareChip}>
            <Text style={s.compareChipText}>{c}</Text>
          </View>
        ))}
      </View>
      <Text style={s.compareNote}>비교 준비 중이에요</Text>
    </View>
  );
}

function BarChart({ bars, color }: { bars: StatBar[]; color: string }) {
  if (bars.length === 0) {
    return <Text style={s.emptyText}>아직 기록이 없어요</Text>;
  }
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <View style={s.chart}>
      {bars.map((b, i) => {
        const h = Math.max((b.value / max) * CHART_H, 3);
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
  );
}

function CategoryBars({
  items,
  total,
  selectedTag,
}: {
  items: { tagId: string | null; tagName: string | null; totalFocusMinutes: number }[];
  total: number;
  selectedTag: TagFilter;
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
        const active = selectedTag === 'ALL' || selectedTag === it.tagId;
        return (
          <View key={it.tagId ?? `untagged-${i}`} style={[s.catRow, active ? null : s.catRowDim]}>
            <View style={s.catHead}>
              <Text style={s.catName} numberOfLines={1}>
                {it.tagName ?? '미분류'}
              </Text>
              <Text style={s.catValue}>{hm(it.totalFocusMinutes)}</Text>
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
        <Text style={s.deltaMin}>{flat ? '변화 없어요' : `${hm(Math.abs(delta))}`}</Text>
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
          목표 {hm(f?.goalMinutes ?? 0)} 중 {hm(f?.todayMinutes ?? 0)} {achieved ? '달성 ✓' : ''}
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

  tagRow: { flexDirection: 'row', gap: 8, paddingRight: 18 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: T.chipBg,
    borderWidth: 1,
    borderColor: T.chipBorder,
  },
  chipOn: { backgroundColor: T.accent, borderColor: T.accent },
  chipText: { ...T.text.caption, color: T.inkSub, maxWidth: 120 },
  chipTextOn: { color: T.white },

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
  compareChips: { flexDirection: 'row', gap: 8 },
  compareChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: T.sandLight,
  },
  compareChipText: { ...T.text.caption, color: T.inkMuted },
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
  chart: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 14, gap: 6 },
  barCol: { flex: 1, alignItems: 'center', gap: 8 },
  barTrack: { height: CHART_H, justifyContent: 'flex-end' },
  bar: { width: 16, borderRadius: 6 },
  barLabel: { ...T.text.caption, color: T.inkMuted },

  // 과목별 비율 바
  catList: { gap: 12 },
  catRow: { gap: 6 },
  catRowDim: { opacity: 0.4 },
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
