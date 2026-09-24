import assert from 'node:assert/strict';
import { API_URL, ApiError } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  deleteFriend,
  friendErrorKind,
  getFriendRequests,
  getFriends,
  getFriendsScreen,
  rejectFriendRequest,
  searchFriends,
  sendFriendRequest,
} from '@/services/api/friends';

type Call = { url: string; init: RequestInit };

const calls: Call[] = [];

const REQUEST = '66666666-7777-4888-8999-000000000000';
const PEER = '11111111-2222-4333-8444-555555555555';

const failed = (p: Promise<unknown>): Promise<ApiError> =>
  p.then(
    () => {
      throw new Error('요청이 거절돼야 한다');
    },
    (e: unknown) => e as ApiError,
  );

function stub(status: number, body?: unknown) {
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  });
}

const sentBody = (n = 0) => JSON.parse(calls[n].init.body as string);
const headers = (n = 0) => calls[n].init.headers as Record<string, string>;

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('GET /screens/friends — 세 조각(friends·friendRequests·sentFriendRequests)을 그대로 돌려준다', async () => {
  const screen = {
    friends: [
      {
        userId: PEER,
        nickname: '짝꿍',
        tierLevel: 3,
        occupation: 'CODING',
        isPinned: true,
        isFocusing: true,
        focusTimeMinutes: 42,
        focusStartedAt: '2026-09-18T01:00:00Z',
        focusTagName: '전공',
        mainIslandName: '모래섬',
      },
    ],
    friendRequests: [
      { requestId: REQUEST, userId: PEER, nickname: '받은', tierLevel: null, createdAt: 't' },
    ],
    sentFriendRequests: [
      { requestId: REQUEST, userId: PEER, nickname: '보낸', tierLevel: null, createdAt: 't' },
    ],
  };
  stub(200, { data: screen });

  const result = await getFriendsScreen('2026-09-22');

  assert.equal(calls[0].url, `${API_URL}/screens/friends?date=2026-09-22`);
  assert.equal(headers().Authorization, 'Bearer AT');
  assert.deepEqual(result, screen);
  // 탈퇴자 nickname null·비친구 null 필드를 합성하지 않고 보존한다
  assert.equal(result.friendRequests[0].tierLevel, null);
});

test('GET /friends·/friends/requests — date·type 을 query 로 싣는다', async () => {
  stub(200, { data: [] });
  await getFriends('2026-09-22');
  assert.equal(calls[0].url, `${API_URL}/friends?date=2026-09-22`);

  await getFriendRequests('received');
  assert.equal(calls[1].url, `${API_URL}/friends/requests?type=received`);
});

test('GET /friends/search — type=NICKNAME 고정, q 는 인코딩해 그대로 보낸다', async () => {
  stub(200, {
    data: [
      {
        userId: PEER,
        nickname: 'Saebom',
        tierLevel: null,
        occupation: null,
        relation: 'NONE',
      },
    ],
  });

  const items = await searchFriends('saebom ');

  assert.equal(
    calls[0].url,
    `${API_URL}/friends/search?type=NICKNAME&q=${encodeURIComponent('saebom ')}`,
  );
  assert.equal(items[0].relation, 'NONE');
  // 비친구 프라이버시 마스킹 — null 을 유지한다
  assert.equal(items[0].tierLevel, null);
});

test('POST /friends/requests — 본문은 {targetUserId} 하나뿐, 멱등 키를 싣지 않는다', async () => {
  stub(201, { data: null });

  await sendFriendRequest(PEER);

  assert.equal(calls[0].url, `${API_URL}/friends/requests`);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(sentBody(), { targetUserId: PEER });
  assert.equal(headers()['Idempotency-Key'], undefined);
});

test('요청 명령 3종 — accept/reject/cancel 은 requestId 경로의 POST, 본문·멱등 키 없음', async () => {
  stub(200, { data: null });

  await acceptFriendRequest(REQUEST);
  assert.equal(calls[0].url, `${API_URL}/friends/requests/${REQUEST}/accept`);

  await rejectFriendRequest(REQUEST);
  assert.equal(calls[1].url, `${API_URL}/friends/requests/${REQUEST}/reject`);

  await cancelFriendRequest(REQUEST);
  assert.equal(calls[2].url, `${API_URL}/friends/requests/${REQUEST}/cancel`);

  for (const n of [0, 1, 2]) {
    assert.equal(calls[n].init.method, 'POST');
    assert.equal(calls[n].init.body, undefined);
  }
});

test('DELETE /friends/{friendUserId} — 상대 userId 경로, 본문 없음', async () => {
  stub(200, { data: null });

  await deleteFriend(PEER);

  assert.equal(calls[0].url, `${API_URL}/friends/${PEER}`);
  assert.equal(calls[0].init.method, 'DELETE');
});

test('friendErrorKind — guest·privacy·duplicate·already-handled·network 를 구분한다', () => {
  const err = (code: string, status: number, field: string | null = null, retryable = false) =>
    new ApiError(code, 'm', status, { field, retryable });

  assert.equal(friendErrorKind(err('SOCIAL_LOGIN_REQUIRED', 403)), 'guest');
  assert.equal(friendErrorKind(err('FORBIDDEN', 403, 'requestId')), 'privacy');
  assert.equal(friendErrorKind(err('STATE_CONFLICT', 409, 'targetUserId')), 'duplicate');
  assert.equal(friendErrorKind(err('STATE_CONFLICT', 409, 'requestId')), 'already-handled');
  assert.equal(friendErrorKind(err('NOT_FOUND', 404, 'requestId')), 'already-handled');
  assert.equal(friendErrorKind(err('NOT_FOUND', 404, 'friendUserId')), 'already-handled');
  assert.equal(friendErrorKind(err('CLIENT_NETWORK_ERROR', 0)), 'network');
  assert.equal(friendErrorKind(err('CLIENT_TIMEOUT', 0)), 'network');
  assert.equal(friendErrorKind(err('RATE_LIMITED', 429, null, true)), 'network');
  // 대상 탈퇴·파라미터 오류는 목록 재조회로 닫히지 않는다
  assert.equal(friendErrorKind(err('NOT_FOUND', 404, 'targetUserId')), 'other');
  assert.equal(friendErrorKind(err('INVALID_PARAMETER', 400, 'type')), 'other');
  assert.equal(friendErrorKind(new Error('x')), 'network');
});

test('게이트·충돌 오류를 가짜 성공으로 접지 않는다 — code·field·status 를 전파한다', async () => {
  stub(403, {
    error: {
      code: 'SOCIAL_LOGIN_REQUIRED',
      message: '소셜 로그인하면 이용할 수 있어요.',
      field: null,
      retryable: false,
    },
    requestId: 'r1',
  });
  const gate = await failed(sendFriendRequest(PEER));
  assert.equal(gate.code, 'SOCIAL_LOGIN_REQUIRED');
  assert.equal(gate.status, 403);

  stub(409, {
    error: {
      code: 'STATE_CONFLICT',
      message: '현재 상태에서는 이 작업을 수행할 수 없습니다.',
      field: 'requestId',
      retryable: false,
    },
    requestId: 'r2',
  });
  const conflict = await failed(acceptFriendRequest(REQUEST));
  assert.equal(conflict.code, 'STATE_CONFLICT');
  assert.equal(conflict.field, 'requestId');
});
