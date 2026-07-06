import { useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import type { LoginResult } from '@/types/api';
import { getDefaultSubjects } from '@/constants/focusCategories';
import LoginScreen from '@/v2/screens/LoginScreen';
import OnboardingSplash from './OnboardingSplash';
import { OnboardingProgressContext } from '@/v2/screens/onboarding/components/OnboardingProgressContext';
import TogetherEffectStep from '@/v2/screens/onboarding/steps/TogetherEffectStep';
import EffectStatsStep from '@/v2/screens/onboarding/steps/EffectStatsStep';
import ProblemEmpathyStep from '@/v2/screens/onboarding/steps/ProblemEmpathyStep';
import FocusCategoryStep from '@/v2/screens/onboarding/steps/FocusCategoryStep';
import SubjectEditStep from '@/v2/screens/onboarding/steps/SubjectEditStep';
import LiveRankingStep from '@/v2/screens/onboarding/steps/LiveRankingStep';
import SubjectCompareStep from '@/v2/screens/onboarding/steps/SubjectCompareStep';
import PhoneManageStep from '@/v2/screens/onboarding/steps/PhoneManageStep';
import UsageGuessStep from '@/v2/screens/onboarding/steps/UsageGuessStep';
import ScreenTimePermissionStep from '@/v2/screens/onboarding/steps/ScreenTimePermissionStep';
import ScreenTimeDeniedStep from '@/v2/screens/onboarding/steps/ScreenTimeDeniedStep';
import YesterdayScreenTimeStep from '@/v2/screens/onboarding/steps/YesterdayScreenTimeStep';
import NicknameStep from '@/v2/screens/onboarding/steps/NicknameStep';
import GoalSettingStep from '@/v2/screens/onboarding/steps/GoalSettingStep';
import NotificationPermissionStep from '@/v2/screens/onboarding/steps/NotificationPermissionStep';
import GromoStartStep from '@/v2/screens/onboarding/steps/GromoStartStep';
import { INITIAL_ONBOARDING_DATA, type StepProps, type V2OnboardingData } from './types';
import type { OnboardingCompleteStatus, OnboardingResult } from './types';

// v2 신규 유저 온보딩 플로우 컨트롤러 (V3 재구성).
// 순서(HTML V3 동일): W1 오프닝 → W2 효과 → W3 공감 → W4 목표 → W5 과목 → W6 랭킹 →
//   W7 비교 → W8 관리 → W9 자가추측 → W10 권한 →(거부 시 W10-1)→ W11 전날(허용만) →
//   닉네임 → W12 목표설정 → W13 알림 → W14 시작 → W15 로그인(마지막).
// 동적 분기:
//   - W5 과목 편집: 선택 카테고리에 추천 과목이 있을 때만 삽입.
//   - W10-1 제한 상태: 권한 거부(screenTimeGranted === false)일 때만 삽입.
//   - W11 전날 스크린타임: 권한 거부면 데이터가 없어 스킵(허용일 때만).
// 서버 전송·게이팅은 호출부(App)가 담당 — 이 컴포넌트는 수집 + 검증 실패 시 재입력 UI를 맡는다.
// 가입 확정(onComplete)은 결과를 돌려받아, 닉네임 중복(409)·일시 오류면 닉네임 화면으로
// 되돌려 재입력/재시도한다(GROMO-618 — 온보딩은 로그인 전이라 실시간 중복확인이 불가,
// 서버 검증은 로그인 직후 프로필 등록 시점에 확정).
interface OnboardingFlowProps {
  onComplete: (result: OnboardingResult) => Promise<OnboardingCompleteStatus>;
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<V2OnboardingData>(INITIAL_ONBOARDING_DATA);
  const [skipped, setSkipped] = useState(false);
  // 진입 스플래시(캐릭터 + GROMO) — 노출·페이드아웃은 스플래시가 관리, 끝나면 온보딩(W1)으로.
  const [showSplash, setShowSplash] = useState(true);
  // 가입 확정 실패 상태 — 로그인은 이미 끝났으므로(세션 발급) 로그인 결과를 들고
  // 닉네임 재입력 화면만 다시 띄운다. serverError는 입력을 고치면 지운다.
  const [pendingLogin, setPendingLogin] = useState<LoginResult | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (patch: Partial<V2OnboardingData>) => setData((d) => ({ ...d, ...patch }));
  const next = () => setIndex((i) => i + 1);
  const back = () => setIndex((i) => Math.max(0, i - 1));

  // 뒤로가기 = 화면 왼쪽 가장자리에서 오른쪽으로 스와이프(다음은 버튼). 첫 스텝은 무시.
  // 가장자리(24px)에서 시작한 수평 제스처만 인식 — 슬라이더·세로 스크롤과 충돌 방지.
  const indexRef = useRef(index);
  indexRef.current = index;
  const swipeBack = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        indexRef.current > 0 && g.x0 < 24 && g.dx > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 60 && Math.abs(g.dx) > Math.abs(g.dy)) back();
      },
    }),
  ).current;

  const steps = useMemo<ComponentType<StepProps>[]>(() => {
    const hasSubjects = getDefaultSubjects(data.focusCategory).length > 0;
    const denied = data.screenTimeGranted === false;
    return [
      TogetherEffectStep, // W1
      EffectStatsStep, // W2
      ProblemEmpathyStep, // W3
      FocusCategoryStep, // W4
      ...(hasSubjects ? [SubjectEditStep] : []), // W5
      LiveRankingStep, // W6
      SubjectCompareStep, // W7
      PhoneManageStep, // W8
      UsageGuessStep, // W9
      ScreenTimePermissionStep, // W10
      ...(denied ? [ScreenTimeDeniedStep] : [YesterdayScreenTimeStep]), // W10-1 or W11
      NicknameStep, // 닉네임·캐릭터
      GoalSettingStep, // W12
      NotificationPermissionStep, // W13
      GromoStartStep, // W14
    ];
  }, [data.focusCategory, data.screenTimeGranted]);

  // 마지막 = W15 로그인. '이미 계정이 있어요'(W1·W2)는 여기로 바로 점프하며 skipped 표시
  // (수집값이 없어 App이 프로필을 덮어쓰지 않도록).
  const skipToLogin = () => {
    setSkipped(true);
    setIndex(steps.length);
  };

  // 로그인 후 가입 확정 — 호출부(App)가 프로필 등록(닉네임 중복 검증 포함)까지 마쳐야 'ok'.
  // 'ok'면 호출부가 유저 상태를 세팅해 이 컴포넌트는 언마운트된다.
  const submit = async (login: LoginResult) => {
    setSubmitting(true);
    const status = await onComplete({ data, login, skipped });
    if (status === 'ok') return;
    setPendingLogin(login);
    setServerError(
      status === 'nickname-duplicate'
        ? '이미 사용 중인 닉네임이에요. 다른 닉네임을 입력해 주세요.'
        : '일시적인 오류로 등록하지 못했어요. 다시 시도해 주세요.',
    );
    setSubmitting(false);
  };

  if (showSplash) return <OnboardingSplash onDone={() => setShowSplash(false)} />;

  // 가입 확정 실패 — 닉네임 재입력/재시도. '다음'이 같은 로그인 세션으로 등록을 재시도한다.
  if (pendingLogin) {
    return (
      <NicknameStep
        data={data}
        update={(patch) => {
          if (serverError) setServerError(null);
          update(patch);
        }}
        onNext={() => submit(pendingLogin)}
        serverError={serverError}
        submitting={submitting}
      />
    );
  }

  if (index >= steps.length) {
    return <LoginScreen onLogin={(login: LoginResult) => submit(login)} />;
  }

  const Step = steps[index];
  return (
    <OnboardingProgressContext.Provider value={{ current: index, total: steps.length }}>
      <View style={styles.flex} {...swipeBack.panHandlers}>
        <Step
          data={data}
          update={update}
          onNext={next}
          onBack={index > 0 ? back : undefined}
          onSkipToLogin={skipToLogin}
        />
      </View>
    </OnboardingProgressContext.Provider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
