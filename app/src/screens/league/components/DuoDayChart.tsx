import { StyleSheet, Text, View } from 'react-native';
import { T } from '@/constants/theme';
import { axisCeil, fmtAxis } from '@/utils/timeFormat';
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
  const axisMax = axisCeil(Math.max(...data.mine, ...data.theirs, 1));
  const h = (v: number) => Math.max((v / axisMax) * AREA_H, 3);
  return (
    <View style={s.card}>
      <Text style={s.title}>{title}</Text>
      <Text style={s.sub}>나와 비교</Text>

      <View style={s.plotRow}>
        {/* 세로축 — 상한·절반 눈금 라벨 (그리드라인 높이에 맞춰 절대 배치) */}
        <View style={s.axisCol}>
          <Text style={[s.axisLabel, s.axisTop]} allowFontScaling={false}>
            {fmtAxis(axisMax)}
          </Text>
          <Text style={[s.axisLabel, s.axisMid]} allowFontScaling={false}>
            {fmtAxis(axisMax / 2)}
          </Text>
        </View>

        <View style={s.plot}>
          <View style={[s.gridLine, s.gridTop]} />
          <View style={[s.gridLine, s.gridMid]} />
          <View style={[s.gridLine, s.gridBottom]} />
          <View style={s.chartRow}>
            {DAYS.map((d, i) => (
              <View key={d} style={s.dayCol}>
                <View style={s.barsRow}>
                  <View
                    style={[s.bar, { height: h(data.mine[i] ?? 0), backgroundColor: mineColor }]}
                  />
                  <View
                    style={[
                      s.bar,
                      { height: h(data.theirs[i] ?? 0), backgroundColor: theirsColor },
                    ]}
                  />
                </View>
                <Text style={s.dayLabel} allowFontScaling={false}>
                  {d}
                </Text>
              </View>
            ))}
          </View>
        </View>
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
    padding: T.space.lg,
  },
  title: { ...T.text.label, fontWeight: '700', color: T.ink, marginBottom: T.space.xs },
  sub: { ...T.text.caption, color: T.inkSub, marginBottom: T.space.md },

  plotRow: { flexDirection: 'row' },
  axisCol: { width: 36, height: AREA_H },
  axisLabel: {
    ...T.text.caption,
    position: 'absolute',
    right: 6,
    fontSize: 9,
    color: T.inkMuted,
  },
  axisTop: { top: -5 },
  axisMid: { top: AREA_H / 2 - 5 },
  plot: { flex: 1 },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: T.paperAlt,
  },
  gridTop: { top: 0 },
  gridMid: { top: AREA_H / 2 },
  gridBottom: { top: AREA_H },
  chartRow: { flexDirection: 'row', gap: T.space.sm },
  dayCol: { flex: 1, alignItems: 'center', gap: T.space.xs },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: AREA_H,
  },
  bar: { width: 6, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  dayLabel: { ...T.text.caption, fontSize: 11, color: T.inkSub },

  legendRow: { flexDirection: 'row', gap: T.space.lg, marginTop: T.space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  legendDot: { width: 9, height: 9, borderRadius: 2 },
  legendText: { ...T.text.caption, fontSize: 11, color: T.inkSub, maxWidth: 120 },
});
