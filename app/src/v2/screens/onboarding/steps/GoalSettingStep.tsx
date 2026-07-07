import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import StepScaffold from '@/v2/screens/onboarding/components/StepScaffold';
import Slider from '@/v2/screens/onboarding/components/Slider';
import { T } from '@/constants/theme';
import { formatDuration } from '@/v2/screens/onboarding/format';
import { logOnboardingGoalSubmitted } from '@/services/analyticsEvents';
import type { StepProps, V2OnboardingData } from '@/v2/screens/onboarding/types';

// W12 · 목표 설정 — 하루 집중 목표(dailyFocusMinutes) + 하루 스크린타임 목표(usageGoalMinutes)를 한 화면에서.
// 기존 FocusGoalStep·UsageGoalStep을 병합. 값이 추천값일 때 '추천' 배지 표시.
const FOCUS = { min: 30, max: 600, step: 10, rec: 300 }; // 5시간 추천
const SCREEN = { min: 30, max: 480, step: 10, fallback: 120 }; // 추측 없을 때 2시간 폴백

// 하루 스크린타임 추천값 — 어제 자가추측(W9)보다 약 25% 적게, 슬라이더 눈금·범위로 보정.
// 추측이 없으면(예외) 기존 2시간 폴백. 실측 없이 대략치라 '조금 줄여보자' 유도가 목적.
function recommendScreenGoal(guessMinutes: number | null): number {
  const base = guessMinutes ?? SCREEN.fallback;
  const target = Math.round((base * 0.75) / SCREEN.step) * SCREEN.step;
  return Math.min(SCREEN.max, Math.max(SCREEN.min, target));
}

export default function GoalSettingStep({ data, update, onNext }: StepProps) {
  const focusMin = data.dailyFocusMinutes ?? FOCUS.rec;
  const screenRec = recommendScreenGoal(data.guessedYesterdayMinutes);
  const screenMin = data.usageGoalMinutes ?? screenRec;

  // update는 매 렌더 새 함수라 ref로 최신값만 참조 — deps에서 빼 부모 리렌더마다 재실행되지 않게 한다.
  const updateRef = useRef(update);
  updateRef.current = update;
  // 진입 시 추천값을 data에 미리 채워 둔다 — 슬라이더를 건드리지 않아도 추천 시간이 기본 선택된 상태가 되도록.
  useEffect(() => {
    const patch: Partial<V2OnboardingData> = {};
    if (data.dailyFocusMinutes == null) patch.dailyFocusMinutes = FOCUS.rec;
    if (data.usageGoalMinutes == null) patch.usageGoalMinutes = screenRec;
    if (Object.keys(patch).length > 0) updateRef.current(patch);
  }, [data.dailyFocusMinutes, data.usageGoalMinutes, screenRec]);

  return (
    <StepScaffold
      center
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
              {screenMin === screenRec ? <Text style={s.rec}>추천</Text> : null}
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
