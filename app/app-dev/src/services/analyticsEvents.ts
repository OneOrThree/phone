// Track 1 (GA4) 타입드 이벤트 헬퍼.
// 이벤트당 얇은 함수 1개 — 호출부 타입 안전 + 이벤트명/파라미터 계약을 한 곳에 모은다.
// 화면/스토어에서는 이 헬퍼만 import해서 쓰고, track()을 직접 부르지 않는다.
//
// 기존 서버 GA4/Measurement Protocol 이벤트는 서버 발행을 유지한다.
// 클라이언트는 화면 노출·사용자 액션·서버 응답 확인을 보완 관측한다.
// ⚠️ PII 금지: 닉네임/생년월일/원본 식별정보를 이벤트·유저속성으로 보내지 않는다. 파생 비식별값만.
import { track, setUserProperty } from '@/services/analytics';
import type { FocusEntrySource } from '@/services/cardInteraction';
import type { InquiryCategoryId } from '@/constants/inquiryContacts';
import type { Occupation } from '@/types/dto/user';

// 로그인/가입 수단
export type AuthMethod = 'kakao' | 'apple' | 'google' | 'line' | 'facebook' | 'guest';

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

// ── 온보딩 퍼널 [C] ── (event-logging-design.md §5.A / 프로젝트/이벤트-정의-기획.md §5)
// step_index = 실제 v2 퍼널 순서(설계 O1~O8 폐기). 동적 삽입 스텝과 무관하게 고정.
export function logOnboardingStarted(): void {
  track('onboarding_started', { step_index: 0 });
  logTutorialBegin();
}

// 온보딩 스텝 이름 — OnboardingFlow 시퀀스 노드와 1:1 (동적 분기 포함).
export type OnboardingStepName =
  | 'problem_empathy'
  | 'together_effect'
  | 'subject_compare'
  | 'login'
  | 'focus_category'
  | 'subject_edit'
  | 'screentime_permission'
  | 'screentime_denied'
  | 'yesterday_screentime'
  | 'goal_setting'
  | 'character_intro'
  | 'cutout_experience'
  | 'nickname';

// 스텝 도달(노출) — 전 스텝 커버로 퍼널 이탈 지점을 파악한다(기존 제출/노출 이벤트의 공백 보완).
// 같은 플로우에서 처음 도달한 스텝만 발행(뒤로가기 재방문 제외 — "어디까지 갔나" 의미 유지).
// step_index는 런타임 진행 위치 — 동적 분기(과목 편집 삽입)로 유저마다 다를 수 있어 순서 참고용,
// 스텝 구분·퍼널 단계 정의는 step 파라미터로 한다.
export function logOnboardingStepViewed(p: { step: OnboardingStepName; step_index: number }): void {
  track('onboarding_step_viewed', p);
}

// 스텝 공통 CTA 클릭 — StepScaffold의 메인/보조 버튼(GROMO-1605).
// onboarding_step_viewed(도달)와 짝을 이뤄 "봤는데 안 눌렀다" vs "눌러서 넘어갔다"를 가른다.
// 스텝별 제출 이벤트(focus_category_submitted 등)와 **별개로 항상** 발행한다 — 제출 이벤트가
// 없는 스텝(공감·소개 화면 등)이 퍼널에서 통째로 비던 문제를 이 이벤트 하나로 덮는다.
// action: 'cta'=메인 버튼, 'secondary'=보조 액션(나중에 할게요·건너뛰기·이대로 계속하기).
export type OnboardingCtaAction = 'cta' | 'secondary';
export function logOnboardingStepCta(p: {
  step: OnboardingStepName;
  action: OnboardingCtaAction;
}): void {
  track('onboarding_step_cta', p);
}

// 스텝 안의 보조 인터랙션 — 칩 선택·피커 열기·재시도·모달 닫기 등(GROMO-1605).
// 이벤트를 종류마다 새로 파지 않고 action으로 구분한다(이벤트 목록 비대화 방지).
// action_value: 선택값 등 부가 정보. **PII 금지** — 비식별 라벨만(카테고리 표시명 등).
// ('value'는 GA4 예약 파라미터(숫자 이벤트 값)라 사용 금지 — 이 파일 설정 섹션 계약과 동일)
export type OnboardingStepActionName =
  | 'category_select' // 집중 카테고리 칩 선택
  | 'category_retry' // 카테고리 목록 조회 실패 후 재시도
  | 'guide_continue' // 스크린타임 권한 가이드 오버레이 '계속'
  | 'guide_deny_tapped' // 가이드에서 '허용 안 함'(오답)을 탭 — 가이드가 막아낸 실수의 양
  | 'open_settings' // 권한 거부 안내에서 iOS 설정 열기
  | 'goal_picker_focus' // 집중 목표 피커 펼치기
  | 'goal_picker_screentime' // 스크린타임 목표 피커 펼치기
  | 'cutout_modal_closed' // 누끼 생성 모달을 저장 없이 닫음(생성 도중 이탈)
  | 'step_back'; // 스와이프로 이전 스텝 복귀 — 되돌아가게 만든 화면 찾기
export function logOnboardingStepAction(p: {
  step: OnboardingStepName;
  action: OnboardingStepActionName;
  action_value?: string;
}): void {
  track('onboarding_step_action', p);
}

// W4 집중 카테고리(목표) 선택 제출 — 제출 사실만 알던 것을 '무엇을 골랐는지'까지 넓힌다(GROMO-1605).
// category: occupation **code**(예: 'CSAT'). GROMO-1624에서 표시명 → code로 전환 —
// i18n(GROMO-1704) 이후 표시명은 기기 언어에 따라 갈라져('수능·N수' vs 'College Entrance Exam')
// 같은 직군이 언어별로 쪼개지므로 로케일 무관한 code가 집계 축으로 옳다. 전환 전후로 두 표기가
// 섞이는 기간이 있다(전환 배포일은 개발 예정 노트에 기록 — GA4 탐색 필터 손질용).
export function logOnboardingFocusCategorySubmitted(p: { category: Occupation }): void {
  track('onboarding_focus_category_submitted', { step_index: 4, ...p });
}

// W10 스크린타임 권한 요청 / 응답(granted)
export function logOnboardingPermissionRequested(): void {
  track('onboarding_permission_requested', { step_index: 10 });
}
export function logOnboardingPermissionResulted(p: { granted: boolean }): void {
  track('onboarding_permission_resulted', { step_index: 10, ...p });
}

// W11 스크린타임 설정 결과 도달 (has_data: 권한 승인으로 측정 가능한지 여부)
export function logOnboardingScreentimeViewed(p: { has_data: boolean }): void {
  track('onboarding_screentime_viewed', { step_index: 11, ...p });
}

// 닉네임 제출
export function logOnboardingNicknameSubmitted(): void {
  track('onboarding_nickname_submitted', { step_index: 12 });
}

// W12 목표 제출 — goal_type으로 집중/스크린타임 구분(한 화면에서 2회 발사) 🆕
export type OnboardingGoalType = 'focus' | 'usage';
export function logOnboardingGoalSubmitted(p: {
  goal_minutes: number;
  goal_type: OnboardingGoalType;
}): void {
  track('onboarding_goal_submitted', { step_index: 13, ...p });
}

// W15 가입 수단 선택 / 실패 — LoginScreen(isOnboarding)에서 발행. 취소는 reason='cancelled',
// 그 외 reason은 에러 코드 버킷만(원문 메시지는 PII·고카디널리티 위험으로 금지).
export function logOnboardingSignupSelected(p: { method: AuthMethod }): void {
  track('onboarding_signup_selected', { step_index: 15, ...p });
}
export function logOnboardingSignupFailed(p: { method: AuthMethod; reason: string }): void {
  track('onboarding_signup_failed', { step_index: 15, ...p });
}

export function logOnboardingCompleted(): void {
  track('onboarding_completed', { step_index: 99 });
  logTutorialComplete();
}

// ── 집중(Focus) [C] ──
// 시작·일시정지·재개·완료·포기·메뉴·친구뷰를 클라가 발행한다.
export type FocusMode = 'countup' | 'countdown' | 'pomodoro';

// 세션 시작. has_tag: 과목 부착 여부, mode: 타이머 모드, goal_minutes: 목표(카운트다운/뽀모도로).
export function logFocusSessionStarted(p: {
  has_tag: boolean;
  mode: FocusMode;
  goal_minutes?: number;
  entry_source: FocusEntrySource;
  subject_key?: string;
  interaction_id?: string;
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

// 세션 정상 완료 — 유저 주도 종료(완주 확인·정지 버튼) 시 모드 무관 발행(GROMO-1004).
// abandoned(이탈 타임아웃)와 상호배타 — 한 세션은 둘 중 하나만 발행한다.
// core WAU·활성화 마커(가입 후 첫 완료)·F1-b/F2 완료 칸이 이 이벤트로 계산된다.
export function logFocusSessionCompleted(p: {
  mode: FocusMode;
  focus_minutes: number;
  has_tag: boolean;
}): void {
  track('focus_session_completed', p);
}

// 세션 중도 포기 — 이탈 타임아웃 자동 종료('leave_timeout')와 finish를 안 거친 화면 이탈
// ('system_back' — 안드로이드 시스템 back 등). 정지 버튼 종료는 completed로 계측(GROMO-1004).
export function logFocusSessionAbandoned(p: { elapsed_seconds: number; reason: string }): void {
  track('focus_session_abandoned', p);
}

export type DistractionAppCategory =
  | 'social'
  | 'messenger'
  | 'short_video'
  | 'video'
  | 'game'
  | 'browser'
  | 'other';

// 집중 중 앱을 벗어났다가 돌아온 사실 — 앱 이름·번들 ID는 보내지 않는다.
export function logFocusDistractionDetected(p: {
  reason: 'app_backgrounded' | 'leave_timeout';
  app_category: DistractionAppCategory;
  blocked: boolean;
  returned_to_focus: boolean;
}): void {
  track('focus_distraction_detected', p);
}

// 과목 ID는 로컬 생성값·서버 식별자일 수 있으므로 원문 대신 안정적인 비식별 키로 보낸다.
export function subjectKeyOf(subjectId?: string): string | undefined {
  if (!subjectId) return undefined;
  let hash = 7;
  for (let i = 0; i < subjectId.length; i += 1) {
    hash = (hash * 31 + subjectId.charCodeAt(i)) % 2147483647;
  }
  return `s_${hash.toString(16)}`;
}

// 라이브 마커 시작 실패(GROMO-1214) — POST /focus-session/start가 실패해 마커 없이 흘러간 세션.
// 마커가 없으면 종료가 PATCH 대신 종전 POST로 폴백해 '서버 발급 마커를 거친 지급' 보장이 빠지므로,
// '마커 없는 세션' 비율을 보고 거부 정책 도입 여부를 판단한다(정책은 데이터를 보고 나중에).
// reason: 실패 버킷만 — 'network'(응답 없음) | 'http_<status>' | 'unknown'.
// 원문 메시지는 PII·고카디널리티 위험으로 금지(로그인 실패 계측과 같은 규칙).
export function logFocusMarkerStartFailed(p: { reason: string }): void {
  track('focus_marker_start_failed', p);
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

// 집중 세션 페이저 뷰 식별자 — 페이지 인덱스가 아니라 뷰 정체성 기준(GROMO-987).
// 스와이프 순서가 바뀌어도(985) 값은 불변이어야 GA4 측정기준이 오염되지 않는다.
export type FocusViewName = 'character' | 'friends' | 'groups' | 'my_league' | 'all_league';

// 집중 세션 페이저 뷰 전환/세션 종료 시 발행 — "집중 중 어떤 뷰를 켜놓고 공부하나"(GROMO-987).
// view: 직전까지 보던 뷰, dwell_seconds: 그 뷰의 체류 초. 기존 focus_friends_viewed를 대체한다
// (친구 뷰 노출은 view='friends'로 분해 조회). GA4에 view 측정기준·dwell_seconds 지표 등록 필요.
export function logFocusViewChanged(p: { view: FocusViewName; dwell_seconds: number }): void {
  track('focus_view_changed', p);
}

// 집중 화면 방향 — 세로/가로 중 어느 쪽으로 더 오래 집중하는지 집계용(GROMO-973).
export type FocusOrientation = 'portrait' | 'landscape';

// 방향 전환·세션 종료 시 직전 방향의 체류를 발행 — orientation: 그 방향, dwell_seconds: 체류 초.
// 뷰 체류(focus_view_changed)와 같은 방식이라 GA4에서 방향별 총 집중 시간을 합산해 비교한다.
export function logFocusOrientationChanged(p: {
  orientation: FocusOrientation;
  dwell_seconds: number;
}): void {
  track('focus_orientation_changed', p);
}

// 비교 축 공용 파라미터 값 — 집중 결과·통계 비교 카드에서 함께 쓴다(GROMO-782).
export type CompareAxisParam = 'friends' | 'all' | 'category';

// 집중 결과 화면 비교 카드 — 기간 탭(오늘/이번 주/이번 달)·축(친구/전체/같은 카테고리) 전환.
// 같은 칩 재탭은 호출부에서 걸러 미계측.
export function logFocusResultComparePeriodChanged(p: { period: StatsPeriodKey }): void {
  track('focus_result_compare_period_changed', p);
}
export function logFocusResultCompareAxisChanged(p: { axis: CompareAxisParam }): void {
  track('focus_result_compare_axis_changed', p);
}

// ── 홈(Home) 인터랙션 [C] ──
// 홈 화면 진입 + 오늘 요약 조회. focus_session_completed는 세션 화면(finish)이 발행 — 여기선 안 한다.
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
export type HomeButton =
  | 'today_summary_detail'
  | 'phone_usage'
  | 'notification_bell'
  | 'character_change';
export function logHomeButtonTapped(p: { button: HomeButton; destination: string }): void {
  track('home_button_tapped', p);
}

// 홈 당겨서 새로고침 — 오늘 요약 재조회 트리거.
export function logHomeRefreshed(): void {
  track('home_refreshed');
}

// ── 리그(League) 인터랙션 [C] (GROMO-538) ──
// 리그 화면 진입·탭 전환·리그 필터·프로필 진입·결과 화면 노출을 클라가 발행한다.
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

// 티어 단계 안내 화면 진입(포커스마다 1회, GROMO-782).
export function logTierGuideViewed(): void {
  track('tier_guide_viewed');
}

// ── 친구(Friend) [C] (GROMO-782) ──
// 신청·수락·거절·끊기·핀 토글 — API 성공 시에만 발행해 실제 성립한 액션만 센다
// (409 중복·롤백된 낙관 갱신은 미집계). 대상 식별자는 PII 회피로 미포함.
export type FriendRequestSource = 'friend_add' | 'friend_profile';

// 친구 신청 발신. request_source: 친구 추가 검색 목록 / 프로필 상세 중 어디서 보냈는지.
// ('source'는 공통 파라미터(클라/서버 출처 'client')와 이름이 겹쳐 덮어쓰므로 사용 금지)
export function logFriendRequestSent(p: { request_source: FriendRequestSource }): void {
  track('friend_request_sent', p);
}

// 받은 친구 요청 수락/거절(친구 추가 화면의 받은 요청 목록).
export function logFriendRequestAccepted(): void {
  track('friend_request_accepted');
}
export function logFriendRequestRejected(): void {
  track('friend_request_rejected');
}

// 친구 끊기(Alert 확인 후 성공 시).
export function logFriendUnfriended(): void {
  track('friend_unfriended');
}

// 친구 프로필 핀 고정/해제. pinned: 토글 후 상태(true=고정).
export function logFriendPinToggled(p: { pinned: boolean }): void {
  track('friend_pin_toggled', p);
}

// 친구 닉네임 검색 실행(디바운스 확정분만 — 타이핑 중간 취소분 제외). 검색어 원문은 PII 회피로 미전송.
export function logFriendSearchPerformed(p: { query_length: number; result_count: number }): void {
  track('friend_search_performed', p);
}

// ── 통계(Stats) [C] (GROMO-558) ──
// 통계 화면 진입·기간 탭 전환·과목 필터 선택을 클라가 발행한다.
export type StatsPeriodKey = 'day' | 'week' | 'month';

// 통계 화면 진입(포커스마다 1회).
export function logStatsViewed(): void {
  track('stats_viewed');
}

// 기간 탭(일/주/월) 전환.
export function logStatsPeriodChanged(p: { period: StatsPeriodKey }): void {
  track('stats_period_changed', p);
}

// (stats_tag_filter_selected 이벤트는 과목 칩 필터 제거로 폐기 — GROMO-761)

// 타임테이블/주간 타임라인 카드 공유(캡처→공유 시트, GROMO-782).
// completed: 실제 공유 완료 여부 — iOS Share 결과로 시트만 열고 닫은 경우(false)를 구분.
export type StatsShareCard = 'timetable' | 'weekly_timeline';
export function logStatsShared(p: { card: StatsShareCard; completed: boolean }): void {
  track('stats_shared', p);
}

// 비교 카드 축(친구/전체/같은 카테고리) 전환. period: 어느 기간 탭의 비교 카드인지.
export function logStatsCompareAxisChanged(p: {
  axis: CompareAxisParam;
  period: StatsPeriodKey;
}): void {
  track('stats_compare_axis_changed', p);
}

// 카드 순서 편집 확정(드래그 놓기 — 순서가 실제 바뀐 경우만). top_card: 편집 후 맨 위 카드 key.
// 전체 순서 문자열은 GA4 값 100자 한도·고카디널리티라 최상단 선호만 기록한다.
export function logStatsCardReordered(p: { period: StatsPeriodKey; top_card: string }): void {
  track('stats_card_reordered', p);
}

// ── 계정(Account) [C] (GROMO-782) ──
// 로그아웃/탈퇴 — 이탈 분석용(계정 설정 화면).
export function logLogout(): void {
  track('logout');
}

// 회원 탈퇴 확정 — 탈퇴 API 성공 시에만 발행(모달 취소·실패는 미집계).
export function logWithdrawalConfirmed(): void {
  track('withdrawal_confirmed');
}

// 게스트 → 소셜 로그인 전환 시도(계정 설정 화면). 성공 여부는 auth.ts의 login/sign_up이 담당.
export function logGuestSocialLoginAttempted(p: { method: AuthMethod }): void {
  track('guest_social_login_attempted', p);
}

// ── 설정(Settings) [C] (GROMO-782) ──
// 알림 설정 변경 — 바뀐 필드 단위로 발행(특히 알림 끄기 = 이탈 위험 신호).
// setting_value: on/off 또는 'HH:mm'. ('value'는 GA4 예약 파라미터(숫자 이벤트 값)라 사용 금지)
export type NotificationSettingKey =
  | 'notification'
  | 'sound'
  | 'night_mode'
  | 'night_start_time'
  | 'night_end_time';
export function logNotificationSettingsChanged(p: {
  setting: NotificationSettingKey;
  setting_value: string | boolean;
}): void {
  track('notification_settings_changed', p);
}

// 상세 통계 공개 범위 전환(전체/친구). 낙관적 반영 시점에 발행 — 저장 실패에도 낙관 값을 유지하는
// 화면이라 UI 기준이 진실이다.
export function logStatVisibilityChanged(p: { visibility: 'public' | 'friends' }): void {
  track('stat_visibility_changed', p);
}

// ── 가이드(코치마크) [C] (GROMO-782) ──
// 첫 진입 사용법 안내(GROMO-652)를 마지막 스텝까지 보고 닫은 경우.
// guide: 스토리지 키 접미(home/league/menu/focusSession/stats/tier).
export function logTabGuideCompleted(p: { guide: string }): void {
  track('tab_guide_completed', p);
}

// ── 리텐션/알림 [C] ── (event-logging-design.md §5.B)
// rank_change: 순위 역전 푸시(백엔드 bfeat/GROMO-579) — payload data.type='rank_change' 필요.
export type NotificationType = 'poke' | 'report' | 'challenge' | 'rank_change';

// 푸시로 앱 복귀(리텐션 핵심).
export function logNotificationOpened(p: { type: NotificationType }): void {
  track('notification_opened', p);
}

// 푸시 권한 응답.
export function logNotificationPermissionResult(p: { granted: boolean }): void {
  track('notification_permission_result', p);
}

// ── 넛지(Nudge) [C] ── (프로젝트/이벤트-정의-기획.md §H)
// "수치+색으로 유도하되 명령하지 않기"가 통했는지 — 노출 대비 반응률.
export type NudgeType = 'rank' | 'streak' | 'stat';
export function logNudgeViewed(p: { type: NudgeType }): void {
  track('nudge_viewed', p);
}
export function logNudgeTapped(p: { type: NudgeType }): void {
  track('nudge_tapped', p);
}

// ── 그룹(Group) [C] ── (event-logging-design.md §5.D)
// 생성·가입·이탈 등 사용자가 확인 가능한 결과는 클라에서 발행한다.
// 'deferred_invite' = 미설치 상태에서 링크를 누르고 설치 후 복원된 초대(초대 링크 스펙 §4-3).
// C-1: 참가 코드는 폐기됐다(§0) — 'code'는 발행되지 않던 데드 값이라 제거. 검색·초대·복원 초대만 남긴다.
export type GroupJoinMethod = 'search' | 'invite' | 'deferred_invite';
export type GroupCardAction = 'focus' | 'room' | 'settings';
export type GroupCardRole = 'owner' | 'member';
export type GroupCardBackSource = 'user' | 'guide';
export type GroupCardFlipTrigger = 'card_tap' | 'accessibility_action';
export type GroupCarouselTrigger = 'swipe' | 'indicator_press' | 'accessibility_action';
export type GroupCardReorderTrigger = 'drag' | 'pointer_control' | 'accessibility_action';

export function logGroupCreateStarted(p: {
  entry_point: 'empty' | 'list' | 'header' | 'end_card';
}): void {
  track('group_create_started', p);
}
export function logGroupLeft(p: { leave_reason: 'self' | 'kicked' }): void {
  track('group_left', p);
}
export function logGroupCreateSubmitted(p: {
  entry_point: 'empty' | 'list' | 'header' | 'end_card';
  is_private: boolean;
}): void {
  track('group_create_submitted', p);
}
export function logGroupCreated(p: {
  entry_point: 'empty' | 'list' | 'header' | 'end_card';
  is_private: boolean;
}): void {
  track('group_created', p);
}
export function logGroupSearchPerformed(p: { query_length: number; result_count: number }): void {
  track('group_search_performed', p);
}
// 참여 시도 — slug는 초대 링크 경로로 들어온 경우에만 실린다(검색 참여엔 없음).
export function logGroupJoinAttempted(p: { join_method: GroupJoinMethod; slug?: string }): void {
  track('group_join_attempted', p);
}
export type GroupEntry = 'tab' | 'invite' | 'push' | 'return' | 'unknown';
export type GroupCountBucket = '0' | '1' | '2_5' | '6_10' | '11_plus';

export function logGroupViewed(p: {
  group_entry: GroupEntry;
  group_count_bucket: GroupCountBucket;
}): void {
  track('group_viewed', p);
}

export type GroupDeckGuideState = 'shown' | 'pending' | 'completed' | 'unknown';

// 실제 그룹 덱 또는 그룹 0개 사용자의 로컬 안내용 카드가 안정된 anchor를 확보하고, 완료 key
// read와 overlay queue 판정까지 끝낸 뒤 view episode당 한 번만 발행한다. 원시 그룹 수나 그룹
// 식별 정보는 싣지 않으며, 안내용 카드 노출은 실제 소속 수에 맞춰 0 bucket으로 구분한다.
export function logGroupCardDeckViewed(p: {
  group_entry: GroupEntry;
  group_count_bucket: GroupCountBucket;
  guide_state: GroupDeckGuideState;
}): void {
  track('group_card_deck_viewed', p);
}

export function logGroupCardFlipped(p: {
  to_face: 'front' | 'back';
  trigger: GroupCardFlipTrigger;
  group_count_bucket: Exclude<GroupCountBucket, '0'>;
}): void {
  track('group_card_flipped', p);
}

export function logGroupCarouselPaged(p: {
  trigger: GroupCarouselTrigger;
  from_index: number;
  to_index: number;
  group_count_bucket: Exclude<GroupCountBucket, '0'>;
}): void {
  track('group_carousel_paged', p);
}

export function logGroupCardReordered(p: {
  trigger: GroupCardReorderTrigger;
  from_index: number;
  to_index: number;
  group_count_bucket: Exclude<GroupCountBucket, '0'>;
}): void {
  track('group_card_reordered', p);
}

// guide 저장소/수명 오류는 사용자 행동 이벤트와 분리한다.
export function logGroupDeckGuideReadFailed(): void {
  track('group_deck_guide_read_failed');
}
export function logGroupDeckGuideInterrupted(p: {
  reason: 'background' | 'route' | 'groups_changed' | 'blocking_overlay' | 'unmount';
}): void {
  track('group_deck_guide_interrupted', p);
}
export function logGroupDeckGuideWriteFailed(): void {
  track('guide_complete_write_failed', { guide: 'groupDeck:v1' });
}

export function logGroupCardIconSaveResult(p: {
  surface: 'create' | 'settings';
  result: 'success' | 'failed';
}): void {
  track('group_card_icon_save_result', p);
}
export function logGroupCardIconEditorViewed(p: { surface: 'settings' }): void {
  track('group_card_icon_editor_viewed', p);
}
export function logGroupFindOpened(p: {
  entry_point: 'empty' | 'list' | 'header' | 'end_card';
}): void {
  track('group_find_opened', p);
}
// 그룹방(방) 방문 — group_viewed(그룹 탭 진입)와 구분해 실제 그룹방 진입/로드 성공을 센다.
// group_id로 어느 방인지 구분(불투명 식별자라 PII 아님).
export function logGroupCardActionClicked(p: {
  action: GroupCardAction;
  role: GroupCardRole;
  back_source: GroupCardBackSource;
  interaction_id: string;
}): void {
  track('group_card_action_clicked', p);
}
export function logGroupRoomViewed(p: {
  group_id: string;
  entry_source: FocusEntrySource;
  interaction_id?: string;
}): void {
  track('group_room_viewed', p);
}
export function logGroupTabViewed(p: { tab: string }): void {
  track('group_tab_viewed', p);
}

// ── 그룹 운영(3차) ── 설정 저장·방장 위임·강퇴·공지권한 (API 성공 시에만 발행).
// group_id는 불투명 식별자라 PII 아님. 그룹 운영 결과도 클라가 성공을 확인한 뒤 발행한다.
// A-1: 설정 저장 성공. fields는 실제로 바뀐 필드('name'|'description'|'maxMembers'|'isPrivate').
export function logGroupSettingsUpdated(p: { group_id: string; fields: string[] }): void {
  track('group_settings_updated', p);
}
// A-2: 방장 위임 성공. source는 위임을 시작한 경로.
export function logGroupOwnerTransferred(p: {
  group_id: string;
  source: 'settings' | 'withdraw' | 'account';
}): void {
  track('group_owner_transferred', p);
}
// A-3: 멤버 강퇴 성공.
export function logGroupMemberKicked(p: { group_id: string }): void {
  track('group_member_kicked', p);
}
// A-4: 공지 권한 토글 저장 성공. granted는 이번 변경의 방향(허용/회수).
export function logGroupNoticeGrantChanged(p: { group_id: string; granted: boolean }): void {
  track('group_notice_grant_changed', p);
}
// 초대 링크 공유 — share_method는 경로(클립보드 복사 / OS 공유 시트).
// ⚠️ confirmed는 **공유가 실제로 완료됐다고 확인됐는가**다. RN Android의 Share.share()는 대상 앱
//    선택 여부와 무관하게 sharedAction으로 끝나(dismissedAction은 iOS 전용) 취소를 구분할 수 없다 —
//    안드로이드 공유 시트는 confirmed:false로 보내고, 전환율은 confirmed:true만으로 본다.
//    (그냥 전부 true로 보내면 시트만 열고 닫은 사용자까지 섞여 안드로이드 지표가 체계적으로 부푼다.)
export function logGroupInviteShared(p: {
  share_method: 'copy' | 'share_sheet';
  confirmed: boolean;
  slug: string;
  group_id: string;
}): void {
  track('group_invite_shared', p);
}

// ── 그룹 초대 링크 퍼널 [C] ── (초대 링크 스펙 §4-3 표 6a·6b)
// 기존 서버 발행은 유지하고, 초대 링크 처리·가입 결과는 클라이언트 확인 시점의 관측도 보완한다.

// 6a. 설치 유저가 링크로 앱에 직행 — Universal Link 또는 랜딩의 스킴 점프.
// slug는 구형 링크(§4-1)로 들어오면 없다.
export function logInviteLinkOpened(p: {
  group_id: string;
  slug?: string;
  via: 'universal_link' | 'scheme';
}): void {
  track('invite_link_opened', p);
}

// 6b. 초대 시트 노출 — entry로 직행(link)과 설치 후 복원(deferred)을 가른다.
export function logGroupInviteSheetViewed(p: {
  group_id: string;
  slug?: string;
  entry: 'link' | 'deferred';
}): void {
  track('group_invite_sheet_viewed', p);
}

// ── 그룹 챌린지 내기(3차·확장) [C] ── (docs/app/challenge-impl-2026-08/contract.md §계측)
// 내기 개설·참가는 클라이언트가 API 성공을 확인한 뒤 발행한다.
// **API 성공 시에만** 발행한다 — 잔액 부족·중복으로 튕긴 시도까지 세면 실제 성립한 내기 수가 부푼다.
// stake는 판돈 금액(서버 허용값 {10,30,50,100}) — 금액대별 참여율을 보는 유일한 축이다.
// mission_type/mission_category는 확장 배치의 스크린타임·창 내기 채택률 측정 축(계측 표 A2 행) —
// 값은 서버 enum 문자열 그대로(DURATION|TIME_WINDOW · FOCUS|SCREEN_TIME).
export type ChallengeMissionParams = {
  mission_type: 'DURATION' | 'TIME_WINDOW';
  mission_category: 'FOCUS' | 'SCREEN_TIME';
};
export function logGroupBetCreated(p: { stake: number } & ChallengeMissionParams): void {
  track('group_bet_created', p);
}
// 참여 성공 — 단건 참가와 **예약**(join-next 1건 / join-week N건)이 같은 이벤트를 쓴다.
// 왜 예약도 1건으로 세나(챌린지 v2, GROMO-1419·1276): 이벤트 1건 = **유저가 참여를 결심한
// 한 번의 행동**이다. 3일 예약을 3건으로 부풀리면 '참여 결심 수'와 '참여 건수'가 뒤섞여
// 전환 퍼널(카드 노출 → 시트 → 참여)의 분모·분자가 갈리고, 주간 단축을 쓸수록 지표가 커져
// 단축 도입 효과를 스스로 부풀린다. 대신 규모는 파라미터로 남긴다:
//   session_count : 이 행동으로 걸린 날 수(단건 1 · 주간 N) — 예약 깊이 분포용
//   stake         : **하루치** 참가비(총액이 아니다 — 금액대별 참여율 축을 단건과 같게 유지).
//                   날짜별 금액이 갈리는 주간 예약은 가장 큰 하루치를 싣는다(축을 흐리지 않게).
// 파라미터는 선택이라 기존 호출부(BetSheet 단건)는 그대로 둔다 — 없으면 종전과 같은 이벤트다.
export function logGroupBetJoined(
  p: { stake: number; session_count?: number } & ChallengeMissionParams,
): void {
  track('group_bet_joined', p);
}

// 챌린지 참여 확정 — 내기 참여(group_bet_joined)와 별도로 챌린지 참여 퍼널을 집계한다.
export function logGroupChallengeJoined(
  p: { session_count?: number } & ChallengeMissionParams,
): void {
  track('group_challenge_joined', p);
}
// 내기 취소(개설자 단독·OPEN) 성공 — participants_count는 취소 시점 참가자 수(계약상 항상 1이어야
// 하지만, 서버 가드가 바뀌어도 지표가 사실을 말하게 실측값을 싣는다).
export function logGroupBetCanceled(p: { stake: number; participants_count: number }): void {
  track('group_bet_canceled', p);
}

// ── 그룹 챌린지 생성·삭제 [C] ── (contract.md §계측 — 퍼널 '챌린지 생성 → 내기 개설 → …' 선두)
// 그룹 챌린지 결과는 클라이언트가 화면·API 결과를 확인한 뒤 발행한다 —
// challenge_create_started(진입)와 달리 이 둘은 **API 성공 시에만** 발행한다.
// has_window: TIME_WINDOW 여부의 명시 축(형식상 mission_type과 중복이지만 계측 표의 계약이다).
export function logGroupChallengeCreated(
  p: { duration_minutes: number; has_window: boolean } & ChallengeMissionParams,
): void {
  track('group_challenge_created', p);
}
// 삭제 성공 — 발행 지점은 groupApi.deleteChallenge(호출부가 id만 넘겨 메타는 API 층 캐시로 해결).
export function logGroupChallengeDeleted(p: ChallengeMissionParams): void {
  track('group_challenge_deleted', p);
}
// 내기 켬 — PRD §5 성공 지표 "내기 켜짐 비율"의 측정 소스. v2에서 내기는 생성 시에만 켜지므로
// (N26 — 이후 불변) 생성 성공 경로가 유일한 발행 지점이다. 여기 없으면 지표가 영원히 0이다.
export function logGroupBetEnabled(p: { stake: number } & ChallengeMissionParams): void {
  track('group_bet_enabled', p);
}

// ── 그룹 챌린지 결과(확장 배치 A3 → v2 GROMO-1279) [C] ──
// 퍼널 "챌린지 생성 → 내기 → **결과 확인** → 재참여"의 결과 확인 칸. API 이벤트가 아니라
// 모달 노출/닫기라 클라 소유가 자연스럽다.
// v2: 소스가 /me/challenge-results(N53)로 바뀌며 미션 메타가 응답에 없다 — mission_* 는
// 옵셔널로 남기고(구 데이터 연속성), 대신 정산 결말(status)을 싣는다(무산·환불 노출 집계).
// achieved는 **내 결과**다 — null(미판정)이면 파라미터를 싣지 않는다(sanitize가 undefined 생략).
export function logGroupChallengeResultShown(p: {
  mission_type?: string;
  mission_category?: string;
  status?: string;
  achieved?: boolean;
  achiever_count: number;
  member_count: number;
}): void {
  track('group_challenge_result_shown', p);
}

// 결과 모달 닫기 — dwell_ms는 노출부터 닫기까지 체류(ms). 결과를 읽는지 바로 넘기는지 본다.
export function logGroupChallengeResultClosed(p: { dwell_ms: number }): void {
  track('group_challenge_result_closed', p);
}

export type GroupChallengeSettlementStatus = 'SETTLED' | 'FORFEITED' | 'VOIDED' | 'REFUNDED';
export function logGroupChallengeSettled(p: { status: GroupChallengeSettlementStatus }): void {
  track('group_challenge_settled', p);
}

// 정산 결과/창 종료 푸시 탭 → 앱 진입(계약 §2 계측 표 push_opened).
// 기존 notification_opened는 소문자 4종(poke/report/challenge/rank_change) 전용이라 이 두 타입을
// 세지 못한다 — 타입 집합이 겹치지 않아 이중 집계 없이 별도 이벤트로 계약에 고정됐다.
export type PushOpenedType = 'BET_RESULT' | 'CHALLENGE_WINDOW_END';
export function logPushOpened(p: { type: PushOpenedType }): void {
  track('push_opened', p);
}

// ── 스크린타임 창 사용분 보고 [C] ── (그룹 챌린지 확장 배치 A4, contract.md §계측)
// SCREEN_TIME×TIME_WINDOW 챌린지의 창 사용분 업로드(screentimeSync) 계측.
// reported는 **업로드 API 성공 시에만** 발행한다 — 실패 재시도까지 세면 보고 수가 부푼다.
// is_final: 창 종료 후 최종 보고 여부(false = 창 진행 중 중간 보고).
export function logScreentimeWindowReported(p: { minutes: number; is_final: boolean }): void {
  track('screentime_window_reported', p);
}

// 하루 사용량 최종 집계 후 목표 달성 여부를 평가한다. 중간 사용량 보고와 분리한다.
export function logScreentimeGoalEvaluated(p: {
  goal_met: boolean;
  actual_seconds: number;
  target_seconds: number;
  window_date: string;
  is_final: boolean;
}): void {
  track('screentime_goal_evaluated', p);
}

// 구 바이너리 가드(getUsageBucketEvents 미지원)에 걸려 창 사용분 업로드를 전체 스킵할 때 —
// 세션당 1회만(발행 가드는 호출부 screentimeSync가 잡는다). 업데이트 유도 필요 규모 측정용.
export function logScreentimeWindowUnsupported(): void {
  track('screentime_window_unsupported');
}

// C-1: 그룹 Fakedoor 계측(group_fakedoor_viewed·group_notify_requested)은 실기능 전환으로
// 호출부가 0이 된 지 오래라 제거했다(GROMO-597 Fakedoor 종료). 과거 구간 지표는 대시보드에 이미 적재돼 있다.

// ── 챌린지(Challenge) [C] ── (event-logging-design.md §5.E)
// 생성·참여·완료·삭제 등 클라이언트가 API 결과를 확인하는 지점에서 발행한다.
export function logChallengeCreateStarted(): void {
  track('challenge_create_started');
}

// ── 소셜(Poke) [C] ── (event-logging-design.md §5.F)
// 수신(poke_received)은 클라이언트가 푸시를 수신·보관함에 저장할 때도 발행한다.
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
// 빡침 연타 감지 — RageTapDetector(앱 루트)가 발행. 같은 지점(40pt) 1초 간격 연타 4회째, 5초 쿨다운.
export function logRageTapDetected(p: { screen_name: string }): void {
  track('rage_tap_detected', p);
}

// ── 공통 앱 쉘 [C] ──
// 기존 대표 화면 이벤트(home_viewed 등)와 별개로, 모든 native stack 화면의 긴 꼬리를 기록한다.
// screen_name/action/target은 호출부에서 enum처럼 관리하고 자유 입력·PII를 넣지 않는다.
export type AppEntry = 'cold_start' | 'foreground' | 'auth_complete' | 'unknown';
export type AuthState = 'guest' | 'member' | 'unknown';
export type MainTab = 'home' | 'league' | 'group' | 'menu';

export function logAppMainViewed(p: {
  app_entry: AppEntry;
  auth_state: AuthState;
  initial_tab: MainTab;
}): void {
  track('app_main_viewed', p);
}

export function logMainTabSelected(p: { tab: MainTab; from_tab: MainTab }): void {
  track('main_tab_selected', p);
}

export function logScreenViewed(p: { screen_name: string; entry_source: string }): void {
  track('screen_viewed', p);
}

export function logScreenExited(p: { screen_name: string; dwell_seconds: number }): void {
  track('screen_exited', p);
}

export function logUiActionTapped(p: {
  screen_name: string;
  action: string;
  target: string;
  destination?: string;
}): void {
  track('ui_action_tapped', p);
}

export function logFocusFabTapped(p: { entry_source: 'home_tab_bar' }): void {
  track('focus_fab_tapped', p);
}

// ── 캐릭터 [C] ──
export type CharacterSelectionSource = 'camera' | 'library';
export type CharacterType = 'default' | 'custom';

export function logCharacterSelectViewed(p: { entry_source: string }): void {
  track('character_select_viewed', p);
}

export function logCharacterCreateStarted(p: { entry_source: string }): void {
  track('character_create_started', p);
}

export function logCharacterSourceSelected(p: {
  selection_source: CharacterSelectionSource;
  entry_source?: string;
}): void {
  track('character_source_selected', p);
}

export function logCharacterCreated(p: {
  selection_source: CharacterSelectionSource;
  entry_source?: string;
}): void {
  track('character_created', p);
}

// 생성기 내부 편집 동작 — 회전·다시 고르기(GROMO-1605). 누끼 결과가 마음에 안 들어
// 고쳐 쓰는 양을 본다(rotate 다발 = 방향 인식 문제, repick 다발 = 누끼 품질 문제).
// 생성기는 온보딩·홈 공용이라 entry_source로 진입처를 가른다.
export function logCharacterEditAction(p: {
  action: 'rotate' | 'repick';
  entry_source?: string;
}): void {
  track('character_edit_action', p);
}

export function logCharacterEquipped(p: { character_type: CharacterType }): void {
  track('character_equipped', p);
}

// ── 화폐 클라이언트 이벤트 [C] ──
export type CurrencySurface = 'focus_result' | 'goal_modal' | 'screentime_modal' | 'league_result';
export type CurrencyHistoryEntry = 'home_chip' | 'menu_chip';
export type CurrencyChipLocation = 'home' | 'menu';

export function logCurrencyRewardShown(p: {
  surface: CurrencySurface;
  amount: number;
  reward_type: string;
}): void {
  track('currency_reward_shown', p);
}

export function logCurrencyInsufficient(p: {
  context: 'bet' | 'shop';
  required: number;
  shortfall: number;
}): void {
  track('currency_insufficient', p);
}

export function logCurrencyHistoryViewed(p: {
  entry: CurrencyHistoryEntry;
  tx_count?: number;
}): void {
  track('currency_history_viewed', p);
}

export function logCurrencyChipTapped(p: { location: CurrencyChipLocation }): void {
  track('currency_chip_tapped', p);
}

// 설정·프로필 성공 이벤트. 저장 성공 시점에만 호출한다.
export function logProfileUpdated(): void {
  track('profile_updated');
}

export function logGoalUpdated(p: { changed_focus: boolean; changed_usage: boolean }): void {
  track('goal_updated', p);
}

export function logOccupationUpdated(): void {
  track('occupation_updated');
}

// 서버 occupation 동기화(PATCH /users/me/occupation) 실패 — 예전엔 catch로 조용히 삼켜서
// users.occupation 이 NULL로 남는 걸 아무도 몰랐다(GROMO-1620/1624).
// 파라미터명이 request_source인 이유: 'source'는 공통 파라미터(클라/서버 출처 'client')와
// 겹쳐 금지이고(위 logFriendRequestSent 주석), request_source는 GA4 맞춤측정기준에 이미 등록돼
// 있어 추가 등록 없이 바로 쪼개 볼 수 있다.
export type OccupationSyncSource = 'onboarding' | 'settings' | 'recovery';

export function logOccupationSyncFailed(p: { request_source: OccupationSyncSource }): void {
  track('occupation_sync_failed', p);
}

export function logAllowedAppsUpdated(p: { app_count: number }): void {
  track('allowed_apps_updated', p);
}

export function logScreenTimeSettingsChanged(p: { setting: string; setting_value: string }): void {
  track('screen_time_settings_changed', p);
}

export function logSocialAccountUnlinked(p: { method: string }): void {
  track('social_account_unlinked', p);
}

export function logPokeReceived(): void {
  track('poke_received');
}

export function logLeagueResultViewed(p: { result: 'promoted' | 'maintain' | 'demoted' }): void {
  track('league_result_viewed', p);
}

// ── 1:1 문의 [C] ── (docs/prd/inquiry/policy.md D11)
// 서버에 아무것도 남지 않는 기능이라(D4·D13) 이 세 이벤트가 유일한 계측 수단이다 — 빼면 영영 측정 불가.
// contact_id 는 닉네임조차 아닌 고정 슬러그(dev-{categoryId})다 — 이 파일 상단의 PII 금지 규칙.
export function logInquiryScreenViewed(): void {
  track('inquiry_screen_viewed', { entry_point: 'menu' });
}

export function logInquiryCategorySelected(category: InquiryCategoryId): void {
  track('inquiry_category_selected', { category });
}

export function logInquiryContactOpened(p: {
  category: InquiryCategoryId | null;
  contactId: string;
  isRecommended: boolean;
}): void {
  track('inquiry_contact_opened', {
    // ⚠️ null 을 그대로 넘기면 sanitizeParams 가 키째 드롭한다 — 미선택을 세려면 미리 문자열화한다.
    category: p.category ?? 'none',
    contact_id: p.contactId,
    // ⚠️ boolean 은 전선 위에서 문자열 'true'/'false' 로 간다(sanitizeParams).
    //    GA4 탐색에서 boolean 으로 필터하면 0건이 나온다 — prd.md §5 참고.
    is_recommended: p.isRecommended,
  });
}

// ── User Properties (PII 금지) ──
// 알려진 값만 설정한다(undefined는 건너뜀). 자세한 목록은 설계서 §2.3.
export function setIdentityProps(p: {
  is_guest?: boolean | null; // null = 해제(미복원 부트스트랩 등 계정 미상 구간, GROMO-1637)
  signup_method?: AuthMethod | null; // null = 해제(위와 동일)
  current_tier?: string;
  occupation?: string;
  country_code?: string;
  screen_time_permission?: boolean;
  onboarding_completed?: boolean;
  currency_balance_bucket?: '0' | '1-99' | '100-499' | '500+' | null;
  watch_paired?: boolean;
}): void {
  if (p.is_guest !== undefined) setUserProperty('is_guest', p.is_guest);
  if (p.signup_method !== undefined) setUserProperty('signup_method', p.signup_method);
  if (p.current_tier !== undefined) setUserProperty('current_tier', p.current_tier);
  if (p.occupation !== undefined) setUserProperty('occupation', p.occupation);
  if (p.country_code !== undefined) setUserProperty('country_code', p.country_code);
  if (p.screen_time_permission !== undefined)
    setUserProperty('screen_time_permission', p.screen_time_permission);
  if (p.onboarding_completed !== undefined)
    setUserProperty('onboarding_completed', p.onboarding_completed);
  if (p.currency_balance_bucket !== undefined)
    setUserProperty('currency_balance_bucket', p.currency_balance_bucket);
  if (p.watch_paired !== undefined) setUserProperty('watch_paired', p.watch_paired);
}
