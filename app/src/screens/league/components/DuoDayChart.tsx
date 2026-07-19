import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { T } from '@/constants/theme';
import { axisCeil, fmtAxis } from '@/utils/timeFormat';
import type { CompareByDay } from '../mock';

// 요일별 나/상대 비교 카드 — 프로필 상세의 집중시간·폰 사용시간 비교 공용(색만 교체).
// 이중 막대 → 두 선그래프(GROMO-849): 시리즈당 폴리라인+점(통계 LineChart와 동일 기법).
// 아직 안 온 요일은 라벨만 남기고 선·점에서 제외 — 0으로 이으면 급락처럼 보인다.

interface Props {
  title: string;
  data: CompareByDay;
  mineColor: string;
  theirsColor: string;
  opponentName: string;
}

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
// 플롯 영역 높이(시안 72px)
const AREA_H = 72;
const DOT_PAD = 6; // 점(r 3)이 캔버스 경계에서 잘리지 않게 사방 여유

export function DuoDayChart({ title, data, mineColor, theirsColor, opponentName }: Props) {
  const [plotW, setPlotW] = useState(0);
  const axisMax = axisCeil(Math.max(...data.mine, ...data.theirs, 1));
  // 이번 주(월~일) 고정이라 오늘 요일까지만 점을 찍는다(월=0)
  const todayIdx = (new Date().getDay() + 6) % 7;
  const step = plotW / DAYS.length;
  const pts = (series: number[]) =>
    DAYS.slice(0, todayIdx + 1).map((_, i) => ({
      x: step * (i + 0.5) + DOT_PAD,
      y: AREA_H - ((series[i] ?? 0) / axisMax) * AREA_H + DOT_PAD,
    }));
  const mine = pts(data.mine);
  const theirs = pts(data.theirs);
  const line = (p: { x: number; y: number }[]) => p.map((q) => `${q.x},${q.y}`).join(' ');
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

        <View style={s.plot} onLayout={(e) => setPlotW(e.nativeEvent.layout.width)}>
          <View style={[s.gridLine, s.gridTop]} />
          <View style={[s.gridLine, s.gridMid]} />
          <View style={[s.gridLine, s.gridBottom]} />
          {plotW > 0 && (
            // 캔버스를 점 반지름만큼 사방으로 키우고 음수 마진으로 되돌림 — 상단(최댓값)·바닥(0)의
            // 점이 캔버스 경계에서 잘리지 않게 (SVG는 자기 영역 밖을 클리핑)
            <Svg width={plotW + DOT_PAD * 2} height={AREA_H + DOT_PAD * 2} style={s.lineSvg}>
              {/* 상대 선을 먼저 그려 내 선이 겹침에서 위로 오게 */}
              <Polyline points={line(theirs)} fill="none" stroke={theirsColor} strokeWidth={2} />
              <Polyline points={line(mine)} fill="none" stroke={mineColor} strokeWidth={2} />
              {theirs.map((p, i) => (
                <Circle key={`t${i}`} cx={p.x} cy={p.y} r={3} fill={theirsColor} />
              ))}
              {mine.map((p, i) => (
                <Circle key={`m${i}`} cx={p.x} cy={p.y} r={3} fill={mineColor} />
              ))}
            </Svg>
          )}
          <View style={s.dayLabelRow}>
            {DAYS.map((d, i) => (
              <Text
                key={d}
                style={[s.dayLabel, i === todayIdx ? s.dayLabelCur : null]}
                allowFontScaling={false}
              >
                {d}
              </Text>
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
  // 확장 캔버스를 음수 마진으로 되돌려 레이아웃(격자 정렬)은 그대로 유지
  lineSvg: {
    marginTop: -DOT_PAD,
    marginBottom: -DOT_PAD,
    marginLeft: -DOT_PAD,
    marginRight: -DOT_PAD,
  },
  // 요일 라벨 — 점 x좌표(칼럼 중앙)와 정렬되도록 균등 분할
  dayLabelRow: { flexDirection: 'row', marginTop: T.space.sm },
  dayLabel: { ...T.text.caption, fontSize: 11, color: T.inkSub, flex: 1, textAlign: 'center' },
  dayLabelCur: { fontWeight: '800', color: T.ink },

  legendRow: { flexDirection: 'row', gap: T.space.lg, marginTop: T.space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  legendDot: { width: 9, height: 9, borderRadius: 2 },
  legendText: { ...T.text.caption, fontSize: 11, color: T.inkSub, maxWidth: 120 },
});
