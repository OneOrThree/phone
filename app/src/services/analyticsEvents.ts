// Track 1 (GA4) 타입드 이벤트 헬퍼.
// 이벤트당 얇은 함수 1개 — 호출부 타입 안전 + 이벤트명/파라미터 계약을 한 곳에 모은다.
// 화면/스토어에서는 이 헬퍼만 import해서 쓰고, track()을 직접 부르지 않는다.
//
// ⚠️ 서버(MP) 소스 이벤트([S])는 의도적으로 제외한다 — 클라에서 중복 발행하면 GA4에서 이중 집계된다.
//    (예: group_joined, poke_received 등은 백엔드 Measurement Protocol이 소유)
//    단 focus_session_completed는 서버 미발행으로 클라 소유로 이관(GROMO-1004) — 서버 MP 배선 시 제외할 것.
// ⚠️ PII 금지: 닉네임/생년월일/원본 식별정보를 이벤트·유저속성으로 보내지 않는다. 파생 비식별값만.
import { track, setUserProperty } from '@/services/analytics';

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
  | 'nickname';

// 스텝 도달(노출) — 전 스텝 커버로 퍼널 이탈 지점을 파악한다(기존 제출/노출 이벤트의 공백 보완).
// 같은 플로우에서 처음 도달한 스텝만 발행(뒤로가기 재방문 제외 — "어디까지 갔나" 의미 유지).
// step_index는 런타임 진행 위치 — 동적 분기(과목 편집 삽입)로 유저마다 다를 수 있어 순서 참고용,
// 스텝 구분·퍼널 단계 정의는 step 파라미터로 한다.
export function logOnboardingStepViewed(p: { step: OnboardingStepName; step_index: number }): void {
  track('onboarding_step_viewed', p);
}

// W4 집중 카테고리(목표) 선택 제출 🆕
export function logOnboardingFocusCategorySubmitted(): void {
  track('onboarding_focus_category_submitted', { step_index: 4 });
}

// W10 스크린타임 권한 요청 / 응답(granted)
export function logOnboardingPermissionRequested(): void {
  track('onboarding_permission_requested', { step_index: 10 });
}
export function logOnboardingPermissionResulted(p: { granted: boolean }): void {
  track('onboarding_permission_resulted', { step_index: 10, ...p });
}

// W11 전날 스크린타임 요약 노출 (has_data: 실제 사용량 확보 여부)
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
// 완료(focus_session_completed)는 원래 서버 검증 이벤트([S])였으나 서버가 MP를 발행하지 않아
// 클라 소유로 이관(GROMO-1004) — 서버 MP 배선에서 이 이벤트를 빼야 이중 집계가 없다.
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
export type FocusViewName = 'character' | 'friends' | 'my_league' | 'all_league';

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
export type HomeButton = 'today_summary_detail' | 'phone_usage' | 'notification_bell';
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
// 통계 화면 진입·기간 탭 전환·과목 필터 선택. 서버 검증 이벤트([S])는 백엔드 MP 소유 — 클라 미발행.
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
// created/joined/left 등 서버 검증 이벤트([S])는 백엔드 MP 소유 — 클라 미발행.
// 'deferred_invite' = 미설치 상태에서 링크를 누르고 설치 후 복원된 초대(초대 링크 스펙 §4-3).
export type GroupJoinMethod = 'code' | 'search' | 'invite' | 'deferred_invite';

export function logGroupCreateStarted(): void {
  track('group_create_started');
}
export function logGroupSearchPerformed(p: { query_length: number; result_count: number }): void {
  track('group_search_performed', p);
}
// 참여 시도 — slug는 초대 링크 경로로 들어온 경우에만 실린다(검색 참여엔 없음).
export function logGroupJoinAttempted(p: { join_method: GroupJoinMethod; slug?: string }): void {
  track('group_join_attempted', p);
}
export function logGroupViewed(): void {
  track('group_viewed');
}
export function logGroupTabViewed(p: { tab: string }): void {
  track('group_tab_viewed', p);
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
// 이 표는 이벤트별 발행 주체가 한 곳뿐인 것이 계약이다 — invite_link_created(1)·
// invite_link_clicked(3)·invite_match_resolved(5)·group_joined(8)은 **서버 MP 소유**라
// 여기에 함수를 만들지 않는다(만드는 순간 이중 집계가 된다).

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

// ── 그룹 챌린지 내기(3차) [C] ── (docs/app/group-bet-plan.md §2)
// 내기 개설·참가는 서버 MP 이벤트가 아직 없어 클라가 소유한다([S]로 이관되면 여기서 지운다).
// **API 성공 시에만** 발행한다 — 잔액 부족·중복으로 튕긴 시도까지 세면 실제 성립한 내기 수가 부푼다.
// stake는 판돈 금액(서버 허용값 {10,30,50,100}) — 금액대별 참여율을 보는 유일한 축이다.
export function logGroupBetCreated(p: { stake: number }): void {
  track('group_bet_created', p);
}
export function logGroupBetJoined(p: { stake: number }): void {
  track('group_bet_joined', p);
}

// ── 그룹 챌린지 결과(확장 배치 A3) [C] ── (challenge-impl-2026-08/contract.md §2 계측 표)
// 퍼널 "챌린지 생성 → 내기 → **결과 확인** → 재참여"의 결과 확인 칸. API 이벤트가 아니라
// 모달 노출/닫기라 클라 소유가 자연스럽다.
// achieved는 **내 결과**다 — null(집계 중)이면 파라미터를 싣지 않는다(sanitize가 undefined 생략).
export function logGroupChallengeResultShown(p: {
  mission_type: string;
  mission_category: string;
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

// 정산 결과/창 종료 푸시 탭 → 앱 진입(계약 §2 계측 표 push_opened).
// 기존 notification_opened는 소문자 4종(poke/report/challenge/rank_change) 전용이라 이 두 타입을
// 세지 못한다 — 타입 집합이 겹치지 않아 이중 집계 없이 별도 이벤트로 계약에 고정됐다.
export type PushOpenedType = 'BET_RESULT' | 'CHALLENGE_WINDOW_END';
export function logPushOpened(p: { type: PushOpenedType }): void {
  track('push_opened', p);
}

// ── 그룹 Fakedoor [C] ── (GROMO-597)
// 실기능 미구현 준비중 화면의 수요 측정. 기존 group_viewed와 분리 —
// 미래에 실제 그룹 기능이 켜지면 group_viewed가 실조회를 뜻하게 되므로 지표 오염을 막는다.
//
// ⚠️ 발행 중단(2026-08-01) — 실기능 전환으로 GroupComingSoonScreen이 삭제되면서 호출부가 0이 됐다.
//    과거 Fakedoor 구간의 지표 정의를 대시보드 쪽에서 되짚을 수 있게 함수만 남긴다.
//    (기존 설치본의 AsyncStorage 'gromo:group:notifyRequested' 값은 정리 경로가 없어 남는다 — 무해.)
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
// 빡침 연타 감지 — RageTapDetector(앱 루트)가 발행. 같은 지점(40pt) 1초 간격 연타 4회째, 5초 쿨다운.
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
