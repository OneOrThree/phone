import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { T } from '@/constants/theme';
import type { SubjectCompare } from '../mock';
import type { StatsPeriod } from '@/types/dto/stats';
import { fmtHm } from '@/utils/timeFormat';

// 과목별 공부량 비교 카드 — 프로필 상세(친구·과목 겹침)의 나/상대 가로 바.
// 바 폭은 카드 안 전체 값의 최대치 기준 정규화. 상대는 시안 보라(빗금 패턴 대신 단색).
// GROMO-692: 오늘/이번주/이번달 기간 탭 — 같은 개념의 리터럴 중복 선언 대신 서버 기간 타입
// (StatsPeriod)을 그대로 쓴다(PR 252 리뷰). 겹치는 과목이 없는 기간은 카드 안 빈 상태로
// 안내해 탭 전환이 막히지 않게 한다.
// soloMine(GROMO-940): 내 프로필 — 나:나 비교는 무의미해 상대 바·범례를 생략하고 내 바만.

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: 'DAY', label: '오늘' },
  { key: 'WEEK', label: '이번 주' },
  { key: 'MONTH', label: '이번 달' },
];

interface Props {
  subjects: SubjectCompare[];
  opponentName: string;
  period: StatsPeriod;
  onPeriodChange: (period: StatsPeriod) => void;
  soloMine?: boolean;
}

// 시안 상대(보라) 바 색 — 테마 팔레트 밖 시안 고유색
const THEIRS = T.compare.theirs;

export function SubjectCompareCard({
  subjects,
  opponentName,
  period,
  onPeriodChange,
  soloMine,
}: Props) {
  const max = Math.max(
    ...subjects.flatMap((v) => (soloMine ? [v.myMinutes] : [v.myMinutes, v.theirMinutes])),
    1,
  );
  return (
    <View style={s.card}>
      <View style={s.headRow}>
        <Text style={s.title}>{soloMine ? '과목별 공부량' : '과목별 공부량 비교'}</Text>
        <View style={s.tabRow}>
          {PERIODS.map(({ key, label }) => {
            const on = period === key;
            return (
              <TouchableOpacity
                key={key}
                style={[s.tabChip, on ? s.tabChipOn : null]}
                onPress={() => onPeriodChange(key)}
                activeOpacity={0.8}
              >
                <Text style={[s.tabChipText, on ? s.tabChipTextOn : null]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {subjects.length === 0 ? (
        <Text style={s.emptyText}>
          {soloMine
            ? '이 기간엔 공부 기록이 없어요. 다른 기간을 골라보세요.'
            : '이 기간엔 겹치는 공부 과목이 없어요. 다른 기간을 골라보세요.'}
        </Text>
      ) : (
        subjects.map((subj) => {
          const minePct = (subj.myMinutes / max) * 100;
          const theirsPct = (subj.theirMinutes / max) * 100;
          return (
            <View key={subj.name} style={s.block}>
              <Text style={s.subject}>{subj.name}</Text>
              <View style={s.barRow}>
                <Text style={[s.barWho, s.barWhoMine]} allowFontScaling={false}>
                  나
                </Text>
                <View style={s.track}>
                  <LinearGradient
                    colors={[T.accentLight, T.accent]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[s.fill, { width: `${minePct}%` }]}
                  />
                </View>
                <Text style={s.barVal} allowFontScaling={false}>
                  {fmtHm(subj.myMinutes)}
                </Text>
              </View>
              {!soloMine && (
                <View style={s.barRow}>
                  <Text style={[s.barWho, s.barWhoTheirs]} allowFontScaling={false}>
                    상대
                  </Text>
                  <View style={s.track}>
                    <View style={[s.fill, s.fillTheirs, { width: `${theirsPct}%` }]} />
                  </View>
                  <Text style={[s.barVal, s.barValTheirs]} allowFontScaling={false}>
                    {fmtHm(subj.theirMinutes)}
                  </Text>
                </View>
              )}
            </View>
          );
        })
      )}

      {subjects.length > 0 && !soloMine ? (
        <View style={s.legendRow}>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: T.accent }]} />
            <Text style={s.legendText}>나</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: THEIRS }]} />
            <Text style={s.legendText} numberOfLines={1}>
              {opponentName}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    padding: T.space.lg,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: T.space.lg,
  },
  title: { ...T.text.label, fontWeight: '700', color: T.ink },
  // 기간 탭(GROMO-692) — 집중 결과 비교 카드의 축 칩과 동일 패턴
  tabRow: { flexDirection: 'row', gap: T.space.sm },
  tabChip: {
    paddingHorizontal: T.space.md,
    paddingVertical: T.space.xs,
    borderRadius: 999,
    backgroundColor: T.chipBg,
    borderWidth: 1,
    borderColor: T.chipBorder,
  },
  tabChipOn: { backgroundColor: T.accent, borderColor: T.accent },
  tabChipText: { ...T.text.caption, fontSize: 11, color: T.inkSub },
  tabChipTextOn: { color: T.white, fontWeight: '700' },

  emptyText: { ...T.text.caption, color: T.inkSub, paddingVertical: T.space.sm },

  block: { marginBottom: T.space.md },
  subject: { ...T.text.caption, fontWeight: '700', color: T.ink, marginBottom: T.space.sm },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm, marginBottom: T.space.xs },
  barWho: { ...T.text.caption, fontSize: 11, width: 28 },
  barWhoMine: { color: T.accent },
  barWhoTheirs: { color: THEIRS },
  track: { flex: 1, height: 10, borderRadius: 5, backgroundColor: T.track },
  fill: { height: 10, borderRadius: 5 },
  fillTheirs: { backgroundColor: THEIRS },
  barVal: {
    ...T.text.caption,
    fontSize: 11,
    fontWeight: '800',
    color: T.ink,
    width: 46,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  barValTheirs: { color: T.link },

  legendRow: { flexDirection: 'row', gap: T.space.lg, marginTop: T.space.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  legendDot: { width: 9, height: 9, borderRadius: 2 },
  legendText: { ...T.text.caption, fontSize: 11, color: T.inkSub, maxWidth: 120 },
});
