// 서버 group 도메인 DTO 미러 (GroupController, base /api/v1).
// 명세: docs/app/group-plan.md §7. ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.
//
// 폐기된 개념(§0) — 앱은 아래 필드를 절대 쓰지 않는다:
//   · password  : 보내는 순간 그 그룹은 아무도 못 들어온다(§3-1-3)
//   · code      : 참가 코드는 3시간 만료라 초대 흐름이 죽는다 → 링크에 groupId를 담는다(§3-1-5)

export type GroupMemberRole = 'OWNER' | 'MEMBER';
// ⚠️ 서버에 상태 전이가 없어 전 그룹이 영구 WAITING이다 — UI에 노출하지 않는다(§13-5).
export type GroupStatus = 'WAITING' | 'ACTIVE' | 'ENDED';
export type MissionType = 'TIME_WINDOW' | 'DURATION';
export type MissionCategory = 'FOCUS' | 'SCREEN_TIME';

// POST /groups 요청. missionType·missionCategory는 서버 @NotNull이라 챌린지가 범위 밖이어도
// 반드시 보낸다 — 앱은 'DURATION' + 'FOCUS' 고정으로 채운다(§3-1-2).
export interface CreateGroupRequest {
  name: string; // ≤ 50자
  maxMembers: number; // 1~10
  missionType: MissionType; // 'DURATION' 고정
  missionCategory: MissionCategory; // 'FOCUS' 고정
  durationMinutes?: number; // 하루 목표 집중 시간(분)
  isPrivate: boolean; // 백엔드 P1-1(is_private) 선행 필요 — 그전엔 서버가 무시(§13-1)
  // password·description은 절대 보내지 않는다 (§3-1-2, §3-1-3)
}

// POST /groups 응답. code는 무시한다(§3-1-5).
export interface CreateGroupResponse {
  groupId: string;
  code: string;
}

// GET /groups — 내가 참여 중인 그룹 목록(그룹 1개 전제라 [0]만 쓴다).
export interface GroupSummaryResponse {
  groupId: string;
  name: string;
  code: string | null; // 무시
  currentMembers: number;
  maxMembers: number;
  role: GroupMemberRole;
  status: GroupStatus;
  isPrivate?: boolean; // 백엔드 P1-1에서 추가
}

// GET /groups/search?query — 이름 검색(공개방만 내려온다).
export interface GroupSearchResponse {
  groupId: string;
  name: string;
  currentMembers: number;
  maxMembers: number;
  status: GroupStatus;
  hasPassword: boolean; // 무시
}

// GET /groups/{id}/overview — 무권한 공개 엔드포인트(참여 여부 무관). 초대 링크 프리뷰용(§3-1-4).
export interface GroupOverviewResponse {
  id: string;
  name: string;
  description: string | null;
  missionCategory: MissionCategory | null;
  missionType: MissionType | null;
  durationMinutes: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  maxMembers: number;
  memberCount: number;
  status: GroupStatus;
  hasPassword: boolean; // 무시
  isMember: boolean;
}

// GET /groups/{id} 멤버 항목. focusTimeMinutes는 date 기준 '오늘 집중분'(null 가능 → 0분 표기).
export interface GroupDetailMemberResponse {
  userId: string;
  nickname: string;
  role: GroupMemberRole;
  focusTimeMinutes: number | null;
}

// GET /groups/{id}?date — 그룹 상세(그룹원만). code·codeExpiresAt은 읽지 않는다(§3-1-5).
export interface GroupDetailResponse {
  id: string;
  name: string;
  description: string | null;
  missionCategory: MissionCategory | null;
  missionType: MissionType | null;
  durationMinutes: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  maxMembers: number;
  status: GroupStatus;
  members: GroupDetailMemberResponse[];
  code: string | null; // 무시
  codeExpiresAt: string | null; // 무시
  noticeGrantedUserIds: string[]; // 공지 작성 권한 부여 멤버 — 방장과 합쳐 canWriteNotice 판정
  isPrivate?: boolean; // 백엔드 P1-1에서 추가
}

// GET /groups/{id}/announcements — 서버가 createdAt DESC로 정렬해 내려준다(앱 재정렬 금지).
export interface GroupAnnouncementResponse {
  id: string;
  title: string;
  content: string;
  createdAt: string; // ISO 문자열
}

// POST·PUT /groups/{id}/announcements — 공지 작성·수정 요청. title ≤ 100자, content 필수.
export interface CreateAnnouncementRequest {
  title: string;
  content: string;
}
