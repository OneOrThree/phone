import { createContext, useContext } from 'react';
import type { OnboardingStepName } from '@/services/analyticsEvents';

// 현재 온보딩 스텝 이름 — 컨트롤러(OnboardingFlow)가 제공, StepScaffold가 CTA 계측에 사용(GROMO-1605).
//
// 스텝 컴포넌트에 prop으로 내리지 않고 컨텍스트로 둔 이유: CTA는 12개 스텝이 공유하는
// StepScaffold 하나에 있는데, prop 방식이면 스텝 파일 12개를 전부 고쳐야 하고
// 새 스텝을 추가할 때마다 또 빠뜨린다. 컨트롤러가 이미 아는 값을 한 곳에서 흘려보낸다.
//
// null이면 온보딩 플로우 밖(StepScaffold 단독 사용)이라 계측을 발행하지 않는다.
export const OnboardingStepContext = createContext<OnboardingStepName | null>(null);

export const useOnboardingStepName = (): OnboardingStepName | null =>
  useContext(OnboardingStepContext);
