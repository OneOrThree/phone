// friend 도메인 API 래퍼 (FriendController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
import { api } from '@/services/api';
import type {
  FriendResponse,
  FriendRequestResponse,
  FriendSearchResultResponse,
  PinnedFriendResponse,
  FriendRequestCreateRequest,
  FriendRequestType,
  SearchType,
} from '@/types/dto/friend';

// GET /api/v1/friends — ACCEPTED·미삭제 친구 목록.
export async function getFriends(): Promise<FriendResponse[]> {
  const { data } = await api.get<FriendResponse[]>('/api/v1/friends');
  return data;
}

// GET /api/v1/friends/requests?type — 받은(received) | 보낸(sent) PENDING 요청 목록.
export async function getFriendRequests(type: FriendRequestType): Promise<FriendRequestResponse[]> {
  const { data } = await api.get<FriendRequestResponse[]>('/api/v1/friends/requests', {
    params: { type },
  });
  return data;
}

// POST /api/v1/friends/requests — 친구 요청 생성(targetUserId 대상).
export async function createFriendRequest(body: FriendRequestCreateRequest): Promise<void> {
  await api.post('/api/v1/friends/requests', body);
}

// POST /api/v1/friends/requests/{id}/accept — 친구 요청 수락(수신자만).
export async function acceptFriendRequest(id: string): Promise<void> {
  await api.post(`/api/v1/friends/requests/${id}/accept`);
}

// POST /api/v1/friends/requests/{id}/reject — 친구 요청 거절(수신자만).
export async function rejectFriendRequest(id: string): Promise<void> {
  await api.post(`/api/v1/friends/requests/${id}/reject`);
}

// DELETE /api/v1/friends/{friendUserId} — 친구 삭제(양측 누구나 soft delete).
export async function deleteFriend(friendUserId: string): Promise<void> {
  await api.delete(`/api/v1/friends/${friendUserId}`);
}

// GET /api/v1/friends/search?type&q — 친구 검색(NICKNAME|CODE), 자기자신 제외.
export async function searchFriends(
  type: SearchType,
  q: string,
): Promise<FriendSearchResultResponse[]> {
  const { data } = await api.get<FriendSearchResultResponse[]>('/api/v1/friends/search', {
    params: { type, q },
  });
  return data;
}

// POST /api/v1/friends/{friendUserId}/pin — 친구 핀 설정(멱등).
export async function pinFriend(friendUserId: string): Promise<void> {
  await api.post(`/api/v1/friends/${friendUserId}/pin`);
}

// DELETE /api/v1/friends/{friendUserId}/pin — 친구 핀 해제(멱등).
export async function unpinFriend(friendUserId: string): Promise<void> {
  await api.delete(`/api/v1/friends/${friendUserId}/pin`);
}

// GET /api/v1/friends/pinned — 핀한 친구 목록(캐릭터 + 오늘 집중분 + 현재 집중 여부).
export async function getPinnedFriends(): Promise<PinnedFriendResponse[]> {
  const { data } = await api.get<PinnedFriendResponse[]>('/api/v1/friends/pinned');
  return data;
}
