// group 도메인 API 래퍼 (GroupController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
import { api } from '@/services/api';
import type {
  CreateGroupRequest,
  CreateGroupResponse,
  GroupSummaryResponse,
  JoinGroupRequest,
  GroupOverviewResponse,
  GroupSearchResponse,
  RenewGroupCodeResponse,
  GroupDetailResponse,
  CreateAnnouncementRequest,
  GroupAnnouncementResponse,
  UpdateGroupRequest,
  GroupChallengeResponse,
  CreateChallengeRequest,
  CreateChallengeResponse,
  GroupSettingsResponse,
  UpdateGroupSettingsRequest,
} from '@/legacy/types/group';

// POST /api/v1/groups — 그룹 생성 + 참가 코드 발급.
export async function createGroup(body: CreateGroupRequest): Promise<CreateGroupResponse> {
  const { data } = await api.post<CreateGroupResponse>('/api/v1/groups', body);
  return data;
}

// GET /api/v1/groups — 내가 참여 중인 그룹 목록.
export async function getMyGroups(): Promise<GroupSummaryResponse[]> {
  const { data } = await api.get<GroupSummaryResponse[]>('/api/v1/groups');
  return data;
}

// POST /api/v1/groups/{groupId}/join — 그룹 참가(비밀번호 그룹은 body 포함).
export async function joinGroup(groupId: string, body: JoinGroupRequest): Promise<void> {
  await api.post<void>(`/api/v1/groups/${groupId}/join`, body);
}

// GET /api/v1/groups/{groupId}/overview — 그룹 개요(참여 여부 무관, isMember 포함).
export async function getGroupOverview(groupId: string): Promise<GroupOverviewResponse> {
  const { data } = await api.get<GroupOverviewResponse>(`/api/v1/groups/${groupId}/overview`);
  return data;
}

// GET /api/v1/groups/search?query — 그룹 검색(8자 영숫자=코드 매칭, 그 외 이름 LIKE).
export async function searchGroups(query: string): Promise<GroupSearchResponse[]> {
  const { data } = await api.get<GroupSearchResponse[]>('/api/v1/groups/search', {
    params: { query },
  });
  return data;
}

// POST /api/v1/groups/{groupId}/code — 초대 코드 갱신(그룹장만).
export async function renewGroupCode(groupId: string): Promise<RenewGroupCodeResponse> {
  const { data } = await api.post<RenewGroupCodeResponse>(`/api/v1/groups/${groupId}/code`);
  return data;
}

// GET /api/v1/groups/{groupId} — 그룹 상세(그룹원만, code는 OWNER에게만).
export async function getGroupDetail(groupId: string): Promise<GroupDetailResponse> {
  const { data } = await api.get<GroupDetailResponse>(`/api/v1/groups/${groupId}`);
  return data;
}

// POST /api/v1/groups/{groupId}/announcements — 그룹 공지 작성(OWNER만).
export async function createAnnouncement(
  groupId: string,
  body: CreateAnnouncementRequest,
): Promise<void> {
  await api.post<void>(`/api/v1/groups/${groupId}/announcements`, body);
}

// GET /api/v1/groups/{groupId}/announcements — 그룹 공지 목록(최신순).
export async function getAnnouncements(groupId: string): Promise<GroupAnnouncementResponse[]> {
  const { data } = await api.get<GroupAnnouncementResponse[]>(
    `/api/v1/groups/${groupId}/announcements`,
  );
  return data;
}

// PATCH /api/v1/groups/{groupId} — 그룹 설정 부분 수정(OWNER만).
export async function updateGroup(groupId: string, body: UpdateGroupRequest): Promise<void> {
  await api.patch<void>(`/api/v1/groups/${groupId}`, body);
}

// PATCH /api/v1/groups/{groupId}/members/{targetUserId}/owner — 그룹장 위임(OWNER만).
export async function transferOwner(groupId: string, targetUserId: string): Promise<void> {
  await api.patch<void>(`/api/v1/groups/${groupId}/members/${targetUserId}/owner`);
}

// GET /api/v1/groups/{groupId}/challenges — 그룹 챌린지 목록(최신순).
export async function getChallenges(groupId: string): Promise<GroupChallengeResponse[]> {
  const { data } = await api.get<GroupChallengeResponse[]>(`/api/v1/groups/${groupId}/challenges`);
  return data;
}

// POST /api/v1/groups/{groupId}/challenges — 그룹 챌린지 생성(OWNER만).
export async function createChallenge(
  groupId: string,
  body: CreateChallengeRequest,
): Promise<CreateChallengeResponse> {
  const { data } = await api.post<CreateChallengeResponse>(
    `/api/v1/groups/${groupId}/challenges`,
    body,
  );
  return data;
}

// DELETE /api/v1/groups/{groupId}/challenges/{challengeId} — 그룹 챌린지 삭제(OWNER만).
export async function deleteChallenge(groupId: string, challengeId: string): Promise<void> {
  await api.delete<void>(`/api/v1/groups/${groupId}/challenges/${challengeId}`);
}

// GET /api/v1/groups/{groupId}/settings — 그룹 채팅·권한 설정 조회(OWNER만).
export async function getGroupSettings(groupId: string): Promise<GroupSettingsResponse> {
  const { data } = await api.get<GroupSettingsResponse>(`/api/v1/groups/${groupId}/settings`);
  return data;
}

// PATCH /api/v1/groups/{groupId}/settings — 그룹 채팅·권한 설정 수정(OWNER만, null 필드 미변경).
export async function updateGroupSettings(
  groupId: string,
  body: UpdateGroupSettingsRequest,
): Promise<void> {
  await api.patch<void>(`/api/v1/groups/${groupId}/settings`, body);
}

// PUT /api/v1/groups/{groupId}/announcements/{announcementId} — 그룹 공지 수정(OWNER/권한 멤버).
export async function updateAnnouncement(
  groupId: string,
  announcementId: string,
  body: CreateAnnouncementRequest,
): Promise<void> {
  await api.put<void>(`/api/v1/groups/${groupId}/announcements/${announcementId}`, body);
}

// DELETE /api/v1/groups/{groupId}/announcements/{announcementId} — 그룹 공지 삭제(OWNER/권한 멤버).
export async function deleteAnnouncement(groupId: string, announcementId: string): Promise<void> {
  await api.delete<void>(`/api/v1/groups/${groupId}/announcements/${announcementId}`);
}

// DELETE /api/v1/groups/{groupId}/members/me — 그룹 탈퇴(마지막 1인 탈퇴 시 그룹 CLOSED).
export async function leaveGroup(groupId: string): Promise<void> {
  await api.delete<void>(`/api/v1/groups/${groupId}/members/me`);
}
