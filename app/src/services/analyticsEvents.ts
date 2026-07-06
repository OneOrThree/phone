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

// ── 온보딩 퍼널 [C] ── (event-logging-design.md §5.A)
// 모든 온보딩 이벤트에 step_index(number) 부착 → 퍼널 단계 정렬 일관(O1~O8).
export function logOnboardingStarted(): void {
  track('onboarding_started', { step_index: 0 });
  logTutorialBegin();
}

// O1 프로필 제출
export function logOnboardingProfileSubmitted(p: {
  gender: GenderCode;
  age_band: string; // 예: '10s' | '20s' | '30s' | '40s' | '50s+' | 'unknown'
  country_code?: string;
}): void {
  track('onboarding_profile_submitted', { step_index: 1, ...p });
}

// O2 쇼크 화면 노출
export function logOnboardingShockViewed(): void {
  track('onboarding_shock_viewed', { step_index: 2 });
}

// O3 스크린타임 권한 요청 / 응답(granted)
export function logOnboardingPermissionRequested(): void {
  track('onboarding_permission_requested', { step_index: 3 });
}
export function logOnboardingPermissionResulted(p: { granted: boolean }): void {
  track('onboarding_permission_resulted', { step_index: 3, ...p });
}

// O4 스크린타임 요약 노출 (has_data: 실제 사용량 확보 여부)
export function logOnboardingScreentimeViewed(p: { has_data: boolean }): void {
  track('onboarding_screentime_viewed', { step_index: 4, ...p });
}

// O5 예측 화면 노출
export function logOnboardingPredictionViewed(): void {
  track('onboarding_prediction_viewed', { step_index: 5 });
}

// O6 목표 제출
export function logOnboardingGoalSubmitted(p: { goal_minutes: number }): void {
  track('onboarding_goal_submitted', { step_index: 6, ...p });
}

// O7 가입 수단 선택 / 실패
export function logOnboardingSignupSelected(p: { method: AuthMethod }): void {
  track('onboarding_signup_selected', { step_index: 7, ...p });
}
export function logOnboardingSignupFailed(p: { method: AuthMethod; reason: string }): void {
  track('onboarding_signup_failed', { step_index: 7, ...p });
}

// O8 캐릭터 / 닉네임 제출
export function logOnboardingCharacterSubmitted(): void {
  track('onboarding_character_submitted', { step_index: 8 });
}
export function logOnboardingNicknameSubmitted(): void {
  track('onboarding_nickname_submitted', { step_index: 8 });
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

// 세션 시작. has_tag: 과목 부착 여부, mode: 타이머 모드, goal_minutes: 목표(카운트다운/뽀모도로).
export function logFocusSessionStarted(p: {
  has_tag: boolean;
  mode: FocusMode;
  goal_minutes?: number;
}): void {
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

// 세션 중도 포기 — 정상 완료 전 이탈/자동종료. reason 예: 'user_exit' | 'leave_timeout'.
export function logFocusSessionAbandoned(p: { elapsed_seconds: number; reason: string }): void {
  track('focus_session_abandoned', p);
}

// 집중 태그(과목) 생성/수정/삭제.
export function logFocusTagCreated(): void {
  track('focus_tag_created');
}
export function logFocusTagUpdated(): void {
  track('focus_tag_updated');
}
export function logFocusTagDeleted(): void {
  track('focus_tag_deleted');
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

// ── 리텐션/알림 [C] ── (event-logging-design.md §5.B)
export type NotificationType = 'poke' | 'report' | 'challenge';

// 푸시로 앱 복귀(리텐션 핵심).
export function logNotificationOpened(p: { type: NotificationType }): void {
  track('notification_opened', p);
}

// 푸시 권한 응답.
export function logNotificationPermissionResult(p: { granted: boolean }): void {
  track('notification_permission_result', p);
}

// ── 그룹(Group) [C] ── (event-logging-design.md §5.D)
// created/joined/left 등 서버 검증 이벤트([S])는 백엔드 MP 소유 — 클라 미발행.
export type GroupJoinMethod = 'code' | 'search' | 'invite';

export function logGroupCreateStarted(): void {
  track('group_create_started');
}
export function logGroupSearchPerformed(p: { query_length: number; result_count: number }): void {
  track('group_search_performed', p);
}
export function logGroupJoinAttempted(p: { join_method: GroupJoinMethod }): void {
  track('group_join_attempted', p);
}
export function logGroupViewed(): void {
  track('group_viewed');
}
export function logGroupTabViewed(p: { tab: string }): void {
  track('group_tab_viewed', p);
}
export function logGroupInviteShared(): void {
  track('group_invite_shared');
}

// ── 그룹 Fakedoor [C] ── (GROMO-597)
// 실기능 미구현 준비중 화면의 수요 측정. 기존 group_viewed와 분리 —
// 미래에 실제 그룹 기능이 켜지면 group_viewed가 실조회를 뜻하게 되므로 지표 오염을 막는다.
export function logGroupFakedoorViewed(): void {
  track('group_fakedoor_viewed'); // 그룹 탭 진입(수요 측정 핵심)
}
export function logGroupNotifyRequested(): void {
  track('group_notify_requested'); // '출시되면 알림 받기' 탭(강한 수요 신호)
}

// ── 챌린지(Challenge) [C] ── (event-logging-design.md §5.E)
// created/joined/completed/deleted 등 확정 이벤트는 서버([S]) 소유 — 진입만 클라.
export function logChallengeCreateStarted(): void {
  track('challenge_create_started');
}

// ── 소셜(Poke) [C] ── (event-logging-design.md §5.F)
// 수신(poke_received)은 서버 발송이라 [S] — 발신만 클라.
export function logPokeSent(): void {
  track('poke_sent');
}

// ── 프러스트레이션/이탈 [C] ── (event-logging-design.md §5.G)
// flow 예: 'onboarding' | 'group_create'. step: 이탈 시점 단계.
export function logFlowAbandoned(p: { flow: string; step: string }): void {
  track('flow_abandoned', p);
}
export function logRepeatedFailure(p: { action: string; attempt_count: number }): void {
  track('repeated_failure', p);
}
// (선택) 짧은 시간 연타 감지.
export function logRageTapDetected(p: { screen_name: string }): void {
  track('rage_tap_detected', p);
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
