// 서버 group 도메인 DTO 미러 (com.oneorthree.phone.group.dto).
// 값 단위·의미는 백엔드 기준. 시각(Instant)은 ISO 문자열, 챌린지 window(String)는 백엔드 원본 문자열.
// ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.

// 미션 카테고리 (Java enum MissionCategory).
export type MissionCategory = 'FOCUS' | 'SCREEN_TIME';
// 미션 타입 (Java enum MissionType).
export type MissionType = 'TIME_WINDOW' | 'DURATION';
// 그룹 챌린지 상태 (Java enum GroupChallengeStatus).
export type GroupChallengeStatus = 'ACTIVE' | 'ENDED';
// 그룹 멤버 역할 (Java enum GroupMemberRole).
export type GroupMemberRole = 'OWNER' | 'MEMBER';
// 그룹 상태 (Java enum GroupStatus).
export type GroupStatus = 'WAITING' | 'ACTIVE' | 'ENDED' | 'CLOSED';
// 그룹 권한 범위 (Java enum GroupPermissionScope).
export type GroupPermissionScope = 'OWNER_ONLY' | 'ALL_MEMBERS';
// 그룹 설정 비밀번호 동작 (UpdateGroupRequest.PasswordAction).
export type PasswordAction = 'SET' | 'REMOVE';

// POST /groups — 그룹 생성 요청.
export interface CreateGroupRequest {
  name: string;
  password?: string; // 없으면 공개 그룹
  description?: string; // 최대 200자
  maxMembers?: number; // 1~10
  missionType: MissionType;
  missionCategory: MissionCategory;
  durationMinutes?: number; // DURATION 타입일 때
  windowStart?: string; // Instant, TIME_WINDOW 타입일 때
  windowEnd?: string; // Instant, TIME_WINDOW 타입일 때
}

// POST /groups — 그룹 생성 응답 (record).
export interface CreateGroupResponse {
  groupId: string;
  code: string;
}

// GET /groups — 내 그룹 목록 항목.
export interface GroupSummaryResponse {
  groupId: string;
  name: string;
  code: string;
  currentMembers: number;
  maxMembers: number;
  role: GroupMemberRole;
  status: GroupStatus;
}

// POST /groups/{groupId}/join — 그룹 참가 요청.
export interface JoinGroupRequest {
  password?: string; // 비밀번호 그룹만
}

// GET /groups/{groupId}/overview — 그룹 개요(공개 정보).
export interface GroupOverviewResponse {
  id: string;
  name: string;
  description: string | null;
  missionCategory: MissionCategory;
  missionType: MissionType;
  durationMinutes: number | null;
  windowStart: string | null; // Instant
  windowEnd: string | null; // Instant
  maxMembers: number;
  memberCount: number;
  status: GroupStatus;
  hasPassword: boolean;
  member: boolean; // Java boolean isMember (class getter → JSON key 'member')
}

// GET /groups/search — 그룹 검색 결과 항목.
export interface GroupSearchResponse {
  groupId: string;
  name: string;
  currentMembers: number;
  maxMembers: number;
  status: GroupStatus;
  hasPassword: boolean;
}

// POST /groups/{groupId}/code — 초대 코드 갱신 응답.
export interface RenewGroupCodeResponse {
  code: string;
  codeExpiresAt: string; // Instant
}

// GET /groups/{groupId} — 그룹 상세의 멤버 항목.
export interface GroupDetailMemberResponse {
  userId: string;
  nickname: string;
  role: GroupMemberRole;
  focusTimeMinutes: number | null;
}

// GET /groups/{groupId} — 그룹 상세 조회 (code/codeExpiresAt은 OWNER에게만).
export interface GroupDetailResponse {
  id: string;
  name: string;
  description: string | null;
  missionCategory: MissionCategory;
  missionType: MissionType;
  durationMinutes: number | null;
  windowStart: string | null; // Instant
  windowEnd: string | null; // Instant
  maxMembers: number;
  status: GroupStatus;
  members: GroupDetailMemberResponse[];
  code: string | null; // OWNER에게만 반환
  codeExpiresAt: string | null; // Instant, OWNER에게만 반환
  noticeGrantedUserIds: string[]; // OWNER 제외
}

// POST /groups/{groupId}/announcements — 그룹 공지 작성/수정 요청 (작성·수정 공용).
export interface CreateAnnouncementRequest {
  title: string; // 최대 100자
  content: string;
}

// GET /groups/{groupId}/announcements — 그룹 공지 항목.
export interface GroupAnnouncementResponse {
  id: string;
  title: string;
  content: string;
  createdAt: string; // Instant
}

// PATCH /groups/{groupId} — 그룹 설정 부분 수정 요청.
export interface UpdateGroupRequest {
  name?: string;
  description?: string;
  maxMembers?: number;
  passwordAction?: PasswordAction;
  password?: string;
}

// GET /groups/{groupId}/challenges — 그룹 챌린지 항목.
export interface GroupChallengeResponse {
  id: string;
  missionType: MissionType;
  missionCategory: MissionCategory;
  durationMinutes: number | null;
  windowStart: string | null; // 백엔드 원본 문자열
  windowEnd: string | null; // 백엔드 원본 문자열
  timeZone: string | null;
  status: GroupChallengeStatus;
  createdAt: string; // Instant
  canParticipate: boolean;
}

// POST /groups/{groupId}/challenges — 챌린지 생성 요청.
export interface CreateChallengeRequest {
  missionCategory: MissionCategory;
  missionType: MissionType;
  durationMinutes?: number; // DURATION 타입일 때
  windowStart?: string; // Instant, TIME_WINDOW 타입일 때
  windowEnd?: string; // Instant, TIME_WINDOW 타입일 때
  timeZone?: string;
}

// POST /groups/{groupId}/challenges — 챌린지 생성 응답의 미참여자 항목.
export interface CreateChallengeNonParticipant {
  userId: string;
  nickname: string;
}

// POST /groups/{groupId}/challenges — 챌린지 생성 응답.
export interface CreateChallengeResponse {
  id: string;
  nonParticipants: CreateChallengeNonParticipant[];
}

// GET /groups/{groupId}/settings — 그룹 채팅·권한 설정.
export interface GroupSettingsResponse {
  chatEnabled: boolean;
  chatLimitPerPerson: number | null;
  noticePermission: GroupPermissionScope;
  invitePermission: GroupPermissionScope;
  noticeGrantedUserIds: string[];
}

// PATCH /groups/{groupId}/settings — 그룹 채팅·권한 설정 부분 수정 요청 (null 필드는 미변경).
export interface UpdateGroupSettingsRequest {
  chatEnabled?: boolean;
  chatLimitPerPerson?: number;
  noticePermission?: GroupPermissionScope;
  invitePermission?: GroupPermissionScope;
  noticeGrantedUserIds?: string[]; // 빈 배열 = 권한 초기화(방장만), 생략 = 미변경
}
