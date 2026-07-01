import type { LoginResult } from '@/types/api';

// v2 신규 유저 온보딩이 수집하는 데이터.
// 기존 OnboardingData(@/types/api, 서버 계약)와의 매핑:
//  - usageGoalMinutes → dailyScreenTimeGoalMinutes (서버 있음)
//  - nickname         → nickname                   (서버 있음)
//  - focusCategory / dailyFocusMinutes 는 서버 계약 미정(신규 필드) — 백엔드 협의 대상.
//  - 성별/생일(시안 06)은 이번 플로우 범위 밖이라 미수집.
export interface V2OnboardingData {
  screenTimeGranted: boolean | null; // 09 스크린타임 권한 결과 (null=아직 안 물어봄)
  manualYesterdayMinutes: number | null; // 09b 권한거부 시 직접 입력한 어제 사용시간 → 12 기준값
  usageGoalMinutes: number | null; // 12 하루 목표 사용시간 (60~600분)
  nickname: string; // 15 닉네임
  focusCategory: string | null; // 16 목표 선택(리그 매칭용)
  dailyFocusMinutes: number | null; // 17 하루 목표 집중시간 (30~600분)
}

export const INITIAL_ONBOARDING_DATA: V2OnboardingData = {
  screenTimeGranted: null,
  manualYesterdayMinutes: null,
  usageGoalMinutes: null,
  nickname: '',
  focusCategory: null,
  dailyFocusMinutes: null,
};

// 온보딩 완료 결과 — 마지막 로그인(14)까지 끝낸 뒤 호출부(App)로 전달.
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
}
