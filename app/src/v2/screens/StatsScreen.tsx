import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { T } from '@/v2/constants/theme';

// v2 통계 화면 — 홈 '오늘' 카드의 '자세히'에서 진입.
// 오늘 요약(공부/핸드폰) + 주간 추이 막대. 데이터는 placeholder, 실제 연결은 TODO.
// TODO: 주간 데이터(통계/스크린타임 API)로 교체, 기간 선택(주/월) 추가.

type Metric = 'focus' | 'phone';

// 분 → "N시간 M분" / "M분"
function hm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

// 주간 placeholder (분 단위). 마지막 요소가 오늘.
const WEEK = [
  { day: '월', focus: 180, phone: 200 },
  { day: '화', focus: 150, phone: 240 },
  { day: '수', focus: 210, phone: 160 },
  { day: '목', focus: 120, phone: 300 },
  { day: '금', focus: 240, phone: 180 },
  { day: '토', focus: 90, phone: 260 },
  { day: '일', focus: 192, phone: 160 },
];
const TODAY_INDEX = WEEK.length - 1;

const META: Record<
  Metric,
  { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  focus: { label: '공부 집중', color: T.greenDeep, bg: T.greenBg, icon: 'book' },
  phone: { label: '핸드폰 사용', color: T.accent, bg: T.accentBg, icon: 'phone-portrait-outline' },
};

const CHART_HEIGHT = 132;

export default function StatsScreen() {
  const navigation = useNavigation();
  const [metric, setMetric] = useState<Metric>('focus');

  const values = WEEK.map((d) => d[metric]);
  const max = Math.max(...values, 1);
  const total = values.reduce((a, b) => a + b, 0);
  const avg = Math.round(total / WEEK.length);
  const meta = META[metric];

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

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* ── 오늘 요약 ── */}
        <Text style={s.sectionTitle}>오늘</Text>
        <View style={s.todayRow}>
          {(['focus', 'phone'] as Metric[]).map((k) => {
            const m = META[k];
            return (
              <View key={k} style={s.todayCard}>
                <View style={[s.todayIcon, { backgroundColor: m.bg }]}>
                  <Ionicons name={m.icon} size={18} color={m.color} />
                </View>
                <Text style={s.todayLabel}>{m.label}</Text>
                <Text style={s.todayValue}>{hm(WEEK[TODAY_INDEX][k])}</Text>
              </View>
            );
          })}
        </View>

        {/* ── 주간 추이 ── */}
        <View style={s.chartCard}>
          <View style={s.segment}>
            {(['focus', 'phone'] as Metric[]).map((k) => {
              const on = metric === k;
              return (
                <TouchableOpacity
                  key={k}
                  style={[s.segBtn, on ? s.segBtnOn : null]}
                  onPress={() => setMetric(k)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.segText, on ? s.segTextOn : null]}>{META[k].label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={s.chart}>
            {WEEK.map((d, i) => {
              const isToday = i === TODAY_INDEX;
              const h = Math.max((d[metric] / max) * CHART_HEIGHT, 4);
              return (
                <View key={d.day} style={s.barCol}>
                  <View style={s.barTrack}>
                    <View
                      style={[
                        s.bar,
                        { height: h, backgroundColor: meta.color, opacity: isToday ? 1 : 0.32 },
                      ]}
                    />
                  </View>
                  <Text
                    style={[s.barDay, isToday ? { color: meta.color, fontWeight: '800' } : null]}
                  >
                    {d.day}
                  </Text>
                </View>
              );
            })}
          </View>

          <View style={s.summary}>
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel}>주간 합계</Text>
              <Text style={s.summaryValue}>{hm(total)}</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryItem}>
              <Text style={s.summaryLabel}>일 평균</Text>
              <Text style={s.summaryValue}>{hm(avg)}</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
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

  scroll: { paddingHorizontal: 18, paddingBottom: 40 },
  sectionTitle: { ...T.text.label, color: T.inkSub, marginTop: 6, marginBottom: 10 },

  // 오늘 요약 카드 2개
  todayRow: { flexDirection: 'row', gap: 12 },
  todayCard: {
    flex: 1,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
  },
  todayIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayLabel: { ...T.text.caption, color: T.inkMuted },
  todayValue: { ...T.text.heading, color: T.ink },

  // 주간 차트 카드
  chartCard: {
    marginTop: 16,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: T.sandLight,
    borderRadius: 12,
    padding: 3,
    marginBottom: 18,
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

  chart: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT + 26, gap: 6 },
  barCol: { flex: 1, alignItems: 'center', gap: 8 },
  barTrack: { height: CHART_HEIGHT, justifyContent: 'flex-end' },
  bar: { width: 18, borderRadius: 6 },
  barDay: { ...T.text.caption, color: T.inkMuted },

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: T.divider,
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 4 },
  summaryDivider: { width: 1, height: 28, backgroundColor: T.divider },
  summaryLabel: { ...T.text.caption, color: T.inkMuted },
  summaryValue: { ...T.text.subtitle, color: T.ink },
});
