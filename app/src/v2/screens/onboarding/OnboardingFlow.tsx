import { useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import type { LoginResult } from '@/types/api';
import LoginScreen from '@/v2/screens/LoginScreen';
import YesterdayBridgeStep from '@/v2/screens/onboarding/steps/YesterdayBridgeStep';
import ScreenTimePermissionStep from '@/v2/screens/onboarding/steps/ScreenTimePermissionStep';
import ScreenTimeDeniedStep from '@/v2/screens/onboarding/steps/ScreenTimeDeniedStep';
import ManualUsageStep from '@/v2/screens/onboarding/steps/ManualUsageStep';
import UsageGoalStep from '@/v2/screens/onboarding/steps/UsageGoalStep';
import NicknameStep from '@/v2/screens/onboarding/steps/NicknameStep';
import FocusCategoryStep from '@/v2/screens/onboarding/steps/FocusCategoryStep';
import FocusGoalStep from '@/v2/screens/onboarding/steps/FocusGoalStep';
import { INITIAL_ONBOARDING_DATA, type StepProps, type V2OnboardingData } from './types';
import type { OnboardingResult } from './types';

// v2 신규 유저 온보딩 플로우 컨트롤러.
// 순서: 08 → 09 →(권한 거부 시 09a·09b)→ 12 → 15 → 16 → 17 → 14 로그인(마지막)
// 스텝 목록은 screenTimeGranted에 따라 동적 구성 — 09에서 거부하면 09a·09b가 끼어든다.
// 서버 전송·게이팅은 호출부(App)가 담당 — 이 컴포넌트는 '수집'만 한다.
interface OnboardingFlowProps {
  onComplete: (result: OnboardingResult) => void;
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<V2OnboardingData>(INITIAL_ONBOARDING_DATA);

  const update = (patch: Partial<V2OnboardingData>) => setData((d) => ({ ...d, ...patch }));
  const next = () => setIndex((i) => i + 1);
  const back = () => setIndex((i) => Math.max(0, i - 1));

  // 입력 스텝 순서(로그인은 별도). 권한 거부(screenTimeGranted === false)일 때만 09a·09b 삽입.
  const steps = useMemo<ComponentType<StepProps>[]>(() => {
    const denied = data.screenTimeGranted === false;
    return [
      YesterdayBridgeStep, // 08
      ScreenTimePermissionStep, // 09
      ...(denied ? [ScreenTimeDeniedStep, ManualUsageStep] : []), // 09a · 09b
      UsageGoalStep, // 12
      NicknameStep, // 15
      FocusCategoryStep, // 16
      FocusGoalStep, // 17
    ];
  }, [data.screenTimeGranted]);

  // 입력 스텝을 모두 지나면 마지막 = 14 로그인.
  if (index >= steps.length) {
    return (
      <LoginScreen
        onLogin={(login: LoginResult) => onComplete({ data, login })}
        onGuestStart={() => onComplete({ data, login: null })}
      />
    );
  }

  const Step = steps[index];
  return <Step data={data} update={update} onNext={next} onBack={index > 0 ? back : undefined} />;
}
