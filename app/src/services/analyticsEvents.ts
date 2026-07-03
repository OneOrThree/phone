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
// 시작·일시정지·재개·메뉴·친구뷰만 클라가 발행한다(순수 클라 인터랙션).
// 완료(focus_session_completed)는 서버 검증 이벤트([S])이므로 백엔드 MP가 소유 —
// 클라에서 발행하지 않는다(FocusSessionScreen.finish 주석 참고).
export type FocusMode = 'countup' | 'countdown' | 'pomodoro';

// 세션 시작 — 실제 세션 화면 진입 시 1회. has_tag: 과목 부착 여부, mode: 타이머 모드.
export function logFocusSessionStarted(p: { has_tag: boolean; mode: FocusMode }): void {
  track('focus_session_started', p);
}

// 세션 일시정지 — 유저가 정지 버튼으로 타이머를 멈춤. elapsed_seconds는 멈춘 시점의 적립 집중초.
export function logFocusSessionPaused(p: { elapsed_seconds: number }): void {
  track('focus_session_paused', p);
}

// 세션 재개 — 일시정지 상태에서 다시 시작.
export function logFocusSessionResumed(): void {
  track('focus_session_resumed');
}

// 집중 메뉴(햄버거 드로어) 열림.
export function logFocusMenuOpened(): void {
  track('focus_menu_opened');
}

// 집중 화면에서 친구 그리드 페이지로 스와이프해 노출.
export function logFocusFriendsViewed(): void {
  track('focus_friends_viewed');
}

// ── 홈(Home) 인터랙션 [C] ──
// 홈 화면 진입 + 오늘 요약 조회. focus_session_completed([S])는 여기서 발행하지 않는다.
// 집중 세션 리스트·PIN 친구 UI는 v2 홈(GROMO-552)에 아직 없어, 관련 이벤트는 해당 UI 도입 시 추가한다(GROMO-537).
export function logHomeViewed(): void {
  track('home_viewed');
}

// 오늘 요약 카드 노출. 552 홈은 공부 집중 누적(초→분)만 JS에서 확보 가능
// (핸드폰 사용시간은 네이티브 리포트 뷰가 그려 JS로 넘어오지 않음). sessions_count도 아직 미확보.
export function logTodaySummaryViewed(p: { focus_minutes: number }): void {
  track('today_summary_viewed', p);
}

// 홈 버튼 탭 — 어떤 버튼(button)을 눌러 어디로(destination 라우트) 이동했는지 기록.
export type HomeButton = 'today_summary_detail' | 'phone_usage';
export function logHomeButtonTapped(p: { button: HomeButton; destination: string }): void {
  track('home_button_tapped', p);
}

// 홈 당겨서 새로고침 — 오늘 요약 재조회 트리거.
export function logHomeRefreshed(): void {
  track('home_refreshed');
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
