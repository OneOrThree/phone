// ST2(주·월) 과목별 공부량 도넛 — 과목별 비중을 링 구간(strokeDasharray)으로 그리고 가운데에 총합,
// 우측 범례에 과목·비중을 표시(GROMO-761). 색은 CategoryBars와 동일하게 팔레트 순서 배정.
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { T } from '@/constants/theme';
import { fmtHm } from '@/utils/timeFormat';
import { FOCUS_COLOR } from './constants';
import { cs } from './cardStyles';

const DONUT_SIZE = 132;
const DONUT_STROKE = 20;

export function CategoryDonut({
  items,
  total,
}: {
  items: { tagId: string | null; tagName: string | null; totalFocusMinutes: number }[];
  total: number;
}) {
  if (items.length === 0) {
    return <Text style={cs.emptyText}>아직 기록이 없어요</Text>;
  }
  const denom = total || 1;
  const half = DONUT_SIZE / 2;
  const r = (DONUT_SIZE - DONUT_STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  let acc = 0;
  const segs = items.map((it, i) => {
    const seg = {
      frac: it.totalFocusMinutes / denom,
      minutes: it.totalFocusMinutes,
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
            {fmtHm(total)}
          </Text>
          <Text style={s.donutCenterLabel}>총 집중</Text>
        </View>
      </View>
      <View style={s.donutLegend}>
        {segs.map((sg, i) => (
          <View key={i} style={s.donutLegendRow}>
            <View style={[s.donutLegendDot, { backgroundColor: sg.color }]} />
            <Text style={s.donutLegendName} numberOfLines={1}>
              {sg.name}
            </Text>
            <Text style={s.donutLegendTime} allowFontScaling={false}>
              {fmtHm(sg.minutes)}
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

const s = StyleSheet.create({
  // 과목별 도넛 — 링 + 가운데 총합 + 우측 범례
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.lg, marginTop: T.space.sm },
  donutWrap: {
    width: DONUT_SIZE,
    height: DONUT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutCenter: { position: 'absolute', alignItems: 'center' },
  // 도넛 중앙 총합 — 카드의 대표 숫자라 캡션급(label)이 아닌 히어로급으로(GROMO-849)
  donutCenterValue: { ...T.text.subtitle, fontWeight: '800', color: FOCUS_COLOR },
  donutCenterLabel: { ...T.text.caption, fontSize: 10, color: T.inkSub, marginTop: 2 },
  donutLegend: { flex: 1, gap: T.space.sm },
  donutLegendRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  donutLegendDot: { width: 10, height: 10, borderRadius: 3 },
  donutLegendName: { ...T.text.caption, color: T.ink, flex: 1 },
  donutLegendTime: { ...T.text.caption, color: T.inkSub, fontVariant: ['tabular-nums'] },
  donutLegendPct: { ...T.text.caption, fontWeight: '700', color: T.inkSub },
});
