import { StyleSheet, Text, View } from 'react-native';
import { T } from '@/constants/theme';
import type { CompareByDay } from '../mock';

// 요일별 나/상대 이중 막대 카드 — 프로필 상세의 집중시간·폰 사용시간 비교 공용(색만 교체).
// 높이는 두 시리즈 합친 최대치 기준 정규화, 0이어도 최소 3pt 스텁을 남긴다.

interface Props {
  title: string;
  data: CompareByDay;
  mineColor: string;
  theirsColor: string;
  opponentName: string;
}

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
// 막대 영역 높이(시안 72px)
const AREA_H = 72;

export function DuoDayChart({ title, data, mineColor, theirsColor, opponentName }: Props) {
  const max = Math.max(...data.mine, ...data.theirs, 1);
  const h = (v: number) => Math.max((v / max) * AREA_H, 3);
  return (
    <View style={s.card}>
      <Text style={s.title}>{title}</Text>
      <Text style={s.sub}>나와 비교</Text>

      <View style={s.chartRow}>
        {DAYS.map((d, i) => (
          <View key={d} style={s.dayCol}>
            <View style={s.barsRow}>
              <View style={[s.bar, { height: h(data.mine[i] ?? 0), backgroundColor: mineColor }]} />
              <View
                style={[s.bar, { height: h(data.theirs[i] ?? 0), backgroundColor: theirsColor }]}
              />
            </View>
            <Text style={s.dayLabel} allowFontScaling={false}>
              {d}
            </Text>
          </View>
        ))}
      </View>

      <View style={s.legendRow}>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: mineColor }]} />
          <Text style={s.legendText}>나</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: theirsColor }]} />
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
  title: { ...T.text.label, fontWeight: '700', color: T.ink, marginBottom: 4 },
  sub: { ...T.text.caption, color: T.inkSub, marginBottom: 12 },

  chartRow: { flexDirection: 'row', gap: 6 },
  dayCol: { flex: 1, alignItems: 'center', gap: 5 },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: AREA_H,
  },
  bar: { width: 6, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  dayLabel: { ...T.text.caption, fontSize: 11, color: T.inkSub },

  legendRow: { flexDirection: 'row', gap: 14, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 2 },
  legendText: { ...T.text.caption, fontSize: 11, color: T.inkSub, maxWidth: 120 },
});
