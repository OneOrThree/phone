// user 도메인 API 래퍼 (UserController + ProfileController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
import { api } from '@/services/api';
import { todayStr } from '@/utils/localDate';
import type {
  DeviceTokenRegisterRequest,
  FocusTimeGoalUpdateRequest,
  NotificationSettingsRequest,
  OccupationUpdateRequest,
  ScreenTimeGoalUpdateRequest,
  StatVisibilityUpdateRequest,
  UpdateScreenTimePermissionRequest,
  UserProfileSetupRequest,
  UserProfileUpdateRequest,
  UserProfileResponse,
  SocialLinkResponse,
  PublicProfileResponse,
  UserStatsResponse,
  Provider,
} from '@/types/dto/user';

// POST /api/v1/users/me — 신규 유저 프로필 최초 등록.
export async function setupProfile(body: UserProfileSetupRequest): Promise<void> {
  await api.post('/api/v1/users/me', body);
}

// PATCH /api/v1/users/me — 유저 프로필 부분 수정.
export async function updateProfile(body: UserProfileUpdateRequest): Promise<void> {
  await api.patch('/api/v1/users/me', body);
}

// GET /api/v1/users/me — 본인 프로필 조회.
export async function getMyProfile(): Promise<UserProfileResponse> {
  const { data } = await api.get<UserProfileResponse>('/api/v1/users/me');
  return data;
}

// DELETE /api/v1/users/me — 회원 탈퇴.
export async function withdraw(): Promise<void> {
  await api.delete('/api/v1/users/me');
}

// PATCH /api/v1/users/me/screen-time-permission — 스크린타임 권한 동의 상태 업데이트.
export async function updateScreenTimePermission(
  body: UpdateScreenTimePermissionRequest,
): Promise<void> {
  await api.patch('/api/v1/users/me/screen-time-permission', body);
}

// PUT /api/v1/users/me/device-token — APNs 디바이스 토큰 등록/갱신.
export async function registerDeviceToken(body: DeviceTokenRegisterRequest): Promise<void> {
  await api.put('/api/v1/users/me/device-token', body);
}

// PUT /api/v1/users/me/notification-settings — 알림·심야·소리 설정 저장.
export async function updateNotificationSettings(body: NotificationSettingsRequest): Promise<void> {
  await api.put('/api/v1/users/me/notification-settings', body);
}

// PATCH /api/v1/users/me/screen-time-goal — 일일 스크린타임 목표(분) 수정.
export async function updateScreenTimeGoal(body: ScreenTimeGoalUpdateRequest): Promise<void> {
  await api.patch('/api/v1/users/me/screen-time-goal', body);
}

// PATCH /api/v1/users/me/focus-time-goal — 일일 집중 시간 목표(분) 수정.
export async function updateFocusTimeGoal(body: FocusTimeGoalUpdateRequest): Promise<void> {
  await api.patch('/api/v1/users/me/focus-time-goal', body);
}

// PATCH /api/v1/users/me/occupation — 준비 시험 카테고리 저장.
export async function updateOccupation(body: OccupationUpdateRequest): Promise<void> {
  await api.patch('/api/v1/users/me/occupation', body);
}

// PATCH /api/v1/users/me/stat-visibility — 통계 공개 범위(PUBLIC/FRIENDS) 저장.
export async function updateStatVisibility(body: StatVisibilityUpdateRequest): Promise<void> {
  await api.patch('/api/v1/users/me/stat-visibility', body);
}

// GET /api/v1/users/me/social-links — 연동된 소셜 계정 목록 조회.
export async function getSocialLinks(): Promise<SocialLinkResponse[]> {
  const { data } = await api.get<SocialLinkResponse[]>('/api/v1/users/me/social-links');
  return data;
}

// DELETE /api/v1/users/me/social-links/{provider} — 소셜 연동 해제.
export async function unlinkSocialAccount(provider: Provider): Promise<void> {
  await api.delete(`/api/v1/users/me/social-links/${provider}`);
}

// GET /api/v1/users/{userId}/profile — 타 유저 공개 프로필 조회.
export async function getPublicProfile(userId: string): Promise<PublicProfileResponse> {
  const { data } = await api.get<PublicProfileResponse>(`/api/v1/users/${userId}/profile`);
  return data;
}

// GET /api/v1/users/{userId}/stats — 타 유저 통계 조회(본인·친구·전체공개면 상세).
// date는 서버 필수 파라미터(GROMO-643 — '오늘'·최근 7일 기준을 클라 로컬 날짜로 산정).
// 미전송 시 400으로 상세 통계 전체가 떨어지므로 기본값으로 항상 로컬 오늘을 채운다.
export async function getUserStats(
  userId: string,
  date: string = todayStr(),
): Promise<UserStatsResponse> {
  const { data } = await api.get<UserStatsResponse>(`/api/v1/users/${userId}/stats`, {
    params: { date },
  });
  return data;
}
