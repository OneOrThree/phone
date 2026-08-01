import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { DurationDrumPicker } from '@/components/DurationDrumPicker';
import { T } from '@/constants/theme';
import { formatDuration } from '@/screens/onboarding/format';
import { logOnboardingGoalSubmitted } from '@/services/analyticsEvents';
import type { StepProps, V2OnboardingData } from '@/screens/onboarding/types';

// W12 · 목표 설정 — 하루 집중 목표(dailyFocusMinutes) + 하루 스크린타임 목표(usageGoalMinutes)를 한 화면에서.
// 기존 FocusGoalStep·UsageGoalStep을 병합. rec는 초기 기본값으로만 쓰고 화면에 배지는 없다.
// 입력은 드럼(휠) 피커 · 5분 단위 — 설정의 개인 목표 수정과 동일한 UI (GROMO-969).
const FOCUS = { min: 30, max: 1440, rec: 720 }; // 최대 24시간, 기본 12시간
const SCREEN = { min: 30, max: 480, rec: 240 }; // 기본 4시간 이하

export default function GoalSettingStep({ data, update, onNext }: StepProps) {
  const focusMin = data.dailyFocusMinutes ?? FOCUS.rec;
  const screenMin = data.usageGoalMinutes ?? SCREEN.rec;

  // update는 매 렌더 새 함수라 ref로 최신값만 참조 — deps에서 빼 부모 리렌더마다 재실행되지 않게 한다.
  const updateRef = useRef(update);
  updateRef.current = update;
  // 진입 시 기본값을 data에 미리 채워 둔다 — 슬라이더를 건드리지 않아도 기본 시간이 선택된 상태가 되도록.
  useEffect(() => {
    const patch: Partial<V2OnboardingData> = {};
    if (data.dailyFocusMinutes == null) patch.dailyFocusMinutes = FOCUS.rec;
    if (data.usageGoalMinutes == null) patch.usageGoalMinutes = SCREEN.rec;
    if (Object.keys(patch).length > 0) updateRef.current(patch);
  }, [data.dailyFocusMinutes, data.usageGoalMinutes]);

  return (
    <StepScaffold
      testID="onboarding.step.goal"
      center
      scrollable
      title="목표를 정해볼까요?"
      ctaLabel="다음"
      onCta={() => {
        update({ dailyFocusMinutes: focusMin, usageGoalMinutes: screenMin });
        // 한 화면에서 집중·스크린타임 목표를 각각 제출 — goal_type으로 구분해 2회 발사.
        logOnboardingGoalSubmitted({ goal_minutes: focusMin, goal_type: 'focus' });
        logOnboardingGoalSubmitted({ goal_minutes: screenMin, goal_type: 'usage' });
        onNext();
      }}
    >
      <View style={s.cards}>
        <View style={s.card}>
          <View style={s.head}>
            <Text style={s.label}>하루 집중 목표</Text>
            <View style={s.valueWrap}>
              <Text style={s.value}>{formatDuration(focusMin)}</Text>
            </View>
          </View>
          <DurationDrumPicker
            minMinutes={FOCUS.min}
            maxMinutes={FOCUS.max}
            value={focusMin}
            onChange={(m) => update({ dailyFocusMinutes: m })}
          />
        </View>

        <View style={s.card}>
          <View style={s.head}>
            <Text style={s.label}>하루 스크린타임 목표</Text>
            <View style={s.valueWrap}>
              <Text style={s.value}>{formatDuration(screenMin)} 이하</Text>
            </View>
          </View>
          <DurationDrumPicker
            minMinutes={SCREEN.min}
            maxMinutes={SCREEN.max}
            value={screenMin}
            onChange={(m) => update({ usageGoalMinutes: m })}
          />
        </View>
      </View>
    </StepScaffold>
  );
}

const s = StyleSheet.create({
  cards: { alignSelf: 'stretch', gap: T.space.md },
  card: {
    backgroundColor: T.white,
    borderWidth: 1,
    borderColor: T.paperAlt,
    borderRadius: 16,
    paddingVertical: T.space.lg,
    paddingHorizontal: T.space.lg,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: T.space.lg,
  },
  label: { ...T.text.caption, fontWeight: '700', color: T.ink },
  valueWrap: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  value: { ...T.text.subtitle, fontWeight: '800', color: T.accent },
});
