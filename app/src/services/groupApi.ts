// group 도메인 API 래퍼 (GroupController, base /api/v1) — 명세 docs/app/group-plan.md §8.
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
// 쓰지 않는 엔드포인트(코드 재발급·그룹 수정·설정)는 여기에 두지 않는다 — 폐기 개념(§0).
// 챌린지 3종은 2차에서 되살렸다(docs/app/group-plan-2.md §1, 계약 정본은 docs/back/group-plan-2.md §1).
// 내기 2종은 3차(docs/app/group-bet-plan.md §2, 계약 정본은 docs/back/group-bet-plan.md §2).
import axios from 'axios';
import { api } from '@/services/api';
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
  GroupSummaryResponse,
} from '@/types/dto/group';

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

// POST /api/v1/groups/{groupId}/join — 그룹 참여. 코드·비밀번호를 폐기했으므로 항상 빈 바디다(§0).
export async function joinGroup(groupId: string): Promise<void> {
  await api.post<void>(`/api/v1/groups/${groupId}/join`, {});
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
export async function deleteChallenge(groupId: string, challengeId: string): Promise<void> {
  await api.delete<void>(`/api/v1/groups/${groupId}/challenges/${challengeId}`);
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

// 서버 에러 바디({ code, message })의 code를 뽑는다. axios 에러가 아니거나 바디가 없으면 null.
// HTTP status가 아니라 이 code로 분기한다 — ROOM_FULL·ALREADY_MEMBER가 둘 다 409라
// status만으론 구분되지 않는다(§3-2). 모르는 code는 화면에서 공통 문구로 떨어뜨린다.
export function groupErrorCode(e: unknown): string | null {
  if (!axios.isAxiosError(e)) return null;
  const body = e.response?.data as { code?: string } | undefined;
  return body?.code ?? null;
}
