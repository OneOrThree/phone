import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { PanResponder, StyleSheet } from 'react-native';
import type { GestureResponderHandlers } from 'react-native';
import Animated from 'react-native-reanimated';
import type { LoginResult } from '@/types/api';
import LoginScreen from '@/screens/LoginScreen';
import OnboardingSplash from './OnboardingSplash';
import { wasOtaSplashJustShown } from '@/utils/otaGate';
import { OnboardingProgressContext } from '@/screens/onboarding/components/OnboardingProgressContext';
import TogetherEffectStep from '@/screens/onboarding/steps/TogetherEffectStep';
import ProblemEmpathyStep from '@/screens/onboarding/steps/ProblemEmpathyStep';
import FocusCategoryStep from '@/screens/onboarding/steps/FocusCategoryStep';
import SubjectEditStep from '@/screens/onboarding/steps/SubjectEditStep';
import SubjectCompareStep from '@/screens/onboarding/steps/SubjectCompareStep';
import ScreenTimePermissionStep from '@/screens/onboarding/steps/ScreenTimePermissionStep';
import ScreenTimeDeniedStep from '@/screens/onboarding/steps/ScreenTimeDeniedStep';
import GoalSettingStep from '@/screens/onboarding/steps/GoalSettingStep';
import CharacterIntroStep from '@/screens/onboarding/steps/CharacterIntroStep';
import CutoutStep from '@/screens/onboarding/steps/CutoutStep';
import NicknameStep from '@/screens/onboarding/steps/NicknameStep';
import { hapticLight, hapticMedium } from '@/utils/haptics';
import { fadeIn } from '@/constants/motion';
import { useMotion } from '@/hooks/useMotion';
import { INITIAL_ONBOARDING_DATA, type StepProps, type V2OnboardingData } from './types';
import type { OnboardingCompleteStatus, OnboardingResult } from './types';
import {
  logOnboardingStarted,
  logOnboardingCompleted,
  logOnboardingStepViewed,
} from '@/services/analyticsEvents';
import type { OnboardingStepName } from '@/services/analyticsEvents';

// v2 신규 유저 온보딩 플로우 컨트롤러.
// 순서: 스플래시 → 집중시작 → 함께집중 → 성장기록 → [로그인] → 집중카테고리 →
//   (과목편집) → 스크린타임 권한 → (거부 시 제한 안내) → 목표설정 → 닉네임(가입 확정).
// 로그인은 플로우 '중간'에 위치 — 성공 시:
//   - 기존 계정(isNewUser === false): 남은 스텝을 건너뛰고 즉시 가입 확정(홈 진입).
//   - 신규: LoginResult를 보관하고 프로필 수집 스텝을 계속 진행, 마지막 닉네임 뒤 가입 확정.
// 동적 분기:
//   - 과목 편집: 선택 카테고리에 추천 과목이 있을 때만 삽입.
//   - 스크린타임: 권한 거부면 제한 화면(Denied)을 삽입하고, 허용이면 목표 설정으로 직행.
// 가입 확정(onComplete)은 신규 유저의 닉네임 검증(409 중복)·일시 오류면 닉네임 화면으로
// 되돌려 재입력/재시도한다(GROMO-618). 세션(토큰/유저)은 auth.ts가 로그인 즉시 저장하나,
// 온보딩을 유지하기 위해 홈 전환(setUser)은 가입 확정 시점까지 미룬다.
interface OnboardingFlowProps {
  // LoginScreen이 완료 처리(서버 동기화)까지 await하도록 Promise 체인을 그대로 이어주고,
  // 결과 상태를 돌려받아 닉네임 재입력/재시도를 분기한다.
  onComplete: (result: OnboardingResult) => Promise<OnboardingCompleteStatus>;
}

// 플로우 노드 — 입력 스텝 / 중간 로그인 / 마지막 닉네임(가입 확정 지점).
// subStep: 동적으로 끼어드는 보조 스텝(과목 확인) — 진행바에서 직전 스텝과 같은 칸을 공유한다.
// name: 스텝 도달 계측(onboarding_step_viewed)용 식별자 — login/nickname 노드는 kind가 곧 이름.
type FlowNode =
  | {
      kind: 'step';
      name: OnboardingStepName;
      Component: ComponentType<StepProps>;
      subStep?: boolean;
    }
  | { kind: 'login' }
  | { kind: 'nickname' };

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<V2OnboardingData>(INITIAL_ONBOARDING_DATA);
  // 진입 스플래시(캐릭터 + GROMO) — 노출·페이드아웃은 스플래시가 관리, 끝나면 온보딩으로.
  // 릴리즈에선 OTA 준비 화면(같은 비주얼, @/utils/otaGate)이 방금 떴으므로 건너뛴다(GROMO-875).
  // '방금'(15초 시효) 판정이라 로그아웃·탈퇴 후 재온보딩에선 스플래시가 정상 노출된다.
  const [showSplash, setShowSplash] = useState(() => !wasOtaSplashJustShown());
  // 중간 로그인에서 받은 세션 — 신규 유저는 이걸 들고 남은 스텝을 진행, 닉네임 뒤 가입 확정에 사용.
  const [login, setLogin] = useState<LoginResult | null>(null);
  // 가입 확정(신규 유저) 실패 상태 — 닉네임 화면에 에러를 띄운다. 입력을 고치면 지운다.
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 화면 전환 **페이드 인**(GROMO-1381). 래퍼에 stepKey를 걸어 화면이 바뀔 때마다 새로
  // 마운트시키고 fadeIn을 다시 태운다(CSS 애니메이션은 참조 동등성으로 재시작을 판단하므로
  // 같은 프리셋 객체만으로는 다시 돌지 않는다).
  //
  // ⚠️ 이름이 '크로스페이드'가 아니다 — React가 이전 노드를 즉시 언마운트하므로 퇴장 페이드는
  //    없다(codex 리뷰). 진짜 크로스페이드(두 스텝을 겹쳐 유지)는 **의도적으로 채택하지 않았다**:
  //    스텝들이 마운트 시 부수효과를 낸다(FocusCategoryStep의 추천 과목 조회,
  //    ScreenTimePermissionStep의 권한 요청, NicknameStep의 입력 포커스).
  //    220ms 동안 두 스텝이 동시에 살아 있으면 이것들이 겹쳐 발화하고 포커스 순서도 흔들린다 —
  //    온보딩은 첫인상 화면이자 Maestro 커버리지가 가장 많은 곳이라 그 위험을 지지 않는다.
  //
  //    단방향 페이드가 '배경 번쩍임'으로 보이지 않는 근거: 앱은 라이트 모드 고정이고
  //    (app.config.js userInterfaceStyle:'light' · Info.plist UIUserInterfaceStyle:Light)
  //    루트 뷰와 StepScaffold·LoginScreen의 배경이 모두 T.paper(#FFFFFF)다. 즉 뒤에 드러나는
  //    것은 '다른 색'이 아니라 같은 흰 종이이고, 보이는 변화는 내용의 불투명도뿐이다.
  //
  // 뷰를 새로 끼우지 않고 기존 래퍼를 승격만 했다 — Maestro 셀렉터(스텝 testID)는 전부
  // StepScaffold 안쪽이라 트리 계약은 그대로다. 실제 진입 스타일은 StepFade가 정한다.

  // 플로우 진입 계측 — 스플래시 포함 마운트 시 1회(플로우는 이미 시작됨).
  useEffect(() => {
    logOnboardingStarted();
  }, []);

  // OTA 준비 화면이 스플래시를 대신한 경우에도 시작 진동(GROMO-786)은 유지한다 —
  // 스플래시 경로에선 OnboardingSplash.onDone이 울리므로 스킵 마운트에서만 1회.
  useEffect(() => {
    if (!showSplash) hapticLight();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 초기 스킵 여부만 판단
  }, []);

  const update = (patch: Partial<V2OnboardingData>) => setData((d) => ({ ...d, ...patch }));
  // 스텝 전환마다 중간 세기 진동(GROMO-786) — next/back 공통.
  const next = () => {
    hapticMedium();
    setIndex((i) => i + 1);
  };

  const sequence = useMemo<FlowNode[]>(() => {
    // 추천 과목은 FocusCategoryStep이 서버(GET /tag/defaults)에서 받아 data.subjects에 채운다.
    // 과목이 있을 때만 '과목 확인' 스텝을 끼운다(추천 과목 없는 카테고리는 건너뜀).
    const hasSubjects = data.subjects.length > 0;
    const denied = data.screenTimeGranted === false;
    const step = (name: OnboardingStepName, Component: ComponentType<StepProps>): FlowNode => ({
      kind: 'step',
      name,
      Component,
    });
    return [
      step('problem_empathy', ProblemEmpathyStep),
      step('together_effect', TogetherEffectStep),
      step('subject_compare', SubjectCompareStep),
      { kind: 'login' },
      step('focus_category', FocusCategoryStep),
      ...(hasSubjects
        ? [
            {
              kind: 'step',
              name: 'subject_edit',
              Component: SubjectEditStep,
              subStep: true,
            } as const,
          ]
        : []),
      step('screentime_permission', ScreenTimePermissionStep),
      ...(denied ? [step('screentime_denied', ScreenTimeDeniedStep)] : []),
      step('goal_setting', GoalSettingStep),
      // 캐릭터 소개 → 누끼 체험 → 닉네임. 소개에서 기본 그로몬을 처음 만나고, 체험에서
      // 내 물건으로 캐릭터를 만들거나 건너뛴 뒤 마지막에 이름을 짓는다.
      step('character_intro', CharacterIntroStep),
      step('cutout_experience', CutoutStep),
      { kind: 'nickname' },
    ];
  }, [data.subjects, data.screenTimeGranted]);

  // 스텝 도달 계측(GA4 퍼널) — 스플래시가 끝난 뒤, 이 플로우에서 처음 도달한 스텝만 발행한다.
  // dedup은 인덱스가 아니라 "스텝 이름" 기준 — 뒤로가기 재방문은 미발행하되, 같은 인덱스가
  // 다른 스텝으로 교체되는 동적 분기(예: 거부 화면에서 권한 허용 → 목표 설정으로 교체)는
  // 새 스텝 도달로 정상 발행한다(코덱스 리뷰).
  const viewedStepsRef = useRef(new Set<OnboardingStepName>());
  useEffect(() => {
    if (showSplash) return;
    const reached = sequence[index];
    const step = reached.kind === 'step' ? reached.name : reached.kind;
    if (viewedStepsRef.current.has(step)) return;
    viewedStepsRef.current.add(step);
    logOnboardingStepViewed({ step, step_index: index });
  }, [showSplash, index, sequence]);

  // 로그인 노드 위치 — 인증 후 뒤로가기 하한(로그인 이전 화면 복귀 방지)을 계산한다.
  const loginIndex = sequence.findIndex((n) => n.kind === 'login');
  const backFloor = login ? loginIndex + 1 : 0;
  const backFloorRef = useRef(backFloor);
  backFloorRef.current = backFloor;

  const back = () => {
    hapticMedium();
    setIndex((i) => Math.max(backFloorRef.current, i - 1));
  };

  // 뒤로가기 = 화면 왼쪽 가장자리에서 오른쪽으로 스와이프(다음은 버튼). 하한 이하는 무시.
  // 가장자리(24px)에서 시작한 수평 제스처만 인식 — 슬라이더·세로 스크롤과 충돌 방지.
  const indexRef = useRef(index);
  indexRef.current = index;
  const swipeBack = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        indexRef.current > backFloorRef.current &&
        g.x0 < 24 &&
        g.dx > 12 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 60 && Math.abs(g.dx) > Math.abs(g.dy)) back();
      },
    }),
  ).current;

  // 가입 확정 — 호출부(App)가 프로필 등록(신규 유저의 닉네임 중복 검증 포함)까지 마쳐야 'ok'.
  // 'ok'면 App이 유저 상태를 세팅해 이 컴포넌트는 언마운트된다. 실패면 닉네임 화면에 에러 표시.
  const finalize = async (loginResult: LoginResult) => {
    setSubmitting(true);
    try {
      const status = await onComplete({ data, login: loginResult });
      if (status === 'ok') {
        // 기존 계정(재로그인)은 온보딩을 거치지 않았으니 완료로 계측하지 않는다.
        if (loginResult.isNewUser !== false) logOnboardingCompleted();
        return;
      }
      setServerError(
        status === 'nickname-duplicate'
          ? '이미 사용 중인 닉네임이에요. 다른 닉네임을 입력해 주세요.'
          : '일시적인 오류로 등록하지 못했어요. 다시 시도해 주세요.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // 중간 로그인 성공 — 기존 계정이면 즉시 확정(홈 진입), 신규면 세션을 보관하고 프로필 수집 진행.
  const onMidFlowLogin = async (result: LoginResult) => {
    if (result.isNewUser === false) {
      await finalize(result);
      return;
    }
    setLogin(result);
    next();
  };

  // 스플래시(GROMO) → 첫 스텝 전환 시 가벼운 진동으로 시작을 알린다.
  if (showSplash)
    return (
      <OnboardingSplash
        onDone={() => {
          hapticLight();
          setShowSplash(false);
        }}
      />
    );

  const node = sequence[index];
  const canBack = index > backFloor;

  // 전환 페이드의 재시작 키(GROMO-1381) — 인덱스만으로는 부족하다. 스크린타임 거부 화면에서
  // 재승인하면 screenTimeGranted가 false→true가 되면서 제한 안내 노드가 빠지고, 같은 인덱스가
  // 목표 설정 노드로 교체된다. 노드 정체성을 키에 섞어 이 교체도 새 화면으로 취급한다.
  const stepKey = `${index}:${node.kind === 'step' ? node.name : node.kind}`;

  // 진행바는 로그인 전/후 구간을 각각 처음부터 다시 채운다 — 로그인 전은 3칸 고정,
  // 로그인 후는 현재 시퀀스에서 보조 스텝을 제외해 계산한다.
  // 과목 확인(subStep)은 칸 수에서 제외해 동적으로 끼어들어도 칸 수가 흔들리지 않는다
  // (집중카테고리와 같은 칸을 공유).
  const isSubStep = (n: FlowNode) => n.kind === 'step' && !!n.subStep;
  const postLogin = sequence.slice(loginIndex + 1);
  const progress =
    index < loginIndex
      ? { current: index, total: loginIndex }
      : {
          current: postLogin.slice(0, index - loginIndex).filter((n) => !isSubStep(n)).length - 1,
          total: postLogin.filter((n) => !isSubStep(n)).length,
        };

  // 중간 로그인 화면 — 자체 전체화면 레이아웃(진행바 없음).
  // 스텝과 **같은 페이드**로 들어온다(codex 리뷰) — 같은 흐름 안에서 어떤 전환은 페이드고
  // 어떤 전환만 툭 바뀌면 그 불일치가 하드컷 하나보다 더 어색하다.
  // ⚠️ 뒤로가기 제스처(swipeBack)는 붙이지 않는다 — 로그인에서 이전 설득 화면으로 되돌아가지
  //    않는 기존 동작을 그대로 둔다(여기에 붙이면 backFloor가 0이라 스와이프가 열려 버린다).
  if (node.kind === 'login') {
    return (
      <StepFade key={stepKey}>
        <LoginScreen onLogin={onMidFlowLogin} isOnboarding />
      </StepFade>
    );
  }

  // 마지막 닉네임 — 입력 후 곧바로 가입 확정. 실패 시 이 화면에 serverError/submitting을 유지한다.
  if (node.kind === 'nickname') {
    return (
      <OnboardingProgressContext.Provider value={progress}>
        <StepFade key={stepKey} panHandlers={swipeBack.panHandlers}>
          <NicknameStep
            data={data}
            update={(patch) => {
              if (serverError) setServerError(null);
              update(patch);
            }}
            onNext={() => {
              if (login) finalize(login);
            }}
            onBack={canBack ? back : undefined}
            serverError={serverError}
            submitting={submitting}
          />
        </StepFade>
      </OnboardingProgressContext.Provider>
    );
  }

  const Step = node.Component;
  return (
    <OnboardingProgressContext.Provider value={progress}>
      <StepFade key={stepKey} panHandlers={swipeBack.panHandlers}>
        <Step data={data} update={update} onNext={next} onBack={canBack ? back : undefined} />
      </StepFade>
    </OnboardingProgressContext.Provider>
  );
}

// 스텝 진입 페이드. **진입 스타일을 '동작 줄이기'가 확정된 첫 렌더에 정하고 얼린다.**
//
// ⚠️ `useReduceMotion`은 시스템 질의가 끝나기 전까지 보수적으로 `true`를 돌려준다. 그래서
//    질의가 확정되며 `true → false`로 바뀌는 순간, 이미 화면에 떠 있던 스텝에 `fadeIn`이
//    **새로 붙는다** — 보이던 화면이 opacity 0으로 깜빡였다가 다시 나타난다(codex 리뷰).
//
// ⚠️ 그렇다고 미확정 값으로 얼려 버리면 반대 사고가 난다 — 설정을 켜지 않은 사용자도 콜드
//    스타트 첫 스텝의 연출을 영구히 잃는다. 그래서 확정 전에는 **판정을 미루고 시작 상태
//    (opacity 0)로 대기**한다. fadeIn의 시작 프레임과 같은 상태라 어느 쪽으로 확정되든
//    이어지는 그림에 끊김이 없다. 질의는 실패해도 false로 확정되므로(useReduceMotion.ts)
//    영원히 가려진 채 남지 않는다.
//
// 래퍼를 컴포넌트로 뺀 이유: 마운트 경계가 곧 얼리는 경계다. 부모(OnboardingFlow)는 스텝이
// 바뀌어도 remount되지 않으므로 부모에서 훅으로 얼리면 첫 스텝 값이 끝까지 남는다. 반면
// 래퍼는 `key={stepKey}`로 remount되므로 다음 스텝 페이드는 정상 재생된다.
function StepFade({
  children,
  panHandlers,
}: {
  children: ReactNode;
  panHandlers?: GestureResponderHandlers;
}) {
  const m = useMotion();
  const decided = useRef(false);
  const frozen = useRef<ReturnType<typeof fadeIn> | undefined>(undefined);
  if (!decided.current && m.ready) {
    decided.current = true;
    // 여기선 m.css로 충분하다 — 위 조건이 이미 m.ready를 기다리므로 m.enter의 '확정 전
    // 시작 프레임' 경로를 탈 일이 없고, 대기 상태는 styles.pendingEnter가 담당한다.
    frozen.current = m.css(fadeIn());
  }
  return (
    <Animated.View
      style={[styles.flex, decided.current ? frozen.current : styles.pendingEnter]}
      {...panHandlers}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // '동작 줄이기' 확정 대기 — fadeIn의 시작 프레임과 같은 상태다
  pendingEnter: { opacity: 0 },
});
