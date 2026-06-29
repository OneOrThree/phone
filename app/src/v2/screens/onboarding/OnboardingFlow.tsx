import { useState } from 'react';
import type { ComponentType } from 'react';
import type { LoginResult } from '@/types/api';
import LoginScreen from '@/v2/screens/LoginScreen';
import YesterdayBridgeStep from '@/v2/screens/onboarding/steps/YesterdayBridgeStep';
import ScreenTimePermissionStep from '@/v2/screens/onboarding/steps/ScreenTimePermissionStep';
import UsageGoalStep from '@/v2/screens/onboarding/steps/UsageGoalStep';
import NicknameStep from '@/v2/screens/onboarding/steps/NicknameStep';
import FocusCategoryStep from '@/v2/screens/onboarding/steps/FocusCategoryStep';
import FocusGoalStep from '@/v2/screens/onboarding/steps/FocusGoalStep';
import { INITIAL_ONBOARDING_DATA, type StepProps, type V2OnboardingData } from './types';
import type { OnboardingResult } from './types';

// v2 신규 유저 온보딩 플로우 컨트롤러.
// 순서: 08 어제사용 → 09 권한 → 12 목표 사용시간 → 15 닉네임 → 16 목표선택 → 17 목표 집중시간 → 14 로그인(마지막)
// 게스트로 정보를 모두 모은 뒤 마지막에 로그인. 수집데이터 + 로그인/게스트 결과를 onComplete 로 넘긴다.
// 서버 전송·게이팅은 호출부(App)가 담당 — 이 컴포넌트는 '수집'만 한다.
interface OnboardingFlowProps {
  onComplete: (result: OnboardingResult) => void;
}

// 입력 스텝 순서 (로그인은 별도 — 항상 마지막). 화면 추가/순서변경은 이 배열만 고치면 됨.
const STEPS: ComponentType<StepProps>[] = [
  YesterdayBridgeStep, // 08
  ScreenTimePermissionStep, // 09
  UsageGoalStep, // 12
  NicknameStep, // 15
  FocusCategoryStep, // 16
  FocusGoalStep, // 17
];

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<V2OnboardingData>(INITIAL_ONBOARDING_DATA);

  const update = (patch: Partial<V2OnboardingData>) => setData((d) => ({ ...d, ...patch }));
  const next = () => setIndex((i) => i + 1);
  const back = () => setIndex((i) => Math.max(0, i - 1));

  // 입력 스텝을 모두 지나면 마지막 = 14 로그인.
  if (index >= STEPS.length) {
    return (
      <LoginScreen
        onLogin={(login: LoginResult) => onComplete({ data, login })}
        onGuestStart={() => onComplete({ data, login: null })}
      />
    );
  }

  const Step = STEPS[index];
  return <Step data={data} update={update} onNext={next} onBack={index > 0 ? back : undefined} />;
}
