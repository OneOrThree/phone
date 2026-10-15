/**
 * 친구 공개 API (GROMO-2015 · friend-letter LLD §1 — business-api `FriendController` + `/screens/friends`).
 * 무접두 경로이고 성공 봉투·오류 형태는 공통 client 가 벗긴다 — 이 모듈은 정확한 path/body/키만 보증한다.
 *
 * - `GET /screens/friends?date=` — 친구 목록·받은 요청·보낸 요청 세 조각이 한 응답에 온다.
 *   `date` 는 친구 당일 집중 분의 KST 기준일이며 생략하면 서버 KST 오늘이다.
 * - 명령 5종(생성·수락·거절·취소·삭제)은 성공 본문이 없고 `Idempotency-Key` 도 요구하지 않는다 —
 *   서버가 「두 번째 수락은 멱등 200, 두 번째 거절·취소는 409, 두 번째 삭제는 404」로 자체 보호한다.
 *   성공 응답이 오기 전에 로컬 목록을 바꾸지 않는다(optimistic 금지) — 2xx 뒤 재조회가 정본이다.
 * - 검색은 `type=NICKNAME` 대소문자 무시 **전체 일치**. 결과는 0~1건이고 없으면 빈 배열(404 아님).
 *   비친구(NONE·PENDING) 건의 `tierLevel`·`occupation` 은 서버가 null 로 가린다 — 앱이 채우지 않는다.
 */
import { ApiError, CLIENT_NETWORK_ERROR, CLIENT_TIMEOUT, request } from './client';

/** 친구 목록의 한 건 — `FriendItem` 계약. nickname·mainIslandName 등은 null 이 정상이다(탈퇴·무소속). */
export type FriendItem = {
  userId: string;
  nickname: string | null;
  tierLevel: number | null;
  occupation: string | null;
  isPinned: boolean;
  isFocusing: boolean;
  focusTimeMinutes: number;
  focusStartedAt: string | null;
  focusTagName: string | null;
  mainIslandName: string | null;
};

/** 받은·보낸 요청의 한 건 — 수락·거절·취소는 `requestId` 를 쓴다(`userId` 가 아니다). */
export type FriendRequestItem = {
  requestId: string;
  userId: string;
  nickname: string | null;
  tierLevel: number | null;
  createdAt: string;
};

/** 나와의 관계 — 검색 결과의 버튼·배지 축. PENDING 은 보낸 것과 받은 것을 구분하지 않는다. */
export type FriendRelation = 'NONE' | 'PENDING' | 'FRIEND';

export type FriendSearchItem = {
  userId: string;
  nickname: string;
  /** 비친구면 서버가 null 로 가린다 — 프라이버시 마스킹을 앱이 되돌리지 않는다. */
  tierLevel: number | null;
  occupation: string | null;
  relation: FriendRelation;
};

export type FriendsScreen = {
  friends: FriendItem[];
  /** 받은 요청(type=received). */
  friendRequests: FriendRequestItem[];
  /** 보낸 요청(type=sent). */
  sentFriendRequests: FriendRequestItem[];
};

const enc = encodeURIComponent;
const qs = (params: Record<string, string | undefined>): string => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  return entries.length ? '?' + entries.map(([k, v]) => `${k}=${enc(v!)}`).join('&') : '';
};

export function getFriendsScreen(date?: string): Promise<FriendsScreen> {
  return request<FriendsScreen>(`/screens/friends${qs({ date })}`);
}

export function getFriends(date: string): Promise<FriendItem[]> {
  return request<FriendItem[]>(`/friends${qs({ date })}`);
}

export function getFriendRequests(type: 'received' | 'sent'): Promise<FriendRequestItem[]> {
  return request<FriendRequestItem[]>(`/friends/requests${qs({ type })}`);
}

/** 닉네임 정확 일치 검색 — `q` 는 trim 된 원문을 그대로 보낸다(대소문자 판정은 서버 몫). */
export function searchFriends(nickname: string): Promise<FriendSearchItem[]> {
  return request<FriendSearchItem[]>(`/friends/search${qs({ type: 'NICKNAME', q: nickname })}`);
}

/** 본문은 `targetUserId` 하나뿐이다 — 다른 키가 섞이면 서버가 400 으로 거절한다. */
export function sendFriendRequest(targetUserId: string): Promise<void> {
  return request<unknown>('/friends/requests', {
    method: 'POST',
    body: { targetUserId },
  }).then(() => undefined);
}

export function acceptFriendRequest(requestId: string): Promise<void> {
  return request<unknown>(`/friends/requests/${enc(requestId)}/accept`, {
    method: 'POST',
  }).then(() => undefined);
}

export function rejectFriendRequest(requestId: string): Promise<void> {
  return request<unknown>(`/friends/requests/${enc(requestId)}/reject`, {
    method: 'POST',
  }).then(() => undefined);
}

export function cancelFriendRequest(requestId: string): Promise<void> {
  return request<unknown>(`/friends/requests/${enc(requestId)}/cancel`, {
    method: 'POST',
  }).then(() => undefined);
}

/** 친구 삭제 — 경로 변수는 상대 `userId` 다(요청 행 id 가 아니다). */
export function deleteFriend(friendUserId: string): Promise<void> {
  return request<unknown>(`/friends/${enc(friendUserId)}`, {
    method: 'DELETE',
  }).then(() => undefined);
}

/**
 * 화면 안내 분기용 실패 분류 — 공개 오류 표(friend-letter LLD §1 → ApiErrorCode)를 UI 사유로 접는다.
 *
 * - `guest`           — SOCIAL_LOGIN_REQUIRED: 회원 전환 시트를 여는 신호(메시지가 아니다)
 * - `privacy`         — FORBIDDEN: 수신자·발신자가 아니라 권한이 없는 명령
 * - `duplicate`       — STATE_CONFLICT(targetUserId): 이미 친구·이미 보낸 요청·동시 생성 충돌
 * - `already-handled` — STATE_CONFLICT(requestId)·NOT_FOUND(requestId·friendUserId):
 *                       다른 기기·상대가 먼저 처리했다 — 목록 재조회가 답이다
 * - `network`         — CLIENT_*·서버 retryable: 재시도 가능한 전송 실패
 * - `other`           — 그 외(대상 탈퇴 NOT_FOUND·INVALID_PARAMETER·5xx 등), 서버 message 를 쓴다
 */
export type FriendErrorKind =
  'guest' | 'privacy' | 'duplicate' | 'already-handled' | 'network' | 'other';

export function friendErrorKind(error: unknown): FriendErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  if (error.code === 'SOCIAL_LOGIN_REQUIRED') return 'guest';
  if (error.code === 'FORBIDDEN') return 'privacy';
  if (error.code === 'STATE_CONFLICT')
    return error.field === 'requestId' ? 'already-handled' : 'duplicate';
  if (error.code === 'NOT_FOUND' && (error.field === 'requestId' || error.field === 'friendUserId'))
    return 'already-handled';
  if (error.retryable || error.code === CLIENT_NETWORK_ERROR || error.code === CLIENT_TIMEOUT)
    return 'network';
  return 'other';
}
