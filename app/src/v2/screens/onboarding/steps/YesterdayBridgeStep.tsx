import StepScaffold from '@/v2/screens/onboarding/StepScaffold';
import type { StepProps } from '@/v2/screens/onboarding/types';

// 08 · 어제 사용 환기 (브릿지) — 입력 없음. 동기부여 후 다음으로.
// TODO(시안 08): 폰 일러스트(어두운 화면 '?시간') + 글로우. 본문 children 으로 채우기.
export default function YesterdayBridgeStep({ onNext, onBack }: StepProps) {
  return (
    <StepScaffold
      title={'잠깐,\n어제 핸드폰을\n얼마나 썼나요?'}
      subtitle={'생각보다 많을지도 몰라요.\n지금 바로 확인해볼게요.'}
      ctaLabel="어제 사용 시간 보기"
      onCta={onNext}
      onBack={onBack}
    />
  );
}
