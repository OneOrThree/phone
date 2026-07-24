// ST3 합격자 비교 티저 — 과목별 나 vs 합격자 평균 레이더 차트(표시용 고정값,
// ComingSoon 블러 아래에 깔림).
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Polygon } from 'react-native-svg';
import { T } from '@/constants/theme';

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

export function PasserCompareChart() {
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

const s = StyleSheet.create({
  // 합격자 레이더 티저 — 라벨은 꼭짓점 바깥 절대 배치
  radarWrap: { alignItems: 'center', paddingVertical: T.space.xs },
  radarCanvas: { width: RADAR_SIZE, height: RADAR_SIZE },
  radarLabel: {
    ...T.text.caption,
    position: 'absolute',
    width: 80,
    textAlign: 'center',
    fontSize: 10,
    color: T.inkSub,
  },
  teaserLegend: { flexDirection: 'row', gap: T.space.lg, marginTop: T.space.md },
  teaserLegendItem: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  teaserDot: { width: 9, height: 9, borderRadius: 2 },
  teaserDotPasser: { backgroundColor: T.compare.theirs },
  teaserLegendText: { ...T.text.caption, fontSize: 11, color: T.inkSub },
});
