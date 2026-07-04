import type { LoginResult } from '@/types/api';

// v2 신규 유저 온보딩(V3 재구성)이 수집하는 데이터.
// 서버 계약(@/types/api OnboardingData)과의 매핑:
//  - usageGoalMinutes  → dailyScreenTimeGoalMinutes (서버 있음)
//  - dailyFocusMinutes → dailyFocusTimeGoalMinutes  (서버 있음)
//  - nickname          → nickname                   (서버 있음)
//  - focusCategory / subjects 는 서버 계약 미정(신규 필드) — 로컬 보관, 백엔드 협의 대상.
export interface V2OnboardingData {
  focusCategory: string | null; // W4 목표 선택(리그 매칭용)
  subjects: string[]; // W5 과목 확인·편집 결과
  guessedYesterdayMinutes: number | null; // W9 어제 사용 자가 추측(분)
  screenTimeGranted: boolean | null; // W10 스크린타임 권한 결과 (null=아직 안 물어봄)
  screenTimeSelectionConfigured: boolean; // W10 측정 대상(앱) picker 완료 여부
  manualYesterdayMinutes: number | null; // (구) 권한거부 수동 입력 — V3에서 W9 자가추측으로 대체 예정
  nickname: string; // 닉네임·캐릭터 화면
  usageGoalMinutes: number | null; // W12 하루 스크린타임 목표(60~600분)
  dailyFocusMinutes: number | null; // W12 하루 집중 목표(30~600분)
  notificationGranted: boolean | null; // W13 알림 권한 결과 (null=아직 안 물어봄)
}

export const INITIAL_ONBOARDING_DATA: V2OnboardingData = {
  focusCategory: null,
  subjects: [],
  guessedYesterdayMinutes: null,
  screenTimeGranted: null,
  screenTimeSelectionConfigured: false,
  manualYesterdayMinutes: null,
  nickname: '',
  usageGoalMinutes: null,
  dailyFocusMinutes: null,
  notificationGranted: null,
};

// 온보딩 완료 결과 — 마지막 로그인(W15)까지 끝낸 뒤 호출부(App)로 전달.
export interface OnboardingResult {
  data: V2OnboardingData;
  login: LoginResult | null; // null = '로그인 없이 시작하기'(게스트)
}

// 입력 스텝 공통 props — 모든 화면이 이 계약을 따른다.
export interface StepProps {
  data: V2OnboardingData;
  update: (patch: Partial<V2OnboardingData>) => void;
  onNext: () => void;
  onBack?: () => void; // 첫 스텝은 없음
  onSkipToLogin?: () => void; // '이미 계정이 있어요' — 온보딩 건너뛰고 로그인으로(W1·W2)
}
