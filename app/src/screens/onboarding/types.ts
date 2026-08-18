import type { LoginResult } from '@/types/api';

// v2 신규 유저 온보딩(V3 재구성)이 수집하는 데이터.
// 서버 계약(@/types/api OnboardingData)과의 매핑:
//  - usageGoalMinutes  → dailyScreenTimeGoalMinutes (서버 있음)
//  - dailyFocusMinutes → dailyFocusTimeGoalMinutes  (서버 있음)
//  - nickname          → nickname                   (서버 있음)
//  - focusCategory / subjects 는 서버 계약 미정(신규 필드) — 로컬 보관, 백엔드 협의 대상.
export interface V2OnboardingData {
  focusCategory: string | null; // 집중 카테고리 선택(리그 매칭용)
  subjects: string[]; // 과목 확인·편집 결과
  guessedYesterdayMinutes: number | null; // 어제 사용 자가 추측(분) — 현재 플로우 미수집(스텝 보류)
  screenTimeGranted: boolean | null; // 스크린타임 권한 결과 (null=아직 안 물어봄)
  screenTimeSelectionConfigured: boolean; // 측정 대상(앱) picker 완료 여부
  nickname: string; // 닉네임·캐릭터 화면
  // 누끼 체험(CutoutStep)에서 만든 캐릭터 file:// 경로(캐시버스트 쿼리 포함) — 완료 시 App이
  // CharacterContext에 시드한다(자동 장착은 안 함). 미완료면 undefined.
  cutoutCharacterUri?: string;
  usageGoalMinutes: number | null; // 하루 스크린타임 목표(60~600분)
  dailyFocusMinutes: number | null; // 하루 집중 목표(30~600분)
  notificationGranted: boolean | null; // 알림 권한 결과 (null=아직 안 물어봄) — 현재 플로우 미수집(스텝 보류)
}

export const INITIAL_ONBOARDING_DATA: V2OnboardingData = {
  focusCategory: null,
  subjects: [],
  guessedYesterdayMinutes: null,
  screenTimeGranted: null,
  screenTimeSelectionConfigured: false,
  nickname: '',
  usageGoalMinutes: null,
  dailyFocusMinutes: null,
  notificationGranted: null,
};

// 온보딩 완료 결과 — 중간 로그인 세션과 수집 데이터를 호출부(App)로 전달.
// 게스트 로그인도 백엔드 POST /auth/guest로 실제 JWT 세션을 발급받아
// 오므로(auth.ts guestLogin) login은 항상 유효한 LoginResult — 소셜/게스트 구분 없음.
// 기존 계정 여부는 login.isNewUser === false로 판별(프로필 덮어쓰기 금지).
export interface OnboardingResult {
  data: V2OnboardingData;
  login: LoginResult;
}

// 가입 확정 결과 — 호출부(App)가 프로필 등록(POST /users/me)까지 마친 뒤 돌려준다.
//  - ok: 완료(호출부가 유저 상태를 세팅해 홈으로 진입)
//  - nickname-duplicate: 닉네임 중복(409 NICKNAME_DUPLICATE) → 닉네임 재입력
//  - error: 네트워크 등 일시 오류 → 같은 닉네임으로 재시도
export type OnboardingCompleteStatus = 'ok' | 'nickname-duplicate' | 'error';

// 입력 스텝 공통 props — 모든 화면이 이 계약을 따른다.
export interface StepProps {
  data: V2OnboardingData;
  update: (patch: Partial<V2OnboardingData>) => void;
  onNext: () => void;
  onBack?: () => void; // 첫 스텝은 없음
}
