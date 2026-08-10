// 통계 공용 차트 — 분량 축 선그래프(LineChart)와 첫 시작 시각 점 차트(FirstStartChart).
// 세로축·격자·탭 말풍선 스캐폴딩(스타일)을 공유해 한 파일에 둔다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import { M, fadeIn } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { T } from '@/constants/theme';
import type { StatsPeriod } from '@/types/dto/stats';
import { getAllFocusSessions } from '@/services/focusApi';
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
const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// 꺾은선 진입 — **왼쪽에서 오른쪽으로 그린다**(정책 D16).
//
// ⚠️ growUp(scaleY 0→1)은 **막대 전용**이다. 막대는 '값이 곧 높이'라 바닥에서 자라는 게 값의
//    의미와 같지만, 꺾은선의 의미는 **시간축을 따라 이어지는 궤적**이다. 선 전체를 아래에서
//    눌렀다 펴면 모든 요일이 동시에 자라 "왼쪽부터 지나온 시간"이라는 뜻이 사라지고,
//    오버슛 구간에서는 선이 목표 높이를 넘었다 돌아와 값이 실제보다 크게 보이는 프레임이 생긴다.
//
// 구현은 `ProgressRing`과 같은 기법이다 — 선 길이만큼의 파선을 깔고 시작 오프셋만 당긴다.
// 매 프레임 points를 다시 만들지 않아도 선이 자란다.
//
// ⚠️ **시퀀스 전체는 선 그리기(entrance)보다 점 팝(quick) 하나만큼 길다.**
//    선이 끝나는 순간(진행률 `LINE_SPAN`)에 맞춰 마지막 점의 팝이 **시작**하고, 남은 구간에서
//    끝난다. 이 여유가 없으면 누적 길이 비율이 1인 마지막 점은 팝에 쓸 시간이 0이라 반지름이
//    0에 머문 채 끝나 **영영 보이지 않는다**(codex 리뷰). 다른 점들은 뒤에 선이 더 남아 있어
//    저절로 시간이 확보되므로, 마지막 점만 겪는 문제다.
const DRAW_MS = M.dur.entrance + M.dur.quick;
/** 선 그리기가 끝나는 진행률. 이 뒤 구간은 마지막 점의 팝에 쓴다. */
const LINE_SPAN = M.dur.entrance / DRAW_MS;
/** 점 하나가 튀어나오는 데 쓰는 진행률 폭 */
const DOT_POP_SPAN = M.dur.quick / DRAW_MS;

// 점이 뜨는 시점 = 그 점까지의 **누적 길이 비율**.
// ⚠️ `i * 60ms` 같은 상수 시차를 쓰면 안 된다 — 구간마다 길이가 달라(꺾임이 클수록 길다)
//    점이 선보다 먼저 뜨거나 뒤늦게 따라온다.
export function drawOnRatios(pts: { x: number; y: number }[]): { total: number; at: number[] } {
  if (pts.length < 2) return { total: 0, at: pts.map(() => 0) };
  const segs = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  const total = segs.reduce((a, b) => a + b, 0);
  let acc = 0;
  return { total, at: [0, ...segs.map((s) => (acc += s) / (total || 1))] };
}

/**
 * 점 하나가 뜨고(start) 제 크기가 되는(end) 진행률 구간.
 *
 * ⚠️ `end`가 1을 넘으면 그 점은 **끝까지 제 크기가 되지 못한다.** 특히 누적 길이 비율이 1인
 *    마지막 점은 여유가 0이면 반지름 0에 머문 채 끝나 영영 보이지 않는다(codex 리뷰).
 */
export function dotWindow(at: number): { start: number; end: number } {
  const start = at * LINE_SPAN;
  return { start, end: start + DOT_POP_SPAN };
}

// 점 하나 — 선이 자기 자리를 지나가는 순간 튀어나온다.
// ⚠️ 워클릿 안에서는 산술만 쓴다(이징 객체를 부르지 않는다). easeOutBack을 식으로 편다.
function DrawOnDot({
  cx,
  cy,
  r,
  color,
  at,
  progress,
}: {
  cx: number;
  cy: number;
  r: number;
  color: string;
  at: number;
  progress: SharedValue<number>;
}) {
  const animatedProps = useAnimatedProps(() => {
    // 선이 이 점을 지나가는 시각 — 선 그리기 구간(LINE_SPAN) 안으로 눌러 매핑한다.
    const start = at * LINE_SPAN;
    const p = progress.value;
    if (p < start) return { r: 0, opacity: 0 };
    const k = Math.min(1, (p - start) / DOT_POP_SPAN);
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const e = k >= 1 ? 1 : 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
    return { r: r * e, opacity: 1 };
  });
  return <AnimatedCircle cx={cx} cy={cy} fill={color} animatedProps={animatedProps} />;
}

// 선그래프 — BarChart와 같은 데이터(StatBar[])·세로축 구조를 쓰되 값을 점+꺾은선으로 잇는다(주 탭, GROMO-761).
// 점의 x좌표는 아래 라벨 칼럼(flex 균등 분할)의 중앙과 일치. 직선·원은 SVG가 필요해 react-native-svg 사용.
const DOT_PAD = 6; // 점(최대 r 4.5)이 캔버스 경계에서 잘리지 않게 사방 여유
const TIP_W = 84; // 탭 말풍선 배치 폭 — 칼럼 중심 기준, 플롯 밖으로 나가지 않게 클램프
export function LineChart({ bars, color }: { bars: StatBar[]; color: string }) {
  const [plotW, setPlotW] = useState(0);
  // 탭한 칼럼의 실값 말풍선(GROMO-849) — 같은 칼럼 재탭이면 닫힘. 기간 탭 전환 시 언마운트로 초기화.
  const [picked, setPicked] = useState<number | null>(null);
  const mo = useMotion();

  // 그리기 진행률 0→1. 선의 dash 오프셋과 점의 등장 시점을 한 값으로 묶는다.
  // ⚠️ 훅은 아래 빈 상태 early return **앞**에 있어야 한다(훅 순서 규칙).
  const progress = useSharedValue(0);
  // 진입은 **인스턴스당 1회**다. 이전 구현(CSS animationName)이 노드 마운트에만 재생됐던 것과
  // 같게 맞춘다 — 탭 전환·재조회로 값이 바뀔 때마다 다시 그리면 산만하다.
  const startedRef = useRef(false);
  useEffect(() => {
    // ⚠️ `mo.ready` 전에는 시작하지 않는다. '동작 줄이기' 조회가 끝나기 전 `mo.reduce`는
    //    보수적으로 true라, 그 값으로 확정하면 설정을 켜지 않은 사용자가 연출을 영영 잃는다
    //    (정책 D-30). 확정 전에는 시작 상태(선 없음)로 대기한다.
    // ⚠️ `plotW > 0`이라야 좌표가 정해진다 — 그 전에 시작하면 길이 0짜리 선을 그린다.
    if (startedRef.current || plotW <= 0 || !mo.ready) return;
    startedRef.current = true;
    progress.value = 0;
    // reduce면 mo.timing이 목표값을 그대로 돌려준다 — 즉시 완성된 선.
    progress.value = mo.timing(1, {
      // 선(entrance) + 마지막 점 팝(quick). 위 LINE_SPAN 주석 참고.
      duration: DRAW_MS,
      easing: M.curve.standard.fn,
    });
  }, [mo, plotW, progress]);

  // ⚠️ 좌표 계산을 빈 상태 early return **위로** 올렸다 — 아래 `useAnimatedProps`가 선 길이를
  //    필요로 하는데, 훅은 조건부로 부를 수 없다. bars가 비면 pts도 비고 total은 0이 된다.
  const axisMax = axisCeil(Math.max(...bars.map((b) => b.value), 1));
  const step = plotW / (bars.length || 1);
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
  const draw = drawOnRatios(pts);
  const lineProps = useAnimatedProps(() => ({
    // 선은 LINE_SPAN 에서 이미 완성된다 — 남은 구간은 마지막 점의 팝 몫이다.
    strokeDashoffset: draw.total * (1 - Math.min(1, progress.value / LINE_SPAN)),
  }));

  if (bars.length === 0) {
    // 빈 상태도 조회 중과 같은 높이 — 한 줄로 줄면 아래 카드가 통째로 올라온다
    return <CardBodyEmpty height={CHART_BLOCK_H}>아직 기록이 없어요</CardBodyEmpty>;
  }
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
          // 캔버스 자체는 움직이지 않는다 — 선과 점만 그려진다(정책 D16, 위 drawOnRatios 주석).
          <Svg width={plotW + DOT_PAD * 2} height={CHART_H + DOT_PAD * 2} style={s.lineSvg}>
            <AnimatedPolyline
              points={pts.map((p) => `${p.x + DOT_PAD},${p.y + DOT_PAD}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              // 선 길이만큼의 파선 하나 — 오프셋을 0까지 당기면 왼쪽부터 그려진다.
              strokeDasharray={`${draw.total} ${draw.total}`}
              animatedProps={lineProps}
            />
            {pts.map((p, i) => (
              <DrawOnDot
                key={i}
                cx={p.x + DOT_PAD}
                cy={p.y + DOT_PAD}
                r={p.current ? 4.5 : 3}
                color={color}
                at={draw.at[i] ?? 0}
                progress={progress}
              />
            ))}
            {/* 선택 강조 링 — 탭한 점 둘레. 사용자가 탭해서 뜨는 것이라 진입 연출과 무관하다. */}
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
          </Svg>
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
  // 조회 실패(GROMO-1474). 실패를 빈 배열로 뭉개면 "아직 기록이 없어요"가 떠 네트워크 장애가
  // '기록 없음'으로 둔갑하고 재시도 경로도 사라진다 — CalendarCard와 같은 처방으로 분리한다.
  const [fetchFailed, setFetchFailed] = useState(false);
  // 조회 세대 — 응답 폐기 기준. 화면 이탈·기간 변경·재시도가 세대를 올리면 그 전에 띄운 조회의
  // 응답은 버린다(예전 `cancelled` 지역 플래그와 같은 역할인데, 재시도 버튼처럼 이펙트 **밖**에서
  // 시작한 조회도 같은 기준으로 묶인다).
  const reqRef = useRef(0);

  // 조회 한 번. 화면 포커스와 '다시 시도' 버튼이 같은 본체를 쓴다 — 재시도용 카운터 상태를
  // 따로 두고 의존성에 끼워 넣는 방식보다 트리거가 눈에 보인다.
  const load = useCallback(async () => {
    const seq = ++reqRef.current;
    // 새 조회가 시작되면 이전 실패 표시를 지운다 — 재시도 중에는 로딩으로 돌아간다
    setFetchFailed(false);
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
    try {
      const all = await getAllFocusSessions(fromInstant.toISOString(), new Date().toISOString());
      if (reqRef.current !== seq) return;
      setPoints(firstStartPoints(period, dailyFirstStartMinutes(all)));
    } catch {
      if (reqRef.current !== seq) return;
      // ⚠️ 빈 배열을 넣지 않는다 — 실패는 '기록 없음'이 아니다. points는 손대지 않고
      //    실패 플래그만 세운다(아래 렌더에서 실패가 points보다 우선한다).
      setFetchFailed(true);
    }
  }, [period]);

  // '다시 시도' 전용 트리거. 화면 포커스 재조회와 달리 **직전 화면을 비우고** 다시 조회한다.
  // ⚠️ load를 그대로 버튼에 걸면, 이전 조회의 points가 남아 있는 경우 누른 순간 실패 안내가
  //    사라지고 **낡은 차트가 정상 결과처럼** 돌아온다 — 조회가 지연되면 사용자는 눌렀는지조차
  //    알 수 없이 옛 데이터를 무기한 본다(codex 리뷰). 재진입 재조회는 stale-while-revalidate가
  //    맞지만, 사용자가 직접 누른 재시도는 진행 중임이 보여야 한다.
  const retry = useCallback(() => {
    setPoints(null);
    load();
  }, [load]);

  // 화면 재진입마다 재조회 — 세션 종료 후 돌아와도 방금 세션이 반영(타임테이블과 동일 패턴)
  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        reqRef.current++; // 이탈 시 진행 중 응답 폐기(언마운트 후 setState 방지)
      };
    }, [load]),
  );

  // 로딩·실패·무데이터 세 상태를 화면에서 구분한다(CalendarCard의 noData/failed/loading과 같은 파생).
  // ⚠️ **실패가 points보다 먼저다.** 이전 조회가 성공해 points가 남아 있어도 마찬가지다 —
  //    첫 조회가 빈 결과([])였던 신규 사용자가 재진입했다가 재조회에 실패하면, points를 먼저
  //    보는 순서에서는 실패했는데도 "아직 기록이 없어요"가 다시 뜨고 재시도 버튼도 없다.
  //    이 티켓이 없애려던 바로 그 화면이다(codex 리뷰). CalendarCard도 실패를 우선한다.
  if (fetchFailed) {
    return (
      <View style={s.errorBody} testID="stats.firstStart.error">
        <Text style={s.errorText}>불러오지 못했어요</Text>
        <TouchableOpacity style={s.retryBtn} activeOpacity={0.8} onPress={retry}>
          <Text style={s.retryText}>다시 시도</Text>
        </TouchableOpacity>
      </View>
    );
  }
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
  // 조회 실패 안내(GROMO-1474) — 문구·버튼 모양은 같은 화면의 CalendarCard와 같은 값이다.
  // 한 화면에서 실패 표현이 갈리면 같은 장애가 카드마다 다른 사고처럼 보인다.
  // ⚠️ 높이는 CardBodyLoading과 같은 **고정** FIRST_START_BODY_H — 실패 표시가 더 짧으면
  //    아래 카드가 위로 튄다(로딩↔실패↔본문 전환 내내 카드가 미동도 하지 않아야 한다).
  errorBody: { height: FIRST_START_BODY_H, alignItems: 'center', justifyContent: 'center' },
  errorText: { ...T.text.caption, fontSize: 12, color: T.inkSub },
  retryBtn: {
    marginTop: T.space.sm,
    backgroundColor: T.accent,
    borderRadius: 999,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.xs,
  },
  retryText: { ...T.text.caption, fontWeight: '700', color: T.white },
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
