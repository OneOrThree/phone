import assert from 'node:assert/strict';
import {
  answerIslandJoinRequest,
  getManagedIsland,
  islandJoinRequests,
  islandMembers,
  kickIslandMember,
  leaveIsland,
  manageIsland,
  transferIslandHost,
} from '@/services/api/islandManagement';
import { ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';
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
const envelope = (code: string, message = '실패했습니다.', field: string | null = null) => ({
  error: { code, message, field, retryable: false },
  requestId: 'req-x',
});

const memberDetail = (id: string, over: object = {}) => ({
  id,
  name: '구름 섬',
  intro: '매일 조금씩',
  visibility: 'public',
  approvalRequired: true,
  memberCount: 8,
  maxMembers: 15,
  membershipStatus: 'active',
  growthStage: null,
  themeId: null,
  role: 'host',
  version: 4,
  ...over,
});

const appearance = {
  clothes: 'suit',
  decor: null,
  hull: 'round',
  position: 'idle',
  version: 2,
};

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('getManagedIsland — GET /islands/{id} 주민 상세를 그대로 돌려주고 멱등 키를 보내지 않는다', async () => {
  stub([{ status: 200, body: { data: memberDetail('i1') } }]);

  const result = await getManagedIsland('i1');

  assert.equal(path(calls[0]), '/islands/i1');
  assert.equal(calls[0].init.method ?? 'GET', 'GET');
  assert.equal(header(calls[0], 'Idempotency-Key'), undefined);
  assert.ok('role' in result); // 상세로 좁힌다 — 요약에는 role 이 없다
  assert.equal(result.role, 'host');
  assert.equal(result.maxMembers, 15);
  assert.equal(result.growthStage, null);
});

test('getManagedIsland — 비소속 응답은 공개 요약으로 그대로 온다 (role/version 없음)', async () => {
  stub([
    {
      status: 200,
      body: {
        data: {
          id: 'i1',
          name: '구름 섬',
          intro: '',
          visibility: 'public',
          approvalRequired: true,
          memberCount: 8,
          maxMembers: 15,
          membershipStatus: 'none',
          joinRequestId: null,
          growthStage: null,
          themeId: null,
        },
      },
    },
  ]);

  const result = await getManagedIsland('i1');

  // 요약에는 role/version 이 없다 — 어댑터가 채우지 않고 호출부가 좁힌다.
  assert.equal('role' in result, false);
  assert.equal('joinRequestId' in result, true);
  assert.equal(result.membershipStatus, 'none');
});

test('manageIsland — PATCH 에 멱등 키와 허용된 body 만 보낸다', async () => {
  stub([
    {
      status: 200,
      body: {
        data: {
          id: 'i1',
          name: '새 이름',
          intro: '',
          approvalRequired: true,
          maxMembers: 10,
          version: 5,
        },
      },
    },
  ]);

  const result = await manageIsland(
    'i1',
    { name: '새 이름', intro: '', approvalRequired: true, maxMembers: 10 },
    'idem-manage',
  );

  assert.equal(path(calls[0]), '/islands/i1');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-manage');
  assert.deepEqual(body(calls[0]), {
    name: '새 이름',
    intro: '',
    approvalRequired: true,
    maxMembers: 10,
  });
  assert.equal(result.version, 5);
});

test('manageIsland — 부분 수정은 넘긴 키만 body 에 실린다', async () => {
  stub([
    {
      status: 200,
      body: {
        data: {
          id: 'i1',
          name: '구름 섬',
          intro: '소개만',
          approvalRequired: true,
          maxMembers: 15,
          version: 6,
        },
      },
    },
  ]);

  await manageIsland('i1', { intro: '소개만' }, 'idem-partial');

  assert.deepEqual(body(calls[0]), { intro: '소개만' });
});

test('manageIsland — 계약 밖 키는 타입이 막는다 (expectedVersion·password)', async () => {
  stub([
    {
      status: 200,
      body: {
        data: {
          id: 'i1',
          name: '구름 섬',
          intro: '',
          approvalRequired: false,
          maxMembers: 15,
          version: 1,
        },
      },
    },
  ]);

  await manageIsland('i1', { name: '허용' }, 'k-type');

  const bad = { expectedVersion: 3, password: 'x' };
  // @ts-expect-error — expectedVersion·password 는 공개 PATCH 계약에 없다
  void manageIsland('i1', bad, 'k-bad');
  // @ts-expect-error — 명시 null 도 patch 필드 타입이 거부한다
  void manageIsland('i1', { name: null }, 'k-null');
});

test('islandMembers — cursor·limit 만 인코딩해 query 로 보낸다', async () => {
  stub([
    {
      status: 200,
      body: {
        data: {
          items: [
            {
              id: 'm1',
              name: '민지',
              catColor: 'ginger',
              role: 'host',
              appearance,
            },
            { id: 'm2', name: null, catColor: null, role: 'member', appearance },
          ],
          nextCursor: 'c9',
          version: 7,
        },
      },
    },
  ]);

  const page = await islandMembers('i1', { cursor: 'c8 +/=', limit: 20 });

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/islands/i1/members');
  assert.equal(url.searchParams.get('cursor'), 'c8 +/=');
  assert.equal(url.searchParams.get('limit'), '20');
  assert.equal(header(calls[0], 'Idempotency-Key'), undefined);
  assert.equal(page.version, 7);
  assert.equal(page.items[1].name, null);
  assert.deepEqual(page.items[0].appearance, appearance);
});

test('islandMembers — 옵션 없으면 query 를 붙이지 않는다', async () => {
  stub([{ status: 200, body: { data: { items: [], nextCursor: null, version: 0 } } }]);

  await islandMembers('i1');

  assert.equal(new URL(calls[0].url).search, '');
});

test('islandJoinRequests — 방장 pending 목록 경로와 응답 모양', async () => {
  stub([
    {
      status: 200,
      body: {
        data: {
          items: [
            { id: 'r1', applicantId: 'u9', name: '지원자', status: 'pending', version: 2 },
            { id: 'r2', applicantId: 'u8', name: null, status: 'pending', version: 1 },
          ],
          nextCursor: null,
        },
      },
    },
  ]);

  const page = await islandJoinRequests('i1', { limit: 30 });

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/islands/i1/join-requests');
  assert.equal(url.searchParams.get('limit'), '30');
  assert.equal(url.searchParams.get('cursor'), null);
  assert.equal(page.items[0].status, 'pending');
  assert.equal(page.items[1].name, null);
});

test('answerIslandJoinRequest — body 는 정확히 {decision} 한 키, 멱등 키 보존', async () => {
  stub([
    { status: 200, body: { data: { status: 'approved', memberId: 'u9', version: 3 } } },
    { status: 200, body: { data: { status: 'rejected', memberId: null, version: 4 } } },
  ]);

  const approved = await answerIslandJoinRequest('i1', 'r1', 'approve', 'idem-approve');
  assert.equal(path(calls[0]), '/islands/i1/join-requests/r1');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-approve');
  assert.deepEqual(body(calls[0]), { decision: 'approve' });
  assert.equal(approved.memberId, 'u9');

  const rejected = await answerIslandJoinRequest('i1', 'r2', 'reject', 'idem-reject');
  assert.deepEqual(body(calls[1]), { decision: 'reject' });
  // 거절의 memberId 는 계약상 명시 null — 키가 빠지지 않는다.
  assert.equal('memberId' in rejected, true);
  assert.equal(rejected.memberId, null);
});

test('kickIslandMember — DELETE 에 멱등 키를 싣고 body 는 없다', async () => {
  stub([{ status: 200, body: { data: { removed: true } } }]);

  const result = await kickIslandMember('i1', 'u9', 'idem-kick');

  assert.equal(path(calls[0]), '/islands/i1/members/u9');
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-kick');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(result.removed, true);
});

test('leaveIsland — DELETE /memberships/me 에 멱등 키를 싣고 body 는 없다', async () => {
  stub([{ status: 200, body: { data: { left: true } } }]);

  const result = await leaveIsland('i1', 'idem-leave');

  assert.equal(path(calls[0]), '/islands/i1/memberships/me');
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-leave');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(result.left, true);
});

test('transferIslandHost — POST, body 정확히 {targetUserId}, query 없음', async () => {
  stub([{ status: 200, body: { data: { hostUserId: 'u9', version: 8 } } }]);

  const result = await transferIslandHost('i1', 'u9', 'idem-transfer');

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/islands/i1/host-transfer');
  assert.equal(url.search, '');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-transfer');
  assert.deepEqual(body(calls[0]), { targetUserId: 'u9' });
  assert.equal(result.hostUserId, 'u9');
});

test('ID·cursor 경로 인자는 인코딩된다', async () => {
  stub([
    { status: 200, body: { data: memberDetail('i/1') } },
    { status: 200, body: { data: { removed: true } } },
  ]);

  await getManagedIsland('i/1');
  await kickIslandMember('i/1', 'u/9', 'k');

  assert.equal(path(calls[0]), '/islands/i%2F1');
  assert.equal(path(calls[1]), '/islands/i%2F1/members/u%2F9');
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
        text: async () => JSON.stringify({ data: { hostUserId: 'u9', version: 8 } }),
      } as unknown as Response;
    })
    .mockName('fetch');

  // 호출부는 의도당 한 번 만든 키를 들고, 실패하면 그대로 다시 부른다.
  const first = await transferIslandHost('i1', 'u9', 'idem-retry').catch((e) => e);
  assert.equal(first.code, 'CLIENT_NETWORK_ERROR');
  const retry = await transferIslandHost('i1', 'u9', 'idem-retry');

  assert.equal(calls.length, 2);
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-retry');
  assert.equal(header(calls[1], 'Idempotency-Key'), 'idem-retry');
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(retry.hostUserId, 'u9');
});

test('서버 오류는 ApiError 를 그대로 올린다 — 성공·빈 상태로 뭉개지 않는다', async () => {
  stub([
    { status: 403, body: envelope('FORBIDDEN') },
    { status: 409, body: envelope('STATE_CONFLICT') },
    { status: 400, body: envelope('INVALID_REQUEST', '실패했습니다.', 'maxMembers') },
  ]);

  const forbidden = await islandJoinRequests('i1').catch((e) => e);
  assert.ok(forbidden instanceof ApiError);
  assert.equal(forbidden.code, 'FORBIDDEN');
  assert.equal(forbidden.status, 403);

  const conflict = await answerIslandJoinRequest('i1', 'r1', 'approve', 'k-a').catch((e) => e);
  assert.ok(conflict instanceof ApiError);
  assert.equal(conflict.code, 'STATE_CONFLICT');
  assert.equal(conflict.status, 409);

  const invalid = await manageIsland('i1', { maxMembers: 0 }, 'k-m').catch((e) => e);
  assert.ok(invalid instanceof ApiError);
  assert.equal(invalid.code, 'INVALID_REQUEST');
  assert.equal(invalid.field, 'maxMembers');
});

test('네트워크 단절도 ApiError(CLIENT_NETWORK_ERROR) 다', async () => {
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    throw new TypeError('Network request failed');
  });

  const error = await kickIslandMember('i1', 'u9', 'k-net').catch((e) => e);
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, 'CLIENT_NETWORK_ERROR');
});

test('공개 무접두 경로만 부른다 — /internal·/api/v1 이 없다', async () => {
  stub([{ status: 200, body: { data: { items: [], nextCursor: null, version: 0 } } }]);
  await islandMembers('i1');
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
      text: async () => JSON.stringify({ data: memberDetail('i1') }),
    } as unknown as Response;
  });

  const error = await getManagedIsland('i1').catch((e) => e);
  assert.equal(error.code, CLIENT_STALE_SESSION);
});
