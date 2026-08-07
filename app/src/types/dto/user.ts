// 서버 user 도메인 DTO 미러 (com.oneorthree.phone.user).
// 값 단위·의미는 백엔드 기준. UUID/String은 string, 날짜(LocalDate)는 'YYYY-MM-DD', 시각(Instant)은 ISO 문자열.
// ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.
import type { StreakResponse, TodayStatsResponse, HeatmapCellResponse } from '@/types/dto/stats';
import type { CharacterEquipmentResponse } from '@/types/dto/item';

// 소셜 로그인 제공자 (Java enum Provider). SocialLinkResponse.provider / 소셜 연동 해제 path.
export type Provider = 'APPLE' | 'GOOGLE' | 'KAKAO' | 'LINE' | 'INSTAGRAM' | 'FACEBOOK';

// 준비 시험 카테고리 (Java enum Occupation) — GROMO-631에서 실제 목록 19종으로 확장.
// 표시명(한글)은 GET /occupations 의 displayName 으로 서버가 제공.
export type Occupation =
  | 'LABOR_ATTORNEY'
  | 'PATENT_ATTORNEY'
  | 'TAX_ACCOUNTANT'
  | 'CPA'
  | 'APPRAISER'
  | 'CIVIL_SERVANT'
  | 'POLICE_FIRE'
  | 'ADMIN_EXAM'
  | 'CERTIFICATION'
  | 'MIDDLE_SCHOOL'
  | 'HIGH_SCHOOL'
  | 'CSAT'
  | 'UNIVERSITY'
  | 'JOB_PREP'
  | 'ENGLISH_TEST'
  | 'CODING'
  | 'SELF_DEVELOPMENT'
  | 'FOCUS_BUILDING'
  | 'ETC';

// GET /occupations 응답 1건 — code(enum name)·표시명·노출 순서(sort_order 오름차순).
export interface OccupationResponse {
  code: Occupation;
  displayName: string;
  sortOrder: number;
}

// 통계 공개 범위 (Java enum StatVisibility). PUBLIC=리그 전체, FRIENDS=친구만.
export type StatVisibility = 'PUBLIC' | 'FRIENDS';

// PUT /users/me/device-token 요청 — APNs 디바이스 토큰.
export interface DeviceTokenRegisterRequest {
  deviceToken: string;
}

// PATCH /users/me/focus-time-goal 요청 — 일일 집중 시간 목표(분, 0 이상).
export interface FocusTimeGoalUpdateRequest {
  dailyFocusTimeGoalMinutes: number;
}

// PUT /users/me/notification-settings 요청 — 알림/심야/소리 설정.
export interface NotificationSettingsRequest {
  notificationEnabled: boolean;
  soundEnabled: boolean;
  nightModeEnabled: boolean;
  nightStartTime?: string; // 'HH:mm', 선택
  nightEndTime?: string; // 'HH:mm', 선택
}

// PATCH /users/me/occupation 요청 — 준비 시험 카테고리.
export interface OccupationUpdateRequest {
  occupation: Occupation;
}

// PATCH /users/me/stat-visibility 요청 — 통계 공개 범위.
export interface StatVisibilityUpdateRequest {
  statVisibility: StatVisibility;
}

// PATCH /users/me/screen-time-goal 요청 — 일일 스크린타임 목표(분, 0 이상).
export interface ScreenTimeGoalUpdateRequest {
  dailyScreenTimeGoalMinutes: number;
}

// PATCH /users/me/screen-time-permission 요청 — iOS Screen Time 권한 동의 상태.
export interface UpdateScreenTimePermissionRequest {
  granted: boolean;
}

// POST /users/me 요청 — 신규 유저 프로필 최초 등록.
// 서버 필수는 nickname뿐(@NotBlank) — 온보딩이 수집한 필드만 부분 바디로 보낸다(목표 미전송 시 서버 기본 0).
export interface UserProfileSetupRequest {
  nickname: string;
  occupation?: Occupation;
  dailyScreenTimeGoalMinutes?: number;
  dailyFocusTimeGoalMinutes?: number;
  countryCode?: string; // ISO 3166-1 alpha-2
}

// PATCH /users/me 요청 — 유저 프로필 부분 수정(전 필드 선택).
export interface UserProfileUpdateRequest {
  nickname?: string;
  dailyScreenTimeGoalMinutes?: number;
  dailyFocusTimeGoalMinutes?: number;
  countryCode?: string; // ISO 3166-1 alpha-2
}

// GET /users/me 응답 — 본인 프로필. 백엔드 record 필드와 1:1(gender·birthDate 등은 응답에 없음).
export interface UserProfileResponse {
  id: string; // UUID
  nickname: string;
  currency: number;
  dailyScreenTimeGoalMinutes: number;
  dailyFocusTimeGoalMinutes: number;
  countryCode: string | null; // ISO 3166-1 alpha-2 — 미설정 null
  statVisibility: StatVisibility | null; // 미설정 null
  occupation: Occupation | null; // 준비 시험 코드(enum name) — 미설정 null (GROMO-757)
  // ↓ 설정 화면 표시용 — 백엔드 응답 확장 예정(GROMO-559 짝 BE). 도착 전까진 undefined → 로컬 캐시·기본값 폴백.
  notificationEnabled?: boolean;
  soundEnabled?: boolean;
  nightModeEnabled?: boolean;
  nightStartTime?: string; // 'HH:mm'
  nightEndTime?: string; // 'HH:mm'
}

// GET /users/nickname/check 응답 — 닉네임 사용 가능 여부(GROMO-1215).
// 항상 200 — 형식 위반(trim 후 2~10자 밖)도 available=false로 온다(별도 4xx 없음).
export interface NicknameCheckResponse {
  available: boolean;
}

// GET /users/me/social-links 응답 — 연동된 소셜 계정.
export interface SocialLinkResponse {
  provider: string; // Provider enum 명칭
  linkedAt: string; // Instant, 연동 생성 시각
}

// GET /users/{userId}/profile 응답 — 타 유저 공개 프로필.
export interface PublicProfileResponse {
  userId: string; // UUID
  nickname: string;
  occupation: Occupation | null; // 준비 시험 코드 — 미설정 null, 표시명은 앱이 매핑 (GROMO-747)
  equipments: CharacterEquipmentResponse[];
  friendCount: number;
  currentTier: number | null; // 리그 미소속 시 null
  rank: number | null; // 랭킹 없으면 null
}

// GET /users/{userId}/stats 응답 — 타 유저 통계.
export interface UserStatsResponse {
  isFriend: boolean;
  streak: StreakResponse;
  today: TodayStatsResponse | null; // 친구X면 null
  heatmap: HeatmapCellResponse[] | null; // 친구X면 null
}
