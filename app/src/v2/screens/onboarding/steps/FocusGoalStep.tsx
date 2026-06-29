import StepScaffold from '@/v2/screens/onboarding/StepScaffold';
import GoalPlaceholder from '@/v2/screens/onboarding/_GoalPlaceholder';
import type { StepProps } from '@/v2/screens/onboarding/types';

// 17 · 하루 목표 집중시간 — dailyFocusMinutes(30~600분, 기본 240=4시간). 서버 계약 미정(신규 필드).
// TODO(시안 17): 원형 게이지(하루 목표 N시간) + 슬라이더(30분~10시간) + 주간목표(28시간)/또래평균 카드.
const MIN = 30;
const MAX = 600;
const STEP = 10;
const DEFAULT = 240;

export default function FocusGoalStep({ data, update, onNext, onBack }: StepProps) {
  const value = data.dailyFocusMinutes ?? DEFAULT;
  return (
    <StepScaffold
      title="하루 목표 집중시간"
      subtitle="많이 채울수록 좋아요. 무리하지 않을 만큼만."
      ctaLabel="이 목표로 시작"
      onCta={() => {
        update({ dailyFocusMinutes: value });
        onNext();
      }}
      onBack={onBack}
    >
      <GoalPlaceholder
        unit="집중"
        minutes={value}
        min={MIN}
        max={MAX}
        step={STEP}
        onChange={(m) => update({ dailyFocusMinutes: m })}
      />
    </StepScaffold>
  );
}
