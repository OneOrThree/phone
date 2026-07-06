import { api } from '@/services/api';
import type {
  FriendRequestResponse,
  FriendResponse,
  FriendSearchResultResponse,
  PinnedFriendResponse,
} from '@/types/api';

// 친구 API 래퍼 — 백엔드 FriendController(/api/v1/friends*) 대응.
// api(axios)는 비2xx에서 throw — 호출부에서 try/catch로 분기한다(409=중복 등).

export async function fetchFriends(): Promise<FriendResponse[]> {
  const { data } = await api.get<FriendResponse[]>('/api/v1/friends');
  return data;
}

export async function fetchReceivedRequests(): Promise<FriendRequestResponse[]> {
  const { data } = await api.get<FriendRequestResponse[]>('/api/v1/friends/requests', {
    params: { type: 'received' },
  });
  return data;
}

export async function searchFriends(q: string): Promise<FriendSearchResultResponse[]> {
  const { data } = await api.get<FriendSearchResultResponse[]>('/api/v1/friends/search', {
    params: { type: 'NICKNAME', q },
  });
  return data;
}

export async function sendFriendRequest(targetUserId: string): Promise<void> {
  await api.post('/api/v1/friends/requests', { targetUserId });
}

export async function acceptFriendRequest(requestId: string): Promise<void> {
  await api.post(`/api/v1/friends/requests/${requestId}/accept`);
}

export async function rejectFriendRequest(requestId: string): Promise<void> {
  await api.post(`/api/v1/friends/requests/${requestId}/reject`);
}

export async function deleteFriend(friendUserId: string): Promise<void> {
  await api.delete(`/api/v1/friends/${friendUserId}`);
}

// ── 핀 — user 핀 통일(GROMO-609): 친구 아닌 임의 유저도 핀 가능, 리그·친구 공용 ──
// 구 경로(/friends/{id}/pin·/friends/pinned)는 백엔드에서 제거됨 → /pins/* 로 교체.

// 핀한 유저 목록(친구 아님 포함) — 오늘 집중분·집중중 여부 포함. 세션 그리드의 라이브 값 임시 보강에도 사용
export async function fetchPinnedFriends(): Promise<PinnedFriendResponse[]> {
  const { data } = await api.get<PinnedFriendResponse[]>('/api/v1/pins');
  return data;
}

// 핀 설정/해제 — 서버가 멱등 처리(이미 핀/핀 없음이어도 204). 대상은 임의 유저(자기 자신 제외).
export async function pinFriend(userId: string): Promise<void> {
  await api.post(`/api/v1/pins/${userId}`);
}

export async function unpinFriend(userId: string): Promise<void> {
  await api.delete(`/api/v1/pins/${userId}`);
}
