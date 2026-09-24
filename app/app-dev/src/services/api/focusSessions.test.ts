import assert from 'node:assert/strict';
import {
  acknowledgeFocusResult,
  currentFocusSession,
  finishFocusSession,
  pauseFocusSession,
  pendingFocusResult,
  resumeFocusSession,
  startFocusSession,
} from '@/services/api/focusSessions';
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
const envelope = (code: string, message = '실패했습니다.', retryable = false) => ({
  error: { code, message, field: null, retryable },
  requestId: 'req-x',
});

const sessionView = (over: object = {}) => ({
  id: 'sess-1',
  islandId: 'island-1',
  subject: '수학',
  targetMinutes: null,
  status: 'active',
  activeSeconds: 120,
  serverNow: '2026-09-22T01:00:00Z',
  startedAt: '2026-09-22T00:58:00Z',
  restStartedAt: null,
  version: 1,
  ...over,
});
const finishView = (over: object = {}) => ({
  recordId: 'sess-1',
  islandId: 'island-1',
  subject: '수학',
  targetMinutes: 25,
  activeSeconds: 1500,
  goalAchieved: true,
  earnedFish: 25,
  allocation: { personalFishAdded: 0, constructionFishAdded: 25 },
  completedAt: '2026-09-22T01:00:00Z',
  questProgress: [{ id: 'q1', myRate: 100 }],
  ...over,
});

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('startFocusSession — POST /focus-sessions 에 멱등 키와 허용된 body 만 보낸다', async () => {
  stub([{ status: 201, body: { data: sessionView() } }]);

  const result = await startFocusSession(
    { islandId: 'island-1', subject: '수학', targetMinutes: 25 },
    'idem-start',
  );

  assert.equal(path(calls[0]), '/focus-sessions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-start');
  assert.equal(header(calls[0], 'Authorization'), 'Bearer AT');
  assert.deepEqual(body(calls[0]), {
    islandId: 'island-1',
    subject: '수학',
    targetMinutes: 25,
  });
  assert.equal(result.id, 'sess-1');
  assert.equal(result.version, 1);
});

test('startFocusSession — targetMinutes 는 없으면 키 자체를 생략한다 (명시적 null 금지)', async () => {
  stub([{ status: 201, body: { data: sessionView() } }]);

  await startFocusSession({ islandId: 'island-1', subject: '수학' }, 'idem-start-2');

  assert.deepEqual(body(calls[0]), { islandId: 'island-1', subject: '수학' });
});

test('currentFocusSession — GET /focus-sessions/current, 세션 없으면 data:null → null', async () => {
  stub([
    { status: 200, body: { data: sessionView() } },
    { status: 200, body: { data: null } },
  ]);

  const active = await currentFocusSession();
  assert.equal(path(calls[0]), '/focus-sessions/current');
  assert.equal(active?.status, 'active');

  const none = await currentFocusSession();
  assert.equal(none, null);
});

test('pause·resume — {expectedVersion} 한 필드와 멱등 키만 보낸다', async () => {
  stub([
    { status: 200, body: { data: sessionView({ status: 'paused', version: 2 }) } },
    { status: 200, body: { data: sessionView({ version: 3 }) } },
  ]);

  const paused = await pauseFocusSession('sess-1', 1, 'idem-pause');
  assert.equal(path(calls[0]), '/focus-sessions/sess-1/pause');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-pause');
  assert.deepEqual(body(calls[0]), { expectedVersion: 1 });
  assert.equal(paused.status, 'paused');

  const resumed = await resumeFocusSession('sess-1', 2, 'idem-resume');
  assert.equal(path(calls[1]), '/focus-sessions/sess-1/resume');
  assert.equal(header(calls[1], 'Idempotency-Key'), 'idem-resume');
  assert.deepEqual(body(calls[1]), { expectedVersion: 2 });
  assert.equal(resumed.version, 3);
});

test('finishFocusSession — {expectedVersion} + 키로 정산 뷰를 돌려받는다', async () => {
  stub([{ status: 200, body: { data: finishView() } }]);

  const result = await finishFocusSession('sess-1', 3, 'idem-finish');

  assert.equal(path(calls[0]), '/focus-sessions/sess-1/finish');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-finish');
  assert.deepEqual(body(calls[0]), { expectedVersion: 3 });
  assert.equal(result.earnedFish, 25);
  assert.equal(result.allocation.constructionFishAdded, 25);
});

test('pendingFocusResult — 없으면 data:null, 있으면 정산 뷰', async () => {
  stub([
    { status: 200, body: { data: null } },
    { status: 200, body: { data: finishView() } },
  ]);

  assert.equal(await pendingFocusResult(), null);
  const pending = await pendingFocusResult();
  assert.equal(path(calls[1]), '/focus-sessions/pending-result');
  assert.equal(pending?.recordId, 'sess-1');
});

test('acknowledgeFocusResult — 본문도 멱등 키도 없이 POST 만 보낸다', async () => {
  stub([{ status: 200, body: { data: null } }]);

  await acknowledgeFocusResult('sess-1');

  assert.equal(path(calls[0]), '/focus-sessions/sess-1/acknowledge');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(header(calls[0], 'Idempotency-Key'), undefined);
  assert.equal(calls[0].init.body, undefined);
});

test('서버 오류는 코드·retryable 을 그대로 올린다 — 성공으로 뭉개지 않는다', async () => {
  stub([
    { status: 409, body: envelope('STATE_CONFLICT') },
    { status: 404, body: envelope('NOT_FOUND') },
    { status: 503, body: envelope('SERVICE_UNAVAILABLE', '잠시 후 다시 시도해 주세요.', true) },
  ]);

  const conflict = await pauseFocusSession('sess-1', 1, 'k1').catch((e) => e);
  assert.equal(conflict.code, 'STATE_CONFLICT');
  assert.equal(conflict.status, 409);

  const missing = await finishFocusSession('sess-9', 1, 'k2').catch((e) => e);
  assert.equal(missing.code, 'NOT_FOUND');

  const unavailable = await startFocusSession(
    { islandId: 'island-1', subject: '수학' },
    'k3',
  ).catch((e) => e);
  assert.equal(unavailable.code, 'SERVICE_UNAVAILABLE');
  assert.equal(unavailable.retryable, true);
});

test('공개 무접두 경로만 부른다 — /internal·/api/v1 이 없다', async () => {
  stub([{ status: 200, body: { data: null } }]);
  await currentFocusSession();
  await pendingFocusResult();
  for (const call of calls) {
    assert.equal(path(call).startsWith('/internal'), false);
    assert.equal(path(call).startsWith('/api/v1'), false);
  }
});
