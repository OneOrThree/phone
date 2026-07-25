import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { T } from '@/constants/theme';
import { iGa } from '@/screens/onboarding/format';
import type { StepProps } from '@/screens/onboarding/types';

// 과목별 비교 — "비교가 아니라, 어디를 더 채우면 될지"(설득). 목업 막대 비교.
// 실제 과목명 대신 일반 라벨(A~D과목)만 써서 '앱이 과목 단위로 비교해준다'는 느낌만 준다
// (이 화면은 카테고리 선택 전이라 실제 과목이 아직 없음). TODO: 통계 연동 후 실데이터.
const BARS = [
  { me: 77, avg: 65 },
  { me: 63, avg: 59 },
  { me: 34, avg: 67 }, // 평균보다 부족한 과목
  { me: 58, avg: 54 },
];
const SUBJECTS = ['A과목', 'B과목', 'C과목', 'D과목'];

// 막대가 바닥에서 목표 높이까지 자라며 등장 — 컨테이너가 바닥 정렬이라 height 증가 = 위로 상승.
// 오버슛 없이 감속하며 목표 높이에 그대로 멈춘다(ease-out). delay로 좌→우 시차.
function GrowingBar({ height, color, delay }: { height: number; color: string; delay: number }) {
  const h = useSharedValue(0);
  useEffect(() => {
    h.value = withDelay(
      delay,
      withTiming(height, { duration: 550, easing: Easing.out(Easing.cubic) }),
    );
  }, [h, height, delay]);
  const grow = useAnimatedStyle(() => ({ height: h.value }));
  return <Animated.View style={[s.bar, { backgroundColor: color }, grow]} />;
}

export default function SubjectCompareStep({ onNext }: StepProps) {
  const subjects = SUBJECTS;
  const bars = BARS;
  const deficitIdx = bars.findIndex((b) => b.me < b.avg);
  const deficitSubject = deficitIdx >= 0 ? subjects[deficitIdx] : null;

  return (
    <StepScaffold
      testID="onboarding.step.subjectCompare"
      center
      title={'비교가 아니라,\n어디를 더 채우면 될지'}
      ctaLabel="다음"
      onCta={onNext}
    >
      <View style={s.legend}>
        <View style={s.legendItem}>
          <View style={[s.legendSq, { backgroundColor: T.accent }]} />
          <Text style={s.legendText}>나</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendSq, { backgroundColor: T.borderDark }]} />
          <Text style={s.legendText}>준비생 평균</Text>
        </View>
      </View>

      <View style={s.chart}>
        {bars.map((b, i) => {
          const deficit = i === deficitIdx;
          return (
            <View key={subjects[i]} style={s.col}>
              <View style={s.bars}>
                <GrowingBar
                  height={b.me}
                  color={deficit ? T.accentLight : T.accent}
                  delay={150 + i * 120}
                />
                <GrowingBar height={b.avg} color={T.borderDark} delay={210 + i * 120} />
              </View>
              <Text style={[s.colLabel, deficit ? s.colLabelDeficit : null]} numberOfLines={1}>
                {subjects[i]}
              </Text>
            </View>
          );
        })}
      </View>

      {deficitSubject ? (
        <View style={s.note}>
          <View style={s.noteDot} />
          <Text style={s.noteText}>
            <Text style={s.noteStrong}>{deficitSubject}</Text>
            {iGa(deficitSubject)} 평균보다 부족해요
          </Text>
        </View>
      ) : null}

      <Text style={s.caption}>같은 시험 준비생 사이에서{'\n'}내 위치를 과목 단위로 보여드려요</Text>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: T.space.lg,
    marginBottom: T.space.md,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: T.space.xs },
  legendSq: { width: 9, height: 9, borderRadius: 2 },
  legendText: { fontSize: 10, fontWeight: '600', color: T.link },
  chart: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: T.space.xs,
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 18,
    paddingVertical: T.space.lg,
    paddingHorizontal: T.space.md,
  },
  col: { flex: 1, alignItems: 'center', gap: T.space.sm },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: T.space.xs, height: 100 },
  bar: { width: 16, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  colLabel: { fontSize: 10, fontWeight: '600', color: T.link, textAlign: 'center' },
  colLabelDeficit: { color: T.accentDeep },
  note: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: T.space.sm,
    backgroundColor: T.noteBg,
    borderWidth: 1,
    borderColor: T.noteBorder,
    borderRadius: 13,
    paddingVertical: T.space.md,
    paddingHorizontal: T.space.md,
    marginTop: T.space.md,
  },
  noteDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.accentLight },
  noteText: { fontSize: 12, fontWeight: '600', color: T.accentDeep, lineHeight: 17, flex: 1 },
  noteStrong: { fontWeight: '800' },
  caption: {
    ...T.text.body,
    fontWeight: '500',
    color: T.link,
    textAlign: 'center',
    marginTop: T.space.lg,
    lineHeight: 20,
  },
});
