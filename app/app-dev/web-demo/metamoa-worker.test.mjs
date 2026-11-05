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

test('공간 키 없이는 전송하지 않고 승인 후 숫자만 보내며 중복 실행을 막는다', async () => {
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

test('캐릭터는 관리 인증 뒤 원본 바이너리를 전달하고 검사 상태만 반환한다', async () => {
  const env = {
    METAMOA_ADMIN_KEY: 'test-admin',
    METAMOA_KEY: 'test-space',
    METAMOA_SPACE_ID: 'cattus',
  };
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (url, init) => {
    called = true;
    assert.equal(url, 'https://metamoa.com/api/space/cattus/character');
    assert.equal(init.method, 'PUT');
    assert.equal(init.headers['Content-Type'], 'image/png');
    assert.equal(init.headers.Authorization, 'Bearer test-space');
    assert.equal(await init.body.text(), 'local-binary-fixture');
    return Response.json(
      { status: 'checking', upload_id: 'chr_test', token: 'must-not-leak' },
      { status: 202 },
    );
  };
  try {
    const request = new Request('https://try.oneorthree.world/service-api/metamoa/character', {
      method: 'PUT',
      headers: { Authorization: 'Bearer test-admin', 'Content-Type': 'image/png' },
      body: 'local-binary-fixture',
    });
    const response = await metamoaAdmin(request, env);
    assert.equal(called, true);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { status: 'checking', upload_id: 'chr_test' });
    called = false;
    const oversized = new Request(request.url, {
      method: 'PUT',
      headers: request.headers,
      body: new Uint8Array(1024 * 1024 + 1),
    });
    assert.equal((await metamoaAdmin(oversized, env)).status, 413);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('지연된 cron 다음 정각도 전송하고 9분 이내 중복과 네트워크 실패를 기록한다', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = 1000000;
  Date.now = () => now;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, { status: 204 });
  };
  try {
    const counter = new MetamoaPresence(context(), {
      METAMOA_KEY: 'test',
      METAMOA_SPACE_ID: 'cattus',
    });
    await counter.fetch(req('sync', 'POST'));
    now += 9 * 60000 - 1;
    await counter.fetch(req('sync', 'POST'));
    assert.equal(calls, 1);
    now += 30001;
    await counter.fetch(req('sync', 'POST'));
    assert.equal(calls, 2);
    now += 10 * 60000;
    globalThis.fetch = async () => {
      throw new Error('private transport detail');
    };
    assert.equal((await counter.fetch(req('sync', 'POST'))).status, 502);
    assert.deepEqual((await (await counter.fetch(req('status'))).json()).last_sync, {
      at: now,
      count: 0,
      status: 0,
    });
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

test('이벤트 목록에서 관리용 필드만 반환하고 ID로 삭제한다', async () => {
  const env = { METAMOA_ADMIN_KEY: 'admin', METAMOA_KEY: 'space', METAMOA_SPACE_ID: 'cattus' };
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    init.method === 'DELETE'
      ? Response.json({ ok: true })
      : Response.json({
          events: [
            {
              id: 123,
              title: '함께 집중',
              starts_at: '2026-11-06T10:00:00+09:00',
              ends_at: '2026-11-06T11:00:00+09:00',
              secret: 'must-not-leak',
            },
          ],
          key: 'must-not-leak',
        });
  const make = (path, method = 'GET') =>
    new Request('https://try.oneorthree.world/service-api/metamoa/' + path, {
      method,
      headers: { Authorization: 'Bearer admin' },
    });
  try {
    const list = await metamoaAdmin(make('events'), env);
    const body = await list.text();
    assert.equal(body.includes('must-not-leak'), false);
    assert.equal(JSON.parse(body).events[0].id, 123);
    assert.equal((await metamoaAdmin(make('events/123', 'DELETE'), env)).status, 200);
    assert.equal((await metamoaAdmin(make('events/bad', 'DELETE'), env)).status, 404);
  } finally {
    globalThis.fetch = original;
  }
});

test('잘못된 JSON과 이벤트 시간·소개·외부 URL은 제공자 호출 전에 거절한다', async () => {
  const env = { METAMOA_ADMIN_KEY: 'admin', METAMOA_KEY: 'space', METAMOA_SPACE_ID: 'cattus' };
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ event: { id: 1 } }, { status: 201 });
  };
  const make = (path, body) =>
    new Request('https://try.oneorthree.world/service-api/metamoa/' + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin' },
      body,
    });
  const valid = {
    title: '함께 집중',
    starts_at: '2026-11-06T10:00:00+09:00',
    ends_at: '2026-11-06T11:00:00+09:00',
  };
  try {
    for (const path of ['events', 'update'])
      for (const body of ['null', '{'])
        assert.equal((await metamoaAdmin(make(path, body), env)).status, 400);
    for (const extra of [
      { ends_at: valid.starts_at },
      { starts_at: '2026-11-06T10:00:00' },
      { desc: 'a'.repeat(41) },
      { desc: 123 },
      { daily_from: '25:00', daily_to: '26:00' },
      { url: 'https://example.com/' },
      { url: 'javascript:alert(1)' },
      { ends_at: '2027-01-01T11:00:00+09:00' },
    ]) {
      assert.equal(
        (await metamoaAdmin(make('events', JSON.stringify({ ...valid, ...extra })), env)).status,
        400,
      );
    }
    assert.equal(calls, 0);
    assert.equal(
      (
        await metamoaAdmin(
          make('events', JSON.stringify({ ...valid, url: 'https://try.oneorthree.world/' })),
          env,
        )
      ).status,
      201,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('Workers가 지원하는 수동 리다이렉트로 조회하고 다른 호스트의 3xx를 거절한다', async () => {
  const env = {
    METAMOA_ADMIN_KEY: 'admin',
    METAMOA_REQUEST_KEY: 'test-request',
    METAMOA_SUBMISSION_ID: 'cattus',
    METAMOA_KEY: 'test-space',
    METAMOA_SPACE_ID: 'cattus',
  };
  const original = globalThis.fetch;
  let calls = 0;
  let redirect = false;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(new URL(url).origin, 'https://metamoa.com');
    assert.equal(init.redirect, 'manual');
    if (redirect)
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://other.example/private' },
      });
    return Response.json({ status: 'pending' });
  };
  const request = (path, method = 'GET', body) =>
    new Request('https://try.oneorthree.world/service-api/metamoa/' + path, {
      method,
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'image/png' },
      body,
    });
  try {
    assert.equal((await (await metamoaAdmin(request('status'), env)).json()).status, 'pending');
    redirect = true;
    for (const r of [request('status'), request('character', 'PUT', 'fixture')]) {
      const response = await metamoaAdmin(r, env);
      assert.equal(response.status, 502);
      assert.equal((await response.text()).includes('other.example'), false);
    }
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = original;
  }
});
