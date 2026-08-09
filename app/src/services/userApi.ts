// user 도메인 API 래퍼 (UserController + ProfileController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
// (예외: deleteDeviceToken — 세션 정리용이라 인터셉터 없는 bare axios를 쓴다. 아래 주석 참고.)
import axios from 'axios';
import { api, API_URL } from '@/services/api';
import { todayStrKst } from '@/utils/localDate';
import { setServerZone } from '@/utils/serverZone';
import type {
  DeviceTokenRegisterRequest,
  FocusTimeGoalUpdateRequest,
  NicknameCheckResponse,
  NotificationSettingsRequest,
  OccupationResponse,
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
// countryCode를 보내면 서버 날짜 버킷 존(timeZone)이 함께 바뀐다(CountryZoneResolver) — 캐시된 존을
// 갱신하지 않으면 GB 유저가 백필된 직후에도 앱은 재시작 전까지 Asia/Seoul 날짜 키를 만들어, 두 존의
// 자정 근처 세션이 폐기·오귀속된다(GROMO-1252 6차 ②). PATCH는 204(본문 없음)라 프로필을 다시 읽어
// 서버가 준 존 문자열을 그대로 쓴다 — country→zone 매핑 정본은 서버 한 곳(4차 결정) 그대로다.
// 호출부(App.tsx 백필·ProfileEditScreen 저장)마다 붙이지 않고 여기서 한 번에 처리한다.
// 재조회 실패는 삼킨다 — 존은 직전 값이 유지되고 다음 실행의 부트스트랩이 바로잡는다.
export async function updateProfile(body: UserProfileUpdateRequest): Promise<void> {
  await api.patch('/api/v1/users/me', body);
  if (!body.countryCode) return;
  const profile = await getMyProfile().catch(() => null);
  if (profile) setServerZone(profile.timeZone);
}

// GET /api/v1/users/me — 본인 프로필 조회.
export async function getMyProfile(): Promise<UserProfileResponse> {
  const { data } = await api.get<UserProfileResponse>('/api/v1/users/me');
  return data;
}

// GET /api/v1/users/nickname/check?nickname= — 닉네임 사용 가능 여부 실시간 확인(GROMO-1215).
// 항상 200 {available} — 형식 위반도 available=false로 온다. 문구 구분은 호출부의
// 로컬 형식검사(2~10자)가 선행하고, 이 응답은 중복 여부의 답으로만 읽는다.
export async function checkNickname(nickname: string): Promise<NicknameCheckResponse> {
  const { data } = await api.get<NicknameCheckResponse>('/api/v1/users/nickname/check', {
    params: { nickname },
  });
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

// DELETE /api/v1/users/me/device-token — 디바이스 토큰 등록 해제.
// 로그아웃·계정 전환 시 호출 — 서버가 이전 계정 푸시를 이 기기로 계속 보내지 않게(PR 224 리뷰).
// 공유 api 인스턴스를 쓰지 않는다 — 이전 계정 토큰이 만료 상태면 401 인터셉터가 전역 로그아웃을
// 발동시켜 방금 로그인한 계정까지 로그아웃될 수 있어(PR 226 리뷰), 정리 대상 계정의 토큰을
// 명시한 bare axios로 보낸다.
export async function deleteDeviceToken(accessToken: string): Promise<void> {
  await axios.delete(`${API_URL}/api/v1/users/me/device-token`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
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

// GET /api/v1/occupations — 선택 가능한 occupation(카테고리) 전역 목록(code·표시명·노출순서).
export async function getOccupations(): Promise<OccupationResponse[]> {
  const { data } = await api.get<OccupationResponse[]>('/api/v1/occupations');
  return data;
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
// date는 서버 필수 파라미터(GROMO-643 — '오늘'·최근 7일의 기준일). 미전송 시 400으로 상세 통계
// 전체가 떨어진다. 서버는 이 값을 KST 일별 버킷에 그대로 조회하므로 기본값은 KST 오늘이다
// (GROMO-1236 — 비KST 기기에서 로컬 날짜를 보내면 하루 오귀속).
export async function getUserStats(
  userId: string,
  date: string = todayStrKst(),
): Promise<UserStatsResponse> {
  const { data } = await api.get<UserStatsResponse>(`/api/v1/users/${userId}/stats`, {
    params: { date },
  });
  return data;
}
