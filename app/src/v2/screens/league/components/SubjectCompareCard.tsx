import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { T } from '@/constants/theme';
import type { SubjectCompare } from '../mock';
import { fmtHourMin } from '../format';

// 과목별 공부량 비교 카드 — 프로필 상세(친구·과목 겹침)의 나/상대 가로 바.
// 바 폭은 카드 안 전체 값의 최대치 기준 정규화. 상대는 시안 보라(빗금 패턴 대신 단색).

interface Props {
  subjects: SubjectCompare[];
  opponentName: string;
}

// 시안 상대(보라) 바 색 — 테마 팔레트 밖 시안 고유색
const THEIRS = '#9A6FB0';

export function SubjectCompareCard({ subjects, opponentName }: Props) {
  const max = Math.max(...subjects.flatMap((v) => [v.myMinutes, v.theirMinutes]), 1);
  return (
    <View style={s.card}>
      <View style={s.headRow}>
        <Text style={s.title}>과목별 공부량 비교</Text>
        <Text style={s.period}>이번 주</Text>
      </View>

      {subjects.map((subj) => {
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
                  colors={['#D9A24C', T.accent]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[s.fill, { width: `${minePct}%` }]}
                />
              </View>
              <Text style={s.barVal} allowFontScaling={false}>
                {fmtHourMin(subj.myMinutes)}
              </Text>
            </View>
            <View style={s.barRow}>
              <Text style={[s.barWho, s.barWhoTheirs]} allowFontScaling={false}>
                상대
              </Text>
              <View style={s.track}>
                <View style={[s.fill, s.fillTheirs, { width: `${theirsPct}%` }]} />
              </View>
              <Text style={[s.barVal, s.barValTheirs]} allowFontScaling={false}>
                {fmtHourMin(subj.theirMinutes)}
              </Text>
            </View>
          </View>
        );
      })}

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
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    padding: 16,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: { ...T.text.label, fontWeight: '700', color: T.ink },
  period: { ...T.text.caption, color: T.inkSub },

  block: { marginBottom: 13 },
  subject: { ...T.text.caption, fontWeight: '700', color: T.ink, marginBottom: 6 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  barWho: { ...T.text.caption, fontSize: 11, width: 28 },
  barWhoMine: { color: T.accent },
  barWhoTheirs: { color: THEIRS },
  track: { flex: 1, height: 10, borderRadius: 5, backgroundColor: '#EFE7D8' },
  fill: { height: 10, borderRadius: 5 },
  fillTheirs: { backgroundColor: THEIRS },
  barVal: {
    ...T.text.caption,
    fontSize: 11,
    fontWeight: '800',
    color: T.ink,
    width: 52,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  barValTheirs: { color: T.link },

  legendRow: { flexDirection: 'row', gap: 14, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 2 },
  legendText: { ...T.text.caption, fontSize: 11, color: T.inkSub, maxWidth: 120 },
});
