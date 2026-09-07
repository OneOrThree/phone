import type { LoginResult } from '@/types/api';
import type { Occupation } from '@/types/dto/user';

// v2 신규 유저 온보딩(V3 재구성)이 수집하는 데이터.
// 서버 계약(@/types/api OnboardingData)과의 매핑:
//  - usageGoalMinutes  → dailyScreenTimeGoalMinutes (서버 있음)
//  - dailyFocusMinutes → dailyFocusTimeGoalMinutes  (서버 있음)
//  - nickname          → nickname                   (서버 있음)
//  - focusCategory        → occupation (PATCH /users/me/occupation)
//  - subjects 는 서버 계약 미정(신규 필드) — 로컬 보관, 백엔드 협의 대상.
export interface V2OnboardingData {
  focusCategory: Occupation | null; // 준비 시험 code — 정본(리그 매칭·서버 occupation)
  focusCategoryLabel: string | null; // 선택 시점의 표시명(앱 i18n 우선, displayNameOf) — 이후 스텝 문구용
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
  focusCategoryLabel: null,
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
// 기존 계정 여부는 isExistingAccount(login)로 판별(프로필 덮어쓰기 금지).
export interface OnboardingResult {
  data: V2OnboardingData;
  login: LoginResult;
}

// 기존 계정(프로필 등록까지 마친 계정) 판별 — GROMO-1637.
// isNewUser === false만으로는 부족하다: 계정 생성(중간 로그인)과 프로필 등록(온보딩 끝
// POST /users/me) 사이에 이탈한 '유령 계정'도 재로그인 시 isNewUser=false로 돌아와,
// 남은 온보딩이 스킵되고 영구히 닉네임 없이 남는다. postAuthSave가 기존 계정 로그인에
// GET /users/me를 병합하므로 nickname 존재가 프로필 등록 완료의 신호다
// (trim은 GROMO-1215 이전 빈 문자열 닉네임 레거시 방어). 게스트는 항상 isNewUser=true라 무관.
// 병합이 비인증 장애로 실패한 경우(profileUnverified)는 미등록 단정이 불가 — 중간 로그인은
// 판정 전에 재조회하고 그마저 실패하면 재시도를 유도해 여기까지 안 온다(OnboardingFlow).
// 그래도 도달하면 기존 계정으로 보수 판정 — 신규 취급(프로필 덮어쓰기)보다 안전한 최후 방어.
export function isExistingAccount(login: LoginResult): boolean {
  if (login.isNewUser !== false) return false;
  if (login.profileUnverified) return true;
  return !!login.nickname?.trim();
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
