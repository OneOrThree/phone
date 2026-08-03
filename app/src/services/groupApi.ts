// group 도메인 API 래퍼 (GroupController, base /api/v1) — 명세 docs/app/group-plan.md §8.
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
// 쓰지 않는 엔드포인트(코드 재발급·그룹 수정·설정)는 여기에 두지 않는다 — 폐기 개념(§0).
// 챌린지 3종은 2차에서 되살렸다(docs/app/group-plan-2.md §1, 계약 정본은 docs/back/group-plan-2.md §1).
// 내기 2종은 3차(docs/app/group-bet-plan.md §2, 계약 정본은 docs/back/group-bet-plan.md §2).
import axios from 'axios';
import { api } from '@/services/api';
import { logGroupChallengeDeleted, type GroupJoinMethod } from '@/services/analyticsEvents';
import { todayStr } from '@/utils/localDate';
import type {
  CreateAnnouncementRequest,
  CreateBetRequest,
  CreateBetResponse,
  CreateChallengeRequest,
  CreateChallengeResponse,
  CreateGroupRequest,
  CreateGroupResponse,
  GroupAnnouncementResponse,
  GroupChallengeResponse,
  GroupDetailResponse,
  GroupOverviewResponse,
  GroupSearchResponse,
  GroupSettingsResponse,
  GroupSummaryResponse,
  MissionCategory,
  UpdateGroupRequest,
  UpdateGroupSettingsRequest,
} from '@/types/dto/group';

// ── 신설 서버 에러코드(계약 §2 — 앱이 code 문자열로 분기) ────────────────────────
// 화면 switch가 흩어 쓰는 리터럴의 오타를 막으려고 상수로 못 박는다(신설분만 —
// 기존 분기 리터럴까지 소급 치환하면 diff가 계약 밖으로 번진다).
export const CHALLENGE_DUPLICATE = 'CHALLENGE_DUPLICATE'; // 409 카테고리×타입 활성 중복
export const CHALLENGE_WINDOW_OVERLAP = 'CHALLENGE_WINDOW_OVERLAP'; // 409 창 시간대 겹침
export const BET_ALREADY_FAILED = 'BET_ALREADY_FAILED'; // 409 스크린타임 이미 목표 초과(확정 패배)
export const BET_CANCEL_FORBIDDEN = 'BET_CANCEL_FORBIDDEN'; // 403 개설자 아님
export const BET_CANCEL_HAS_OTHERS = 'BET_CANCEL_HAS_OTHERS'; // 409 타 참가자 존재
export const BET_NOT_OPEN = 'BET_NOT_OPEN'; // 409 이미 정산·취소된 내기
// 참가 철회(챌린지 개선 배치, contract.md §4 — W4 신설 코드).
export const BET_NOT_JOINED = 'BET_NOT_JOINED'; // 409 참가 이력 없음
export const BET_LEAVE_CLOSED = 'BET_LEAVE_CLOSED'; // 409 시작 이후(집계 진행 중)

// POST /api/v1/groups — 그룹 생성. password·description은 보내지 않는다(§3-1-3).
export async function createGroup(body: CreateGroupRequest): Promise<CreateGroupResponse> {
  const { data } = await api.post<CreateGroupResponse>('/api/v1/groups', body);
  return data;
}

// GET /api/v1/groups — 내가 참여 중인 그룹 목록. 그룹 1개 전제라 화면은 [0]만 쓴다(§6-1).
export async function getMyGroups(): Promise<GroupSummaryResponse[]> {
  const { data } = await api.get<GroupSummaryResponse[]>('/api/v1/groups');
  return data;
}

// GET /api/v1/groups/search?query — 이름 검색(pg_trgm). 비공개방은 서버가 제외한다.
export async function searchGroups(query: string): Promise<GroupSearchResponse[]> {
  const { data } = await api.get<GroupSearchResponse[]>('/api/v1/groups/search', {
    params: { query },
  });
  return data;
}

// POST /api/v1/groups/{groupId}/join — 그룹 참여. 코드·비밀번호는 폐기 개념이라 보내지 않는다(§0).
//
// 어트리뷰션 3필드는 전부 optional 이다(초대 링크 스펙 §4-2 '기존 API 확장') — 서버가 아직
// 안 받는 구버전이어도, 앱이 안 보내는 경로(검색 참여)여도 그대로 동작해야 한다.
// 없으면 예전과 똑같이 빈 바디 `{}`를 보낸다 — 생략하면 서버가 415를 준다(§2-2).
export interface JoinAttribution {
  joinMethod: GroupJoinMethod;
  inviteSlug?: string;
  appInstanceId?: string;
}

export async function joinGroup(groupId: string, attribution?: JoinAttribution): Promise<void> {
  const body: Record<string, string> = {};
  if (attribution) {
    body.joinMethod = attribution.joinMethod;
    // 값이 없는 키는 아예 싣지 않는다 — null 을 보내면 서버 검증이 '빈 slug'로 볼 여지가 생긴다.
    if (attribution.inviteSlug) body.inviteSlug = attribution.inviteSlug;
    if (attribution.appInstanceId) body.appInstanceId = attribution.appInstanceId;
  }
  await api.post<void>(`/api/v1/groups/${groupId}/join`, body);
}

// GET /api/v1/groups/{groupId}/overview — 무권한 공개 조회(참여 여부 무관, isMember 포함).
// 초대 링크 프리뷰는 반드시 이걸 쓴다 — 상세(getGroupDetail)는 그룹원만이라 참여 전엔 403(§3-1-4).
export async function getGroupOverview(groupId: string): Promise<GroupOverviewResponse> {
  const { data } = await api.get<GroupOverviewResponse>(`/api/v1/groups/${groupId}/overview`);
  return data;
}

// GET /api/v1/groups/{groupId}?date — 그룹 상세(그룹원만).
// date는 서버 필수 파라미터라 누락 시 400. 멤버 '오늘 집중분'의 기준일이므로 클라 로컬 날짜를 보낸다(§3-1-1).
export async function getGroupDetail(groupId: string, date?: string): Promise<GroupDetailResponse> {
  const { data } = await api.get<GroupDetailResponse>(`/api/v1/groups/${groupId}`, {
    params: { date: date ?? todayStr() },
  });
  return data;
}

// DELETE /api/v1/groups/{groupId}/members/me — 그룹 나가기. 방장은 400 HOST_WITHDRAW(§14).
export async function withdrawGroup(groupId: string): Promise<void> {
  await api.delete<void>(`/api/v1/groups/${groupId}/members/me`);
}

// PATCH /api/v1/groups/{groupId} — 그룹 설정 수정(방장만). 부분 수정: 보낸 필드만 반영, 204.
// A-1: 이름·소개·정원·공개설정. 정원을 현재 인원 미만으로 줄이면 서버가 MAX_MEMBERS_TOO_SMALL(400).
export async function updateGroup(groupId: string, body: UpdateGroupRequest): Promise<void> {
  await api.patch<void>(`/api/v1/groups/${groupId}`, body);
}

// PATCH /api/v1/groups/{groupId}/members/{targetUserId}/owner — 방장 위임(방장만), 204.
// A-2: 대상 멤버가 새 OWNER가 되고 기존 방장은 MEMBER로 내려간다.
export async function transferOwner(groupId: string, targetUserId: string): Promise<void> {
  await api.patch<void>(`/api/v1/groups/${groupId}/members/${targetUserId}/owner`, {});
}

// DELETE /api/v1/groups/{groupId}/members/{targetUserId} — 멤버 강퇴(방장만), 204.
// A-3: 강퇴된 멤버는 재가입이 차단된다(서버 KICKED_CANNOT_REJOIN). 자기 자신 강퇴는 CANNOT_KICK_SELF.
export async function kickMember(groupId: string, targetUserId: string): Promise<void> {
  await api.delete<void>(`/api/v1/groups/${groupId}/members/${targetUserId}`);
}

// GET /api/v1/groups/{groupId}/settings — 공지 권한 설정 조회(방장만).
// A-4: 전 멤버(방장 포함)의 announcementGrants. 방장은 항상 granted=true(토글 불가).
export async function getGroupSettings(groupId: string): Promise<GroupSettingsResponse> {
  const { data } = await api.get<GroupSettingsResponse>(`/api/v1/groups/${groupId}/settings`);
  return data;
}

// PATCH /api/v1/groups/{groupId}/settings — 공지 권한 변경(방장만), 204.
// A-4: announcementGrants 항목별 granted upsert. 목록에 없는 멤버는 미변경.
export async function updateGroupSettings(
  groupId: string,
  body: UpdateGroupSettingsRequest,
): Promise<void> {
  await api.patch<void>(`/api/v1/groups/${groupId}/settings`, body);
}

// GET /api/v1/groups/{groupId}/announcements — 공지 목록(서버가 최신순 정렬, 앱 재정렬 금지).
export async function getAnnouncements(groupId: string): Promise<GroupAnnouncementResponse[]> {
  const { data } = await api.get<GroupAnnouncementResponse[]>(
    `/api/v1/groups/${groupId}/announcements`,
  );
  return data;
}

// POST /api/v1/groups/{groupId}/announcements — 공지 작성(방장·권한 멤버만).
export async function createAnnouncement(
  groupId: string,
  body: CreateAnnouncementRequest,
): Promise<void> {
  await api.post<void>(`/api/v1/groups/${groupId}/announcements`, body);
}

// PUT /api/v1/groups/{groupId}/announcements/{id} — 공지 수정(방장·권한 멤버만).
export async function updateAnnouncement(
  groupId: string,
  id: string,
  body: CreateAnnouncementRequest,
): Promise<void> {
  await api.put<void>(`/api/v1/groups/${groupId}/announcements/${id}`, body);
}

// DELETE /api/v1/groups/{groupId}/announcements/{id} — 공지 삭제(방장·권한 멤버만).
export async function deleteAnnouncement(groupId: string, id: string): Promise<void> {
  await api.delete<void>(`/api/v1/groups/${groupId}/announcements/${id}`);
}

// 챌린지 메타 캐시 — 목록 조회(getChallenges)의 응답에서 challengeId별 메타를 받아 둔다.
// 쓰임 2곳(둘 다 화면에 뜬 카드에서만 시작되는 동작이라 실질 항상 적중한다):
//  · 삭제 계측(group_challenge_deleted) — 이벤트는 mission_type/category 파라미터가 계약인데
//    (계약 §계측 표) 삭제 호출부(GroupRoomScreen)는 challengeId만 넘긴다. 적중 실패 시
//    이벤트를 생략한다 — 파라미터 없는 반쪽 이벤트로 지표를 오염시키지 않는다.
//  · 내기 취소의 groupId 역참조(challengeGroupId) — 취소 진입점이 사는 ChallengeCard는
//    groupId prop이 없고, 호출부(GroupRoomScreen)는 A3 전유라 이 배치에서 prop을 못 늘린다.
const challengeMetaCache = new Map<
  string,
  {
    groupId: string;
    missionType: GroupChallengeResponse['missionType'];
    missionCategory: MissionCategory;
  }
>();

// 이 챌린지를 마지막으로 내려준 그룹 — ChallengeCard의 내기 취소가 cancelBet 경로를 만들 때 쓴다.
// 캐시 미적중(이론상 앱 재시작 직후뿐)이면 null — 호출부는 공통 실패 문구로 떨어뜨린다.
export function challengeGroupId(challengeId: string): string | null {
  return challengeMetaCache.get(challengeId)?.groupId ?? null;
}

// GET /api/v1/groups/{groupId}/challenges?date — 챌린지 목록(그룹원만).
// date는 서버 **선택** 파라미터라 getGroupDetail과 달리 기본값을 채우지 않는다 —
// date를 보낼 때만 memberProgress가 실리므로(안 보내면 null) 진행률이 필요한 화면이 명시적으로 넘긴다.
// 멤버 진행률의 기준일이므로 넘길 때는 클라 로컬 날짜(todayStr())를 쓴다.
export async function getChallenges(
  groupId: string,
  date?: string,
): Promise<GroupChallengeResponse[]> {
  const { data } = await api.get<GroupChallengeResponse[]>(
    `/api/v1/groups/${groupId}/challenges`,
    date ? { params: { date } } : undefined,
  );
  for (const c of data) {
    challengeMetaCache.set(c.id, {
      groupId,
      missionType: c.missionType,
      missionCategory: c.missionCategory,
    });
  }
  return data;
}

// POST /api/v1/groups/{groupId}/challenges — 챌린지 생성(방장만).
// SCREEN_TIME이면 응답 nonParticipants에 권한 미허용 멤버가 담겨 온다 — 화면이 안내에 쓴다.
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

// DELETE /api/v1/groups/{groupId}/challenges/{challengeId} — 챌린지 삭제(방장만, 서버는 soft delete).
// 계측(group_challenge_deleted)은 **서버가 삭제를 수락한 뒤에만** 발행한다 — 실패한 시도까지
// 세면 실제 삭제 수가 부푼다(BetSheet의 '성공 시에만 발행' 규칙과 동일).
export async function deleteChallenge(groupId: string, challengeId: string): Promise<void> {
  await api.delete<void>(`/api/v1/groups/${groupId}/challenges/${challengeId}`);
  const meta = challengeMetaCache.get(challengeId);
  if (meta) {
    logGroupChallengeDeleted({
      mission_type: meta.missionType,
      mission_category: meta.missionCategory,
    });
  }
}

// POST /api/v1/groups/{groupId}/challenges/{challengeId}/bets — 내기 개설(그룹원 누구나).
// 개설자는 자동 참가하고 판돈이 즉시 차감된다(에스크로) — 계약 docs/back/group-bet-plan.md §2-1.
// date는 내기의 기준일이라 클라 로컬 날짜를 그대로 싣는다(챌린지 진행률 기준일과 같은 날).
export async function createBet(
  groupId: string,
  challengeId: string,
  body: CreateBetRequest,
): Promise<CreateBetResponse> {
  const { data } = await api.post<CreateBetResponse>(
    `/api/v1/groups/${groupId}/challenges/${challengeId}/bets`,
    body,
  );
  return data;
}

// POST /api/v1/groups/{groupId}/bets/{betId}/join — 내기 참가(판돈 차감), 204.
// 바디는 항상 {} 다 — joinGroup과 같은 이유로 생략하면 서버가 415를 준다(§2-2).
export async function joinBet(groupId: string, betId: string): Promise<void> {
  await api.post<void>(`/api/v1/groups/${groupId}/bets/${betId}/join`, {});
}

// DELETE /api/v1/groups/{groupId}/bets/{betId} — 내기 취소(개설자 단독·OPEN일 때만), 204.
// 서버가 판돈을 환불한다(정산 환불과 같은 원장 키 — 이중 환불 없음, 계약 §2).
// 에러: BET_CANCEL_FORBIDDEN(403) · BET_CANCEL_HAS_OTHERS(409) · BET_NOT_OPEN(409).
export async function cancelBet(groupId: string, betId: string): Promise<void> {
  await api.delete<void>(`/api/v1/groups/${groupId}/bets/${betId}`);
}

// DELETE /api/v1/groups/{groupId}/bets/{betId}/participation — 내기 참가 철회(계약 §4), 204.
// 호출자 **본인의 참가만** 철회하고 본인 참가비를 전액 환불한다. 허용 조건(참가자·OPEN·시작 전)은
// 서버가 정본이다 — 마지막 참가자가 떠나면 서버가 내기를 CANCELED로 자동 닫는다(개설자 철회 허용).
// 에러: BET_NOT_JOINED(409) · BET_LEAVE_CLOSED(409) · BET_NOT_OPEN(409).
// 기존 cancelBet(개설자 단독 취소)은 구버전 앱 호환으로 서버에 남는다 — 신규 UI는 이 함수 하나로 통합.
export async function leaveBet(groupId: string, betId: string): Promise<void> {
  await api.delete<void>(`/api/v1/groups/${groupId}/bets/${betId}/participation`);
}

// 서버 에러 바디({ code, message })의 code를 뽑는다. axios 에러가 아니거나 바디가 없으면 null.
// HTTP status가 아니라 이 code로 분기한다 — ROOM_FULL·ALREADY_MEMBER가 둘 다 409라
// status만으론 구분되지 않는다(§3-2). 모르는 code는 화면에서 공통 문구로 떨어뜨린다.
export function groupErrorCode(e: unknown): string | null {
  if (!axios.isAxiosError(e)) return null;
  const body = e.response?.data as { code?: string } | undefined;
  return body?.code ?? null;
}
