import assert from 'node:assert/strict';
import {
  cancelJoinRequest,
  createIsland,
  discoverIslands,
  explore,
  joinIsland,
  joinRequest,
  myIslands,
  myJoinRequests,
  resolveInvitation,
  searchIslands,
  visitIsland,
} from '@/services/api/islands';
import { CLIENT_STALE_SESSION } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];

function stub(responses: { status: number; body?: unknown }[]) {
  let index = 0;
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status, body } = responses[Math.min(index++, responses.length - 1)];
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  });
}

const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];
const body = (call: Call) => JSON.parse(call.init.body as string);
const path = (call: Call) => new URL(call.url).pathname;
const envelope = (code: string, message = '실패했습니다.') => ({
  error: { code, message, field: null, retryable: false },
  requestId: 'req-x',
});

const summary = (id: string, over: object = {}) => ({
  id,
  name: '섬 ' + id,
  intro: '',
  visibility: 'public',
  approvalRequired: false,
  memberCount: 3,
  maxMembers: 15,
  membershipStatus: 'none',
  joinRequestId: null,
  growthStage: null,
  themeId: null,
  ...over,
});

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('createIsland — POST /islands 에 멱등 키와 허용된 body 만 보낸다', async () => {
  stub([
    {
      status: 201,
      body: {
        data: { id: 'i1', membershipStatus: 'active', role: 'host', currentIslandId: 'i1' },
      },
    },
  ]);

  const result = await createIsland(
    { name: '나의 첫 섬', intro: '매일 조금씩', approvalRequired: false, maxMembers: 15 },
    'idem-1',
  );

  assert.equal(path(calls[0]), '/islands');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-1');
  assert.equal(header(calls[0], 'Authorization'), 'Bearer AT');
  assert.deepEqual(body(calls[0]), {
    name: '나의 첫 섬',
    intro: '매일 조금씩',
    approvalRequired: false,
    maxMembers: 15,
  });
  assert.equal(result.currentIslandId, 'i1');
});

test('createIsland — intro·maxMembers 는 없으면 키 자체를 생략한다 (명시적 null 금지)', async () => {
  stub([
    {
      status: 201,
      body: {
        data: { id: 'i1', membershipStatus: 'active', role: 'host', currentIslandId: 'i1' },
      },
    },
  ]);

  await createIsland({ name: '섬', approvalRequired: true }, 'idem-2');

  assert.deepEqual(body(calls[0]), { name: '섬', approvalRequired: true });
  // 키는 호출부가 의도당 한 번 만들어 넘긴다 — 어댑터는 넘긴 값을 그대로 싣는다.
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-2');
});

test('explore — q 를 인코딩해 보내고, 없으면 query 없이 부른다', async () => {
  const screen = {
    memberships: { items: [], nextCursor: null, currentIslandId: null, lossReason: null },
    islands: { items: [summary('i1')], nextCursor: null },
  };
  stub([
    { status: 200, body: { data: screen } },
    { status: 200, body: { data: screen } },
  ]);

  const result = await explore('소다 섬');
  assert.equal(path(calls[0]), '/screens/explore');
  assert.equal(new URL(calls[0].url).searchParams.get('q'), '소다 섬');
  assert.equal(result.islands.items[0].id, 'i1');

  await explore();
  assert.equal(new URL(calls[1].url).search, '');
});

test('discoverIslands — cursor·limit 만 query 로 보낸다', async () => {
  stub([{ status: 200, body: { data: { items: [], nextCursor: 'c2' } } }]);

  await discoverIslands({ cursor: 'c1', limit: 5 });

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/islands/discover');
  assert.equal(url.searchParams.get('cursor'), 'c1');
  assert.equal(url.searchParams.get('limit'), '5');
});

test('searchIslands — 소속 후 이름 검색 경로', async () => {
  stub([{ status: 200, body: { data: { items: [summary('i9')], nextCursor: null } } }]);

  const page = await searchIslands('구름', { limit: 20 });

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/islands');
  assert.equal(url.searchParams.get('q'), '구름');
  assert.equal(page.items[0].id, 'i9');
});

test('searchIslands — cursor 가 q·limit 과 함께 query 로 정확히 전송된다', async () => {
  stub([{ status: 200, body: { data: { items: [], nextCursor: 'c9' } } }]);

  await searchIslands('구름 섬', { cursor: 'c8 +/=', limit: 10 });

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/islands');
  assert.equal(url.searchParams.get('q'), '구름 섬');
  // 커서는 서버가 준 문자열 — +·/·= 도 그대로 복원돼야 한다
  assert.equal(url.searchParams.get('cursor'), 'c8 +/=');
  assert.equal(url.searchParams.get('limit'), '10');
});

test('visitIsland — 공개 요약·주민·내 신청 상태를 그대로 돌려준다', async () => {
  const screen = {
    island: summary('i7'),
    members: {
      items: [{ id: 'm1', name: '민지', catColor: 'ginger', role: 'host', appearance: null }],
      nextCursor: null,
      version: 3,
    },
    joinRequestAvailability: 'available',
    joinRequest: null,
  };
  stub([{ status: 200, body: { data: screen } }]);

  const result = await visitIsland('i7');

  assert.equal(path(calls[0]), '/screens/visit/i7');
  assert.equal(result.joinRequestAvailability, 'available');
});

test('joinIsland — 멱등 키 필수, 토큰 없으면 빈 body, 있으면 invitationToken 만', async () => {
  stub([
    {
      status: 200,
      body: {
        data: {
          status: 'pending',
          requestId: 'r1',
          islandId: 'i1',
          currentIslandId: null,
          version: 1,
        },
      },
    },
    {
      status: 200,
      body: {
        data: {
          status: 'active',
          requestId: null,
          islandId: 'i2',
          currentIslandId: 'i2',
          version: 1,
        },
      },
    },
  ]);

  const pending = await joinIsland('i1', { idempotencyKey: 'idem-join' });
  assert.equal(path(calls[0]), '/islands/i1/memberships');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-join');
  assert.deepEqual(body(calls[0]), {});
  assert.equal(pending.status, 'pending');
  assert.equal(pending.currentIslandId, null);

  const active = await joinIsland('i2', {
    idempotencyKey: 'idem-join-2',
    invitationToken: 'invite-token',
  });
  // resolve 응답의 토큰을 변형 없이 그대로 전달한다.
  assert.deepEqual(body(calls[1]), { invitationToken: 'invite-token' });
  assert.equal(active.currentIslandId, 'i2');
});

test('응답 유실 재호출은 같은 키와 같은 body 를 다시 보낸다 — 어댑터는 키를 바꾸지 않는다', async () => {
  (global as any).fetch = jest
    .fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) throw new TypeError('Network request failed'); // 응답 유실
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            data: {
              status: 'active',
              requestId: null,
              islandId: 'i1',
              currentIslandId: 'i1',
              version: 1,
            },
          }),
      } as unknown as Response;
    })
    .mockName('fetch');

  // 호출부는 의도당 한 번 만든 키를 들고, 실패하면 그대로 다시 부른다.
  const input = { idempotencyKey: 'idem-retry', invitationToken: 'tok' };
  const first = await joinIsland('i1', input).catch((e) => e);
  assert.equal(first.code, 'CLIENT_NETWORK_ERROR');
  const retry = await joinIsland('i1', input);

  assert.equal(calls.length, 2);
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-retry');
  assert.equal(header(calls[1], 'Idempotency-Key'), 'idem-retry');
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(retry.currentIslandId, 'i1');
});

test('myJoinRequests·joinRequest — pending 목록과 단건 상태 경로', async () => {
  stub([
    {
      status: 200,
      body: {
        data: {
          items: [
            {
              id: 'r1',
              islandId: 'i1',
              status: 'pending',
              version: 1,
              islandName: '구름 섬',
              memberCount: 4,
              maxMembers: 15,
              createdAt: '2026-09-21T00:00:00Z',
            },
          ],
          nextCursor: null,
        },
      },
    },
    {
      status: 200,
      body: { data: { id: 'r1', islandId: 'i1', status: 'approved', version: 2 } },
    },
  ]);

  const list = await myJoinRequests();
  assert.equal(path(calls[0]), '/me/join-requests');
  assert.equal(list.items[0].islandName, '구름 섬');

  const one = await joinRequest('r1');
  assert.equal(path(calls[1]), '/me/join-requests/r1');
  assert.equal(one.status, 'approved');
});

test('myJoinRequests — cursor·limit 가 query 로 정확히 전송된다', async () => {
  stub([{ status: 200, body: { data: { items: [], nextCursor: 'c3' } } }]);

  await myJoinRequests({ cursor: 'c2 +/=', limit: 20 });

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/me/join-requests');
  assert.equal(url.searchParams.get('cursor'), 'c2 +/=');
  assert.equal(url.searchParams.get('limit'), '20');
});

test('cancelJoinRequest — DELETE 에 멱등 키를 싣고 body 는 없다', async () => {
  stub([{ status: 200, body: { data: { id: 'r1', status: 'cancelled' } } }]);

  const result = await cancelJoinRequest('r1', 'idem-cancel');

  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-cancel');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(result.status, 'cancelled');
});

test('resolveInvitation — 조회 성격이라 멱등 키를 보내지 않고 code 한 필드만 보낸다', async () => {
  stub([{ status: 200, body: { data: { island: summary('i5'), invitationToken: 'tok' } } }]);

  const result = await resolveInvitation('ABC123');

  assert.equal(path(calls[0]), '/invitations/resolve');
  assert.equal(header(calls[0], 'Idempotency-Key'), undefined);
  assert.deepEqual(body(calls[0]), { code: 'ABC123' });
  assert.equal(result.invitationToken, 'tok');
});

test('myIslands — 소속·current·상실 사유를 그대로 돌려준다', async () => {
  stub([
    {
      status: 200,
      body: {
        data: {
          items: [summary('i1', { membershipStatus: 'active' })],
          nextCursor: null,
          currentIslandId: 'i1',
          lossReason: null,
        },
      },
    },
  ]);

  const mine = await myIslands();

  assert.equal(path(calls[0]), '/me/islands');
  assert.equal(mine.currentIslandId, 'i1');
  assert.equal(mine.items[0].membershipStatus, 'active');
});

test('서버 오류는 코드를 그대로 올린다 — 성공으로 뭉개지 않는다', async () => {
  stub([
    { status: 409, body: envelope('STATE_CONFLICT') },
    { status: 422, body: envelope('OUT_OF_RANGE') },
    { status: 410, body: envelope('INVITATION_EXPIRED') },
  ]);

  const full = await joinIsland('i1', { idempotencyKey: 'k-join' }).catch((e) => e);
  assert.equal(full.code, 'STATE_CONFLICT');
  assert.equal(full.status, 409);

  const range = await createIsland({ name: '', approvalRequired: false }, 'k-create').catch(
    (e) => e,
  );
  assert.equal(range.code, 'OUT_OF_RANGE');

  const expired = await resolveInvitation('OLD').catch((e) => e);
  assert.equal(expired.code, 'INVITATION_EXPIRED');
});

test('공개 무접두 경로만 부른다 — /internal·/api/v1 이 없다', async () => {
  stub([{ status: 200, body: { data: { items: [], nextCursor: null } } }]);
  await myJoinRequests();
  for (const call of calls) {
    assert.equal(path(call).startsWith('/internal'), false);
    assert.equal(path(call).startsWith('/api/v1'), false);
  }
});

test('응답이 돌아올 때 세션 세대가 바뀌었으면 CLIENT_STALE_SESSION — 늦은 응답을 적용하지 않는다', async () => {
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    // 요청이 날아간 사이 계정 전환이 끝났다.
    await saveSession({ accessToken: 'B_AT', refreshToken: 'B_RT', userId: 'u2' });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          data: { items: [], nextCursor: null, currentIslandId: 'i1', lossReason: null },
        }),
    } as unknown as Response;
  });

  const error = await myIslands().catch((e) => e);
  assert.equal(error.code, CLIENT_STALE_SESSION);
});
