import StepScaffold from '@/v2/screens/onboarding/StepScaffold';
import GoalPlaceholder from '@/v2/screens/onboarding/_GoalPlaceholder';
import type { StepProps } from '@/v2/screens/onboarding/types';

// 12 · 하루 목표 사용시간 — usageGoalMinutes(60~600분). 서버: dailyScreenTimeGoalMinutes 로 매핑.
// TODO(시안 12): 원형 게이지(되찾는 시간 +N년) + 슬라이더(1~10시간) + 현재(9.4년)/목표 비교 카드.
const MIN = 60;
const MAX = 600;
const STEP = 10;
const DEFAULT = 240;

export default function UsageGoalStep({ data, update, onNext, onBack }: StepProps) {
  const value = data.usageGoalMinutes ?? DEFAULT;
  return (
    <StepScaffold
      title="하루 목표 사용시간"
      subtitle="줄일수록 인생에서 되찾는 시간이 커져요."
      ctaLabel="이 목표로 시작"
      onCta={() => {
        update({ usageGoalMinutes: value });
        onNext();
      }}
      onBack={onBack}
    >
      <GoalPlaceholder
        unit="사용"
        minutes={value}
        min={MIN}
        max={MAX}
        step={STEP}
        onChange={(m) => update({ usageGoalMinutes: m })}
      />
    </StepScaffold>
  );
}
