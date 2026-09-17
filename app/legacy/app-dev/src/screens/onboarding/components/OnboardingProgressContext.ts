import { createContext, useContext } from 'react';

// 온보딩 단계 진행도 — 컨트롤러(OnboardingFlow)가 제공, StepScaffold가 상단 진행바에 사용.
// current: 0-based 현재 스텝, total: 전체 입력 스텝 수(로그인 종단 제외).
export interface OnboardingProgress {
  current: number;
  total: number;
}

export const OnboardingProgressContext = createContext<OnboardingProgress | null>(null);

export const useOnboardingProgress = (): OnboardingProgress | null =>
  useContext(OnboardingProgressContext);
