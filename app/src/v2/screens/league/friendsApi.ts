import { api } from '@/services/api';
import type {
  FriendRequestResponse,
  FriendResponse,
  FriendSearchResultResponse,
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
