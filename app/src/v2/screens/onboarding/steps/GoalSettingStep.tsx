import { View, Text, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import Slider from '@/v2/screens/onboarding/components/Slider';
import { T } from '@/constants/theme';
import { formatDuration } from '@/v2/screens/onboarding/format';
import type { StepProps } from '@/v2/screens/onboarding/types';

// W12 · 목표 설정 — 하루 집중 목표(dailyFocusMinutes) + 하루 스크린타임 목표(usageGoalMinutes)를 한 화면에서.
// 기존 FocusGoalStep·UsageGoalStep을 병합. 값이 추천값일 때 '추천' 배지 표시.
const FOCUS = { min: 30, max: 600, step: 10, rec: 240 }; // 4시간 추천
const SCREEN = { min: 30, max: 480, step: 10, rec: 120 }; // 2시간 이하 추천

export default function GoalSettingStep({ data, update, onNext, onBack }: StepProps) {
  const focusMin = data.dailyFocusMinutes ?? FOCUS.rec;
  const screenMin = data.usageGoalMinutes ?? SCREEN.rec;

  return (
    <StepScaffold
      center
      title="목표를 정해볼까요?"
      ctaLabel="다음"
      onCta={() => {
        update({ dailyFocusMinutes: focusMin, usageGoalMinutes: screenMin });
        onNext();
      }}
      onBack={onBack}
    >
      <View style={s.cards}>
        <View style={s.card}>
          <View style={s.head}>
            <Text style={s.label}>하루 집중 목표</Text>
            <View style={s.valueWrap}>
              <Text style={s.value}>{formatDuration(focusMin)}</Text>
              {focusMin === FOCUS.rec ? <Text style={s.rec}>추천</Text> : null}
            </View>
          </View>
          <Slider
            min={FOCUS.min}
            max={FOCUS.max}
            step={FOCUS.step}
            value={focusMin}
            onChange={(m) => update({ dailyFocusMinutes: m })}
          />
        </View>

        <View style={s.card}>
          <View style={s.head}>
            <Text style={s.label}>하루 스크린타임 목표</Text>
            <View style={s.valueWrap}>
              <Text style={s.value}>{formatDuration(screenMin)} 이하</Text>
              {screenMin === SCREEN.rec ? <Text style={s.rec}>추천</Text> : null}
            </View>
          </View>
          <Slider
            min={SCREEN.min}
            max={SCREEN.max}
            step={SCREEN.step}
            value={screenMin}
            onChange={(m) => update({ usageGoalMinutes: m })}
          />
        </View>
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  cards: { alignSelf: 'stretch', gap: 12 },
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  label: { ...T.text.caption, fontWeight: '700', color: T.ink },
  valueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  value: { ...T.text.subtitle, fontWeight: '800', color: T.accent },
  rec: {
    ...T.text.caption,
    fontSize: 9,
    fontWeight: '600',
    color: T.white,
    backgroundColor: T.green,
    borderRadius: 99,
    paddingVertical: 2,
    paddingHorizontal: 7,
    overflow: 'hidden',
  },
});
