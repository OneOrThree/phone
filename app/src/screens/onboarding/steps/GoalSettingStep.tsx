import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import StepScaffold from '@/screens/onboarding/components/StepScaffold';
import { DurationDrumPicker } from '@/components/DurationDrumPicker';
import { T } from '@/constants/theme';
import { FOCUS_GOAL_MINUTES, USAGE_GOAL_MINUTES } from '@/constants/goals';
import { formatDuration } from '@/screens/onboarding/format';
import {
  logOnboardingGoalSubmitted,
  logOnboardingScreentimeViewed,
} from '@/services/analyticsEvents';
import type { StepProps } from '@/screens/onboarding/types';

// W12 · 목표 설정 — 하루 집중 목표(dailyFocusMinutes) + 하루 스크린타임 목표(usageGoalMinutes)를 한 화면에서.
// 기존 FocusGoalStep·UsageGoalStep을 병합. 입력은 드럼(휠) 피커 · 5분 단위 — 설정의 개인 목표
// 수정과 동일한 UI (GROMO-969).
// GROMO-1080 — 프리필(집중 12시간·스크린타임 4시간)을 없애 둘 다 0시간에서 시작하고, 피커는
// 기본 접힘(헤더 탭으로 펼침)으로 바꿨다. 아무것도 안 정하고 넘어가던 문제를 막기 위해
// 두 목표를 모두 조작하기 전에는 '다음'을 막는다.
// 화면의 '0시간'은 '아직 안 정함' 표시일 뿐 고를 수 있는 값이 아니다 — 0시간 목표는 허용하지
// 않으므로(0이면 매일 자동 달성이 된다) 하한 30분을 그대로 둔다. 피커가 [min, max]로 클램프해
// 주므로 사용자가 확정할 수 있는 최솟값은 항상 30분이다.
// 범위는 설정 > 개인 목표 수정과 공유한다 (@/constants/goals, GROMO-1255).

// Maestro E2E 대본은 드럼 휠을 굴릴 수 없어 목표를 정할 방법이 없다 — 테스트 빌드에서만 예전
// 기본값을 초기값으로 써서 '다음'이 열린 채로 시작한다. EXPO_PUBLIC_E2E=1은 scripts/e2e.sh가
// 빌드 시 주입하며 운영/일반 빌드엔 없다 (GROMO-947).
const E2E = process.env.EXPO_PUBLIC_E2E === '1';
const E2E_PREFILL = { focus: 720, screen: 240 };

// 0분은 '0시간'으로 — 아직 안 정한 상태를 시간 단위로 읽히게 한다(formatDuration은 0을 '0분'으로 낸다).
function goalLabel(minutes: number): string {
  return minutes === 0 ? '0시간' : formatDuration(minutes);
}

export default function GoalSettingStep({ data, update, onNext }: StepProps) {
  const focusMin = data.dailyFocusMinutes ?? (E2E ? E2E_PREFILL.focus : 0);
  const screenMin = data.usageGoalMinutes ?? (E2E ? E2E_PREFILL.screen : 0);

  // '손을 댔는지' 판정 = 온보딩 데이터에 값이 들어갔는가(null=아직 안 정함). 프리필을 없앴으므로
  // 값이 있다는 것 자체가 사용자가 피커를 굴렸다는 뜻이고, 뒤로 갔다 돌아와도 판정이 유지된다.
  const focusSet = data.dailyFocusMinutes != null || E2E;
  const screenSet = data.usageGoalMinutes != null || E2E;

  // 피커는 기본 접힘 — 헤더 행을 탭하면 펼친다(추천 과목 섹션과 같은 방식, 애니메이션 없음).
  const [focusOpen, setFocusOpen] = useState(false);
  const [screenOpen, setScreenOpen] = useState(false);

  // 권한 승인 사용자는 과거 전날 사용시간 화면에서 발행하던 스크린타임 퍼널 이벤트를
  // 목표 설정 진입 시 이어서 발행한다. 거부 사용자는 직전 ScreenTimeDeniedStep이
  // has_data:false를 발행하므로 여기서는 승인 경로만 처리한다.
  useEffect(() => {
    if (data.screenTimeGranted === true) {
      logOnboardingScreentimeViewed({ has_data: true });
    }
  }, [data.screenTimeGranted]);

  return (
    <StepScaffold
      testID="onboarding.step.goal"
      center
      scrollable
      title="목표를 정해볼까요?"
      ctaLabel="다음"
      // 두 목표를 다 정하기 전에는 진행 불가 — 기본값으로 그냥 넘어가는 것을 막는다.
      ctaDisabled={!focusSet || !screenSet}
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
          <TouchableOpacity
            style={[s.head, focusOpen ? s.headOpen : null]}
            activeOpacity={0.7}
            onPress={() => setFocusOpen((v) => !v)}
          >
            <Text style={s.label}>하루 집중 목표</Text>
            <View style={s.valueWrap}>
              <Text style={s.value}>{goalLabel(focusMin)}</Text>
              <Ionicons
                name={focusOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={T.inkMuted}
              />
            </View>
          </TouchableOpacity>
          {focusOpen ? (
            <DurationDrumPicker
              minMinutes={FOCUS_GOAL_MINUTES.min}
              maxMinutes={FOCUS_GOAL_MINUTES.max}
              value={focusMin}
              onChange={(m) => update({ dailyFocusMinutes: m })}
            />
          ) : null}
        </View>

        <View style={s.card}>
          <TouchableOpacity
            style={[s.head, screenOpen ? s.headOpen : null]}
            activeOpacity={0.7}
            onPress={() => setScreenOpen((v) => !v)}
          >
            <Text style={s.label}>하루 스크린타임 목표</Text>
            <View style={s.valueWrap}>
              <Text style={s.value}>{goalLabel(screenMin)} 이하</Text>
              <Ionicons
                name={screenOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={T.inkMuted}
              />
            </View>
          </TouchableOpacity>
          {screenOpen ? (
            <DurationDrumPicker
              minMinutes={USAGE_GOAL_MINUTES.min}
              maxMinutes={USAGE_GOAL_MINUTES.max}
              value={screenMin}
              onChange={(m) => update({ usageGoalMinutes: m })}
            />
          ) : null}
        </View>
      </View>

      {/* '다음'이 왜 잠겨 있는지 알려 주는 한 줄 — 둘 다 정하면 사라진다. */}
      {!focusSet || !screenSet ? (
        <Text style={s.hint}>두 목표를 모두 정하면 다음으로 넘어갈 수 있어요.</Text>
      ) : null}
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
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // 펼쳤을 때만 아래 피커와의 간격 — 접힘 상태에선 카드가 한 줄로 붙는다.
  headOpen: { marginBottom: T.space.lg },
  label: { ...T.text.caption, fontWeight: '700', color: T.ink },
  valueWrap: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm },
  value: { ...T.text.subtitle, fontWeight: '800', color: T.accent },
  hint: {
    ...T.text.caption,
    color: T.inkMuted,
    textAlign: 'center',
    marginTop: T.space.lg,
  },
});
