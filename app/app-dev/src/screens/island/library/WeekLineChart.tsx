import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { T } from '@/screens/island/sceneKit';
import { weekday } from './diaryData';

const D = componentTokens.diary;
const C = semanticTokens.color;
const S = semanticTokens.spacing;
const F = semanticTokens.typography;

// viewBox 폭은 §7.13 Graph 와 같은 362. 오른쪽 여백은 시간 눈금 글자 자리다
const VW = 362;
const PAD_L = 8;
const PAD_R = 30;
const PAD_TOP = 10;
const PLOT_W = VW - PAD_L - PAD_R;
const CHART_H = PAD_TOP + D.chartHeight + 8;

type Hours = Map<string, number | null>;

/**
 * 이웃 일기장의 주간 선그래프(GROMO-2488) — 월~일 7칸에 집중(Pink)·폰 사용(Graph Line) 두 선을 겹친다.
 * 미래 날짜와 측정이 없는 날은 점·선을 두지 않고, 선은 값이 이어진 구간마다 끊어 그린다.
 * 세로 격자는 0·절반·최대(최대는 5시간 이상의 정수 시간) 셋이다.
 */
export function WeekLineChart({
  days,
  today,
  focus,
  usage,
  usageAllowed,
}: {
  days: string[];
  today: string;
  /** 날짜 → 집중 초. 지난 날인데 값이 없으면 0 으로 본다 */
  focus: Map<string, number>;
  /** 날짜 → 폰 사용 분. null 은 미측정 */
  usage: Map<string, number | null>;
  usageAllowed: boolean;
}) {
  const focusHours: Hours = new Map(
    days.map((d) => [d, d <= today ? (focus.get(d) ?? 0) / 3600 : null]),
  );
  const usageHours: Hours = new Map(
    days.map((d) => {
      const minutes = usage.get(d);
      return [d, d <= today && usageAllowed && minutes != null ? minutes / 60 : null];
    }),
  );
  const values = [...focusHours.values(), ...usageHours.values()].filter(
    (v): v is number => v != null,
  );
  const top = Math.max(5, Math.ceil(Math.max(0, ...values)));
  // 점은 칸 가운데 — 아래 요일 글자 줄(flex 7칸)과 같은 자리다
  const x = (i: number) => PAD_L + ((i + 0.5) * PLOT_W) / days.length;
  const y = (hours: number) => PAD_TOP + (1 - hours / top) * D.chartHeight;
  const series = [
    { key: 'focus', label: '집중', color: C.primary, hours: focusHours },
    { key: 'usage', label: '폰 사용', color: primitiveTokens.color.graphLine, hours: usageHours },
  ];
  const segments = (hours: Hours) => {
    const out: string[][] = [];
    let current: string[] = [];
    days.forEach((d, i) => {
      const h = hours.get(d);
      if (h == null) {
        if (current.length) out.push(current);
        current = [];
      } else current.push(`${x(i)},${y(h)}`);
    });
    if (current.length) out.push(current);
    return out;
  };
  const minutes = (hours: number | null | undefined) =>
    hours == null ? null : Math.round(hours * 60);
  const summary = days
    .map((d) => {
      const f = minutes(focusHours.get(d));
      const u = minutes(usageHours.get(d));
      return `${weekday(d)} ${f == null ? '기록 없음' : `집중 ${f}분`}${u == null ? '' : ` 폰 사용 ${u}분`}`;
    })
    .join(', ');
  return (
    <View
      style={styles.wrap}
      testID="diary-week-chart"
      accessible
      accessibilityLabel={`주간 그래프. ${summary}`}
    >
      <View style={styles.legend}>
        {series.map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: s.color }]} />
            <T style={styles.legendText}>{s.label}</T>
          </View>
        ))}
      </View>
      {/* 높이를 고정하지 않고 viewBox 비율로 두어 폭이 362 를 넘어도(태블릿·가로) x·y 가 같이 커진다 — 아래 요일 줄의 % 여백과 늘 맞는다 */}
      <View style={styles.plot}>
        <Svg width="100%" style={styles.svg} viewBox={`0 0 ${VW} ${CHART_H}`}>
          {[0, top / 2, top].map((h) => (
            <Line
              key={h}
              x1={PAD_L}
              x2={VW - PAD_R}
              y1={y(h)}
              y2={y(h)}
              stroke={`${C.outline}22`}
            />
          ))}
          {series.map((s) =>
            segments(s.hours).map((points, k) =>
              points.length > 1 ? (
                <Polyline
                  key={`${s.key}-${k}`}
                  points={points.join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2.5}
                />
              ) : null,
            ),
          )}
          {series.map((s) =>
            days.map((d, i) => {
              const h = s.hours.get(d);
              return h == null ? null : (
                <Circle
                  key={`${s.key}-${d}`}
                  cx={x(i)}
                  cy={y(h)}
                  r={3.5}
                  fill={C.surface}
                  stroke={s.color}
                  strokeWidth={1.5}
                />
              );
            }),
          )}
        </Svg>
        {/* 시간 눈금은 SVG 글자가 아니라 공용 T — 기기 글자 크기를 따른다. 격자 선 높이(%)에 맞춰 띄운다 */}
        <View style={styles.ticks} pointerEvents="none">
          {[0, top / 2, top].map((h) => (
            <T
              key={h}
              style={[styles.tick, { top: `${(y(h) / CHART_H) * 100}%` }]}
              allowFontScaling
            >
              {`${h}h`}
            </T>
          ))}
        </View>
      </View>
      <View style={styles.axis}>
        {days.map((d) => (
          <T
            key={d}
            testID={`diary-weekday-${d}`}
            style={[styles.axisLabel, d === today && styles.axisToday]}
          >
            {weekday(d)}
          </T>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: S.control / 2, paddingVertical: S.control },
  plot: { width: '100%' },
  svg: { width: '100%', aspectRatio: VW / CHART_H },
  ticks: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: `${(PAD_R / VW) * 100}%`,
    paddingLeft: S.control / 3,
  },
  // 글자 줄 높이의 절반만큼 올려 격자 선 위에 가운데로 놓는다
  tick: {
    position: 'absolute',
    fontSize: F.caption,
    color: C.textMuted,
    marginTop: -F.caption * 0.7,
  },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: S.component },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: S.control / 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: F.caption, color: C.textMuted },
  axis: {
    flexDirection: 'row',
    paddingLeft: `${(PAD_L / VW) * 100}%`,
    paddingRight: `${(PAD_R / VW) * 100}%`,
  },
  axisLabel: { flex: 1, textAlign: 'center', fontSize: F.caption, color: C.textMuted },
  axisToday: { color: C.text, fontWeight: F.bold },
});
