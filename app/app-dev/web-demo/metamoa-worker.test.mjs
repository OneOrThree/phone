import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MetamoaPresence, recordWebPresence, metamoaAdmin } from './metamoa-worker.mjs';

function context() {
  const db = new DatabaseSync(':memory:');
  const values = new Map();
  return {
    storage: {
      sql: {
        exec(query, ...args) {
          const stmt = db.prepare(query);
          if (/^SELECT/.test(query)) return { one: () => stmt.get(...args) };
          stmt.run(...args);
          return {};
        },
      },
      get: async (k) => values.get(k),
      put: async (k, v) => values.set(k, v),
    },
    blockConcurrencyWhile: (fn) => fn(),
  };
}
const req = (path, method = 'GET', body) =>
  new Request('https://presence/' + path, { method, body });

test('같은 사용자의 탭을 합치고 5분 지난 접속은 제외한다', async () => {
  const original = Date.now;
  let now = 1000000;
  Date.now = () => now;
  try {
    const counter = new MetamoaPresence(context(), {});
    await counter.fetch(req('seen', 'POST', 'a'.repeat(64)));
    await counter.fetch(req('seen', 'POST', 'a'.repeat(64)));
    now += 60000;
    await counter.fetch(req('seen', 'POST', 'b'.repeat(64)));
    assert.equal((await (await counter.fetch(req('count'))).json()).count, 2);
    now += 240000;
    assert.equal((await (await counter.fetch(req('count'))).json()).count, 1);
    now += 60000;
    assert.equal((await (await counter.fetch(req('count'))).json()).count, 0);
  } finally {
    Date.now = original;
  }
});

test('실제 인증 성공 heartbeat만 해시로 집계하고 실패·봇·검증 방문은 제외한다', async () => {
  const seen = [];
  const env = {
    METAMOA_PRESENCE_SALT: 'unit-test-only',
    METAMOA_PRESENCE: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (_url, init) => {
          seen.push(init.body);
          return new Response(null, { status: 204 });
        },
      }),
    },
  };
  const sub = '00000000-0000-4000-8000-000000000001';
  const jwt =
    'e30.' +
    Buffer.from(JSON.stringify({ sub, type: 'access', exp: Date.now() / 1000 + 600 })).toString(
      'base64url',
    ) +
    '.sig';
  const request = (extra) =>
    new Request('https://try.oneorthree.world/service-api/me', {
      headers: { Authorization: 'Bearer ' + jwt, 'X-Metamoa-Presence': '1', ...extra },
    });
  await recordWebPresence(request(), new Response('ok'), env);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /^[0-9a-f]{64}$/);
  assert.equal(seen[0].includes(sub), false);
  await recordWebPresence(request(), new Response(null, { status: 401 }), env);
  await recordWebPresence(request({ 'X-Metamoa-Exclude': '1' }), new Response('ok'), env);
  await recordWebPresence(request({ 'User-Agent': 'HeadlessChrome' }), new Response('ok'), env);
  await recordWebPresence(request({ 'X-Metamoa-Presence': '0' }), new Response('ok'), env);
  assert.equal(seen.length, 1);
});

test('공간 키 없이는 전송하지 않고 승인 후 숫자만 보내며 10분 중복을 막는다', async () => {
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, init });
    return new Response(null, { status: 204 });
  };
  try {
    const env = {};
    const counter = new MetamoaPresence(context(), env);
    assert.deepEqual(await (await counter.fetch(req('sync', 'POST'))).json(), { enabled: false });
    env.METAMOA_KEY = 'unit-test-key';
    env.METAMOA_SPACE_ID = 'cattus';
    await counter.fetch(req('seen', 'POST', 'a'.repeat(64)));
    await counter.fetch(req('sync', 'POST'));
    await counter.fetch(req('sync', 'POST'));
    assert.equal(sent.length, 1);
    assert.deepEqual(JSON.parse(sent[0].init.body), { count: 1 });
    assert.equal(sent[0].url, 'https://metamoa.com/api/live/cattus');
    assert.equal(sent[0].init.headers.Authorization, 'Bearer unit-test-key');
  } finally {
    globalThis.fetch = original;
  }
});

test('관리 API 인증·승인 전 차단과 응답 키 제거를 확인한다', async () => {
  const env = { METAMOA_ADMIN_KEY: 'test-admin' };
  const make = (path, auth, body) =>
    new Request('https://try.oneorthree.world/service-api/metamoa/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: auth || '' },
      body: body && JSON.stringify(body),
    });
  assert.equal((await metamoaAdmin(make('status'), env)).status, 401);
  assert.equal(
    (await metamoaAdmin(make('update', 'Bearer test-admin', { text: 'web' }), env)).status,
    409,
  );
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ status: 'pending', request_key: 'must-not-leak', email: 'must-not-leak' });
  try {
    env.METAMOA_REQUEST_KEY = 'test-request';
    env.METAMOA_SUBMISSION_ID = 'request-id';
    const response = await metamoaAdmin(make('status', 'Bearer test-admin'), env);
    assert.equal((await response.text()).includes('must-not-leak'), false);
  } finally {
    globalThis.fetch = original;
  }
});
