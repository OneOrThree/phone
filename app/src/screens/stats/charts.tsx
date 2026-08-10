// 통계 공용 차트 — 분량 축 선그래프(LineChart)와 첫 시작 시각 점 차트(FirstStartChart).
// 세로축·격자·탭 말풍선 스캐폴딩(스타일)을 공유해 한 파일에 둔다.
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import { fadeIn, growUp } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { T } from '@/constants/theme';
import type { StatsPeriod } from '@/types/dto/stats';
import { getAllFocusSessions } from '@/services/focusApi';
import type { FocusSessionResponse } from '@/types/dto/focus';
import { axisCeil, fmtAxis, fmtHm } from '@/utils/timeFormat';
import { localDateStr } from '@/utils/localDate';
import {
  dailyFirstStartMinutes,
  firstStartPoints,
  kstTodayDate,
  type StatBar,
  type StartTimePoint,
} from './format';
import { CHART_BLOCK_H, CHART_H, FIRST_START_BODY_H, FOCUS_COLOR } from './constants';
import { CardBodyEmpty, CardBodyLoading } from './CardBodySlot';
import { cs } from './cardStyles';

// 진입 애니메이션을 걸려면 Animated 컴포넌트여야 한다 — 격자·라벨은 제자리에 둔 채
// **플롯 캔버스(SVG)만** 움직인다(GROMO-1381).
const AnimatedSvg = Animated.createAnimatedComponent(Svg);

// 선그래프 — BarChart와 같은 데이터(StatBar[])·세로축 구조를 쓰되 값을 점+꺾은선으로 잇는다(주 탭, GROMO-761).
// 점의 x좌표는 아래 라벨 칼럼(flex 균등 분할)의 중앙과 일치. 직선·원은 SVG가 필요해 react-native-svg 사용.
const DOT_PAD = 6; // 점(최대 r 4.5)이 캔버스 경계에서 잘리지 않게 사방 여유
const TIP_W = 84; // 탭 말풍선 배치 폭 — 칼럼 중심 기준, 플롯 밖으로 나가지 않게 클램프
export function LineChart({ bars, color }: { bars: StatBar[]; color: string }) {
  const [plotW, setPlotW] = useState(0);
  // 탭한 칼럼의 실값 말풍선(GROMO-849) — 같은 칼럼 재탭이면 닫힘. 기간 탭 전환 시 언마운트로 초기화.
  const [picked, setPicked] = useState<number | null>(null);
  const mo = useMotion();
  if (bars.length === 0) {
    // 빈 상태도 조회 중과 같은 높이 — 한 줄로 줄면 아래 카드가 통째로 올라온다
    return <CardBodyEmpty height={CHART_BLOCK_H}>아직 기록이 없어요</CardBodyEmpty>;
  }
  const axisMax = axisCeil(Math.max(...bars.map((b) => b.value), 1));
  const step = plotW / bars.length;
  const tip = picked != null && picked < bars.length && !bars[picked].future ? bars[picked] : null;
  const tipX = step * ((picked ?? 0) + 0.5);
  const tipY = tip ? CHART_H - (tip.value / axisMax) * CHART_H : 0;
  // 아직 오지 않은 구간(future)은 라벨만 남기고 선·점에서 제외 — x좌표는 원래 칼럼 위치 유지
  const pts = bars
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => !b.future)
    .map(({ b, i }) => ({
      x: step * (i + 0.5),
      y: CHART_H - (b.value / axisMax) * CHART_H,
      current: b.current,
    }));
  return (
    <View style={s.chartPlotRow}>
      {/* 세로축 — 상한·⅔·⅓ 눈금 3줄 (막대 차트와 동일) */}
      <View style={s.chartAxisCol}>
        <Text style={[s.chartAxisLabel, s.chartAxisTop]} allowFontScaling={false}>
          {fmtAxis(axisMax)}
        </Text>
        <Text style={[s.chartAxisLabel, s.chartAxisUpper]} allowFontScaling={false}>
          {fmtAxis((axisMax * 2) / 3)}
        </Text>
        <Text style={[s.chartAxisLabel, s.chartAxisLower]} allowFontScaling={false}>
          {fmtAxis(axisMax / 3)}
        </Text>
      </View>
      <View style={s.chartPlot} onLayout={(e) => setPlotW(e.nativeEvent.layout.width)}>
        <View style={[s.chartGridLine, s.chartGridTop]} />
        <View style={[s.chartGridLine, s.chartGridUpper]} />
        <View style={[s.chartGridLine, s.chartGridLower]} />
        <View style={[s.chartGridLine, s.chartGridBottom]} />
        {plotW > 0 && (
          // 캔버스를 점 반지름만큼 사방으로 키우고 음수 마진으로 되돌림 — 상단(최댓값)·바닥(0)의
          // 점이 캔버스 경계에서 잘리지 않게 (SVG는 자기 영역 밖을 클리핑)
          <AnimatedSvg
            width={plotW + DOT_PAD * 2}
            height={CHART_H + DOT_PAD * 2}
            // 바닥(0)에서 값만큼 자라 오른다 — 분량 축이라 바닥이 실제로 0인 차트에만 맞는
            // 연출이다. enterUp(translateY·350ms)이 아니라 growUp(scaleY·800ms·오버슛)을 쓴다.
            style={[s.lineSvg, mo.enter(growUp())]}
          >
            <Polyline
              points={pts.map((p) => `${p.x + DOT_PAD},${p.y + DOT_PAD}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={2}
            />
            {pts.map((p, i) => (
              <Circle
                key={i}
                cx={p.x + DOT_PAD}
                cy={p.y + DOT_PAD}
                r={p.current ? 4.5 : 3}
                fill={color}
              />
            ))}
            {/* 선택 강조 링 — 탭한 점 둘레 */}
            {tip && (
              <Circle
                cx={tipX + DOT_PAD}
                cy={tipY + DOT_PAD}
                r={7}
                stroke={color}
                strokeWidth={2}
                fill="none"
              />
            )}
          </AnimatedSvg>
        )}
        {/* 칼럼별 탭 영역 — 점 위가 아니어도 해당 칼럼 세로 영역 아무 데나 탭하면 실값 표시 */}
        <View style={s.lineTapRow}>
          {bars.map((b, i) => (
            <Pressable
              key={i}
              style={s.lineTapCol}
              onPress={() => {
                // 미래 칼럼은 완전 무반응 — 열린 말풍선을 닫지도 않는다(코덱스 리뷰 반영)
                if (b.future) return;
                setPicked(picked === i ? null : i);
              }}
            />
          ))}
        </View>
        {/* 실값 말풍선 — 점 위(상단에 가까우면 아래)에 표시 */}
        {tip && (
          <View
            pointerEvents="none"
            style={[
              s.lineTipWrap,
              {
                left: Math.min(Math.max(tipX - TIP_W / 2, 0), Math.max(plotW - TIP_W, 0)),
                top: tipY < 34 ? tipY + 12 : tipY - 32,
              },
            ]}
          >
            <Text style={s.lineTip} allowFontScaling={false}>
              {fmtHm(tip.value)}
            </Text>
          </View>
        )}
        <View style={s.lineLabelRow}>
          {bars.map((b, i) => (
            <Text
              key={`${b.label}-${i}`}
              style={[s.lineLabel, b.current ? [s.lineLabelCur, { color }] : null]}
              allowFontScaling={false}
            >
              {b.label}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

// 첫 시작 시각 추이(주·월) — 일별 첫 세션 startedAt을 점으로만 찍는다(선 연결 없음, GROMO-762).
// 세로축은 시각이라 LineChart(0부터 시작하는 분량 축)를 못 쓰고 전용 축을 그린다. 시간표처럼
// 이른 시각이 위 — 시작이 빨라지면 점이 올라간다. 주=요일별, 월=주별 평균. 서버 집계 없이 세션 조회만으로 계산.
export function FirstStartChart({ period }: { period: StatsPeriod }) {
  const [points, setPoints] = useState<StartTimePoint[] | null>(null);
  const [plotW, setPlotW] = useState(0);
  // 탭한 칼럼의 시작 시각 말풍선(GROMO-849) — LineChart와 같은 패턴, 값만 시각(HH:MM)
  const [picked, setPicked] = useState<number | null>(null);

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 방금 세션이 반영(타임테이블과 동일 패턴)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // 조회 시작점: 주=이번 주 월요일, 월=이달 1일이 낀 주의 월요일('N월 주별' 차트와 동일 구간).
        // 서버 /focus-session은 startedAt 필터라 '그날 시작한 세션'과 정확히 일치한다.
        // 축은 KST(GROMO-1236 P2) — 점 버킷(dailyFirstStartMinutes)·그리드가 KST 일이므로 조회
        // 하한도 KST 월요일 자정 '순간'이어야 경계 세션이 빠지지 않는다. +09:00 고정 오프셋은
        // KST가 DST 없는 존이라 안전.
        const kstToday = kstTodayDate();
        const from = new Date(
          period === 'WEEK' ? kstToday : new Date(kstToday.getFullYear(), kstToday.getMonth(), 1),
        );
        const dow = from.getDay(); // 0=일..6=토
        from.setDate(from.getDate() - (dow === 0 ? 6 : dow - 1));
        const fromInstant = new Date(`${localDateStr(from)}T00:00:00+09:00`);
        // 조회 실패 → 빈 차트("아직 기록이 없어요")로 표시
        const all = await getAllFocusSessions(
          fromInstant.toISOString(),
          new Date().toISOString(),
        ).catch(() => [] as FocusSessionResponse[]);
        if (cancelled) return;
        setPoints(firstStartPoints(period, dailyFirstStartMinutes(all)));
      })();
      return () => {
        cancelled = true;
      };
    }, [period]),
  );

  if (points === null) {
    return <CardBodyLoading height={FIRST_START_BODY_H} testID="stats.firstStart.loading" />;
  }

  const vals = points.filter((p) => !p.future && p.minutes != null).map((p) => p.minutes as number);
  if (vals.length === 0) {
    return <CardBodyEmpty height={FIRST_START_BODY_H}>아직 기록이 없어요</CardBodyEmpty>;
  }

  // 세로축 경계 — 정시로 내리고 폭을 3시간 배수로 맞춰 ⅓·⅔ 눈금도 정시가 되게 한다
  let axisMin = Math.floor(Math.min(...vals) / 60) * 60;
  const span = Math.max(180, Math.ceil((Math.max(...vals) - axisMin) / 180) * 180);
  let axisMax = axisMin + span;
  if (axisMax > 1440) {
    // 심야 시작이면 축이 24시를 넘지 않게 아래로 내림
    axisMax = 1440;
    axisMin = 1440 - span;
  }
  const fmtClock = (m: number) => `${Math.floor(m / 60)}시`;
  const step = plotW / points.length;
  // 미래 구간·기록 없는 날은 라벨만 남기고 점에서 제외(0으로 찍으면 '자정 시작'으로 왜곡)
  const pts = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.future && p.minutes != null)
    .map(({ p, i }) => ({
      x: step * (i + 0.5),
      y: (((p.minutes as number) - axisMin) / (axisMax - axisMin)) * CHART_H,
    }));
  const tip =
    picked != null && picked < points.length && !points[picked].future ? points[picked] : null;
  const tipMin = tip?.minutes ?? null;
  const tipX = step * ((picked ?? 0) + 0.5);
  const tipY = tipMin != null ? ((tipMin - axisMin) / (axisMax - axisMin)) * CHART_H : 0;
  return (
    <View>
      <View style={s.chartPlotRow}>
        {/* 세로축 — 위가 이른 시각. 분량 축과 달리 바닥이 0이 아니라 4눈금 모두 라벨 */}
        <View style={s.chartAxisCol}>
          <Text style={[s.chartAxisLabel, s.chartAxisTop]} allowFontScaling={false}>
            {fmtClock(axisMin)}
          </Text>
          <Text style={[s.chartAxisLabel, s.chartAxisUpper]} allowFontScaling={false}>
            {fmtClock(axisMin + span / 3)}
          </Text>
          <Text style={[s.chartAxisLabel, s.chartAxisLower]} allowFontScaling={false}>
            {fmtClock(axisMin + (span * 2) / 3)}
          </Text>
          <Text style={[s.chartAxisLabel, s.chartAxisBottom]} allowFontScaling={false}>
            {fmtClock(axisMax)}
          </Text>
        </View>
        <View style={s.chartPlot} onLayout={(e) => setPlotW(e.nativeEvent.layout.width)}>
          <View style={[s.chartGridLine, s.chartGridTop]} />
          <View style={[s.chartGridLine, s.chartGridUpper]} />
          <View style={[s.chartGridLine, s.chartGridLower]} />
          <View style={[s.chartGridLine, s.chartGridBottom]} />
          {plotW > 0 && (
            <FirstStartPlot plotW={plotW} pts={pts} tipMin={tipMin} tipX={tipX} tipY={tipY} />
          )}
          {/* 칼럼별 탭 영역 — 해당 칼럼 아무 데나 탭하면 첫 시작 시각 표시 */}
          <View style={s.lineTapRow}>
            {points.map((p, i) => (
              <Pressable
                key={i}
                style={s.lineTapCol}
                onPress={() => {
                  // 미래·무기록 칼럼은 완전 무반응(코덱스 리뷰 반영)
                  if (p.future || p.minutes == null) return;
                  setPicked(picked === i ? null : i);
                }}
              />
            ))}
          </View>
          {/* 시작 시각 말풍선 — 점 위(상단에 가까우면 아래)에 표시 */}
          {tipMin != null && (
            <View
              pointerEvents="none"
              style={[
                s.lineTipWrap,
                {
                  left: Math.min(Math.max(tipX - TIP_W / 2, 0), Math.max(plotW - TIP_W, 0)),
                  top: tipY < 34 ? tipY + 14 : tipY - 32,
                },
              ]}
            >
              <Text style={s.lineTip} allowFontScaling={false}>
                {fmtHm(tipMin)}
              </Text>
            </View>
          )}
          <View style={s.lineLabelRow}>
            {points.map((p, i) => (
              <Text
                key={`${p.label}-${i}`}
                style={[s.lineLabel, p.current ? [s.lineLabelCur, { color: FOCUS_COLOR }] : null]}
                allowFontScaling={false}
              >
                {p.label}
              </Text>
            ))}
          </View>
        </View>
      </View>
      <Text style={cs.grassHint}>그날 처음 집중을 시작한 시각 · 위로 갈수록 이른 시각이에요</Text>
    </View>
  );
}

// ⚠️ **자기 useMotion을 갖는 게 이 컴포넌트의 존재 이유다.** 이 플롯은 세션 조회와 plotW
//    레이아웃이 끝난 **뒤에야** 마운트되는데, 부모(FirstStartChart)의 진입 결정에 묶이면
//    조회 중 사용자가 '동작 줄이기'를 켰어도 과거 결정대로 페이드된다(codex 리뷰).
//    캘린더 행·주간 블록에 Enter를 쓴 것과 같은 처방이고, 여기는 Animated.View가 아니라
//    AnimatedSvg라 Enter 대신 컴포넌트로 뺐다 — 뷰를 새로 끼운 게 아니다(D-04 유지).
function FirstStartPlot({
  plotW,
  pts,
  tipMin,
  tipX,
  tipY,
}: {
  plotW: number;
  pts: { x: number; y: number }[];
  tipMin: number | null;
  tipX: number;
  tipY: number;
}) {
  const mo = useMotion();
  return (
    <AnimatedSvg
      width={plotW + DOT_PAD * 2}
      height={CHART_H + DOT_PAD * 2}
      // ⚠️ 여기만 growUp이 아니다. 이 차트의 세로축은 **시각**이라 바닥이 0이 아니다
      // (axisMin은 데이터에서 정해진다). 바닥부터 자라게 하면 "0에서 이만큼 커졌다"는
      // 뜻이 되어 값의 의미를 왜곡한다 — 이동 없이 불투명도만 쓰는 fadeIn을 고른다.
      style={[s.lineSvg, mo.enter(fadeIn())]}
    >
      {/* 선 없이 점만이라 크게(r 5, DOT_PAD 안) — 오늘 강조는 크기 대신 라벨 볼드만 */}
      {pts.map((p, i) => (
        <Circle key={i} cx={p.x + DOT_PAD} cy={p.y + DOT_PAD} r={5} fill={FOCUS_COLOR} />
      ))}
      {/* 선택 강조 링 — 탭한 점 둘레 */}
      {tipMin != null && (
        <Circle
          cx={tipX + DOT_PAD}
          cy={tipY + DOT_PAD}
          r={8}
          stroke={FOCUS_COLOR}
          strokeWidth={2}
          fill="none"
        />
      )}
    </AnimatedSvg>
  );
}

const s = StyleSheet.create({
  chartPlotRow: { flexDirection: 'row', marginTop: T.space.lg },
  // 선그래프 — 확장 캔버스를 음수 마진으로 되돌려 레이아웃(격자 정렬)은 그대로 유지.
  // transformOrigin은 growUp(scaleY 0→1)이 **바닥부터** 자라기 위한 정적 스타일이다
  // (애니메이션 프로퍼티가 아니라 여기 있어야 한다 — motion.ts growUp 주석).
  lineSvg: {
    transformOrigin: 'bottom',
    marginTop: -DOT_PAD,
    marginBottom: -DOT_PAD,
    marginLeft: -DOT_PAD,
    marginRight: -DOT_PAD,
  },
  // 선그래프 라벨 — 점 x좌표(칼럼 중앙)와 정렬되도록 균등 분할
  lineLabelRow: { flexDirection: 'row', marginTop: T.space.sm },
  lineLabel: { ...T.text.caption, fontSize: 10, color: T.inkMuted, flex: 1, textAlign: 'center' },
  lineLabelCur: { fontWeight: '800' },
  // 선그래프 탭 실값 말풍선(GROMO-849)
  lineTapRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: CHART_H,
    flexDirection: 'row',
  },
  lineTapCol: { flex: 1 },
  lineTipWrap: { position: 'absolute', width: TIP_W, alignItems: 'center' },
  lineTip: {
    ...T.text.caption,
    color: T.white,
    backgroundColor: T.ink,
    paddingHorizontal: T.space.sm,
    paddingVertical: 3,
    borderRadius: 7,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  chartAxisCol: { width: 36, height: CHART_H },
  chartAxisLabel: {
    ...T.text.caption,
    position: 'absolute',
    right: 6,
    fontSize: 9,
    color: T.inkMuted,
  },
  chartAxisTop: { top: -5 },
  chartAxisUpper: { top: CHART_H / 3 - 5 },
  chartAxisLower: { top: (CHART_H * 2) / 3 - 5 },
  chartAxisBottom: { top: CHART_H - 5 }, // 시각 축(첫 시작 시각) 전용 — 바닥이 0이 아니라 라벨 필요
  chartPlot: { flex: 1 },
  chartGridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: T.paperAlt,
  },
  chartGridTop: { top: 0 },
  chartGridUpper: { top: CHART_H / 3 },
  chartGridLower: { top: (CHART_H * 2) / 3 },
  chartGridBottom: { top: CHART_H },
});
