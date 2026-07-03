// Track 1 (GA4) 타입드 이벤트 헬퍼.
// 이벤트당 얇은 함수 1개 — 호출부 타입 안전 + 이벤트명/파라미터 계약을 한 곳에 모은다.
// 화면/스토어에서는 이 헬퍼만 import해서 쓰고, track()을 직접 부르지 않는다.
//
// ⚠️ 서버(MP) 소스 이벤트([S])는 의도적으로 제외한다 — 클라에서 중복 발행하면 GA4에서 이중 집계된다.
//    (예: focus_session_completed, group_joined 등은 백엔드 Measurement Protocol이 소유)
// ⚠️ PII 금지: 닉네임/생년월일/원본 식별정보를 이벤트·유저속성으로 보내지 않는다. 파생 비식별값만.
import { track, setUserProperty } from '@/services/analytics';

// 로그인/가입 수단
export type AuthMethod = 'kakao' | 'apple' | 'google' | 'line' | 'facebook' | 'guest';

// 비식별 성별 코드 (PII 아님)
export type GenderCode = 'MALE' | 'FEMALE' | 'UNKNOWN';

// ── GA4 표준 이벤트 ── (도구 기본 리포트 자동화용)
export function logLogin(method: AuthMethod): void {
  track('login', { method });
}

export function logSignUp(method: AuthMethod): void {
  track('sign_up', { method });
}

export function logTutorialBegin(): void {
  track('tutorial_begin');
}

export function logTutorialComplete(): void {
  track('tutorial_complete');
}

// ── 온보딩 퍼널 [C] ──
// 현재 온보딩은 단일 화면 폼이므로 진입(started) / 완료(completed) 경계와
// 폼에서 수집한 프로필·목표 submit을 계측한다. 모든 이벤트에 step_index 부착(퍼널 정렬 일관).
export function logOnboardingStarted(): void {
  track('onboarding_started', { step_index: 0 });
  logTutorialBegin();
}

export function logOnboardingProfileSubmitted(p: {
  gender: GenderCode;
  age_band: string; // 예: '10s' | '20s' | '30s' | '40s' | '50s+' | 'unknown'
  country_code?: string;
}): void {
  track('onboarding_profile_submitted', { step_index: 1, ...p });
}

export function logOnboardingGoalSubmitted(p: { goal_minutes: number }): void {
  track('onboarding_goal_submitted', { step_index: 2, ...p });
}

export function logOnboardingCompleted(): void {
  track('onboarding_completed', { step_index: 99 });
  logTutorialComplete();
}

// ── 집중(Focus) [C] ──
// focus_session_started만 클라가 발행한다. 완료(focus_session_completed)는 서버 검증 이벤트([S])이므로
// 백엔드 MP가 소유 — 클라에서 발행하지 않는다(FocusModeScreen.handleStop 주석 참고).
export function logFocusSessionStarted(p: { has_tag: boolean }): void {
  track('focus_session_started', p);
}

// ── 리그(League) 인터랙션 [C] (GROMO-538) ──
// 리그 화면 진입·탭 전환·리그 필터·프로필 진입. 승격/강등 확정 등 서버 검증 이벤트([S])는
// 백엔드 MP가 소유 — 클라에서 발행하지 않는다.
export type LeagueTab = 'league' | 'friend';

// 리그 화면 진입(포커스마다 1회).
export function logLeagueViewed(): void {
  track('league_viewed');
}

// 리그/친구 세그먼트 전환.
export function logLeagueTabChanged(p: { tab: LeagueTab }): void {
  track('league_tab_changed', p);
}

// 리그 필터 선택. 시험명(PII 아님)은 이벤트 단순화를 위해 보내지 않고 전체 여부만 기록.
export function logLeagueFilterSelected(p: { is_all: boolean }): void {
  track('league_filter_selected', p);
}

// 랭킹/포디움에서 프로필 진입. is_me: 내 행 여부(타깃 식별자는 PII 회피로 미포함).
export function logLeagueProfileOpened(p: { is_me: boolean }): void {
  track('league_profile_opened', p);
}

// ── User Properties (PII 금지) ──
// 알려진 값만 설정한다(undefined는 건너뜀). 자세한 목록은 설계서 §2.3.
export function setIdentityProps(p: {
  is_guest: boolean;
  signup_method?: AuthMethod;
  current_tier?: string;
  occupation?: string;
  country_code?: string;
  screen_time_permission?: boolean;
  onboarding_completed?: boolean;
}): void {
  setUserProperty('is_guest', p.is_guest);
  if (p.signup_method !== undefined) setUserProperty('signup_method', p.signup_method);
  if (p.current_tier !== undefined) setUserProperty('current_tier', p.current_tier);
  if (p.occupation !== undefined) setUserProperty('occupation', p.occupation);
  if (p.country_code !== undefined) setUserProperty('country_code', p.country_code);
  if (p.screen_time_permission !== undefined)
    setUserProperty('screen_time_permission', p.screen_time_permission);
  if (p.onboarding_completed !== undefined)
    setUserProperty('onboarding_completed', p.onboarding_completed);
}
