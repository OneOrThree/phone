import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { Upstream } from '../server/upstream.mjs';
import contract from '../server/contract.json' with { type: 'json' };

const issueId = '00000000-0000-4000-8000-000000000001';
const cursor = '2034-05-09T22:00:00Z|00000000-0000-4000-8000-000000000002';

test('발행본 상세는 환경 확인 뒤 운영자 자격으로 읽고 페이지 경계를 전달한다', async () => {
  const calls = [];
  const content = { issueId, issueDate: '2034-05-10', issueNo: 1, cells: [], nextCursor: null };
  const upstream = new Upstream({ mode: 'connected', environment: 'prod', expectedFcmProjectId: 'catus-prod',
    dataUrl: 'http://data.internal', notificationUrl: 'http://notification.internal',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.pathname.endsWith('/environment')) return Response.json({ environment: 'prod',
        fcmProjectId: 'catus-prod', contractVersion: '1', capabilities: [...contract.data, ...contract.notification] });
      return Response.json(content);
    },
  });
  assert.deepEqual(await upstream.magazineContent(issueId, cursor, 'member-1',
    { dataToken: 'test-data-secret', notificationToken: 'test-notification-secret' }), content);
  assert.equal(calls.length, 3);
  const { url, options } = calls[2];
  assert.equal(url.pathname, `/internal/admin/content/history/magazines/${issueId}`);
  assert.equal(url.searchParams.get('cursor'), cursor);
  assert.equal(url.searchParams.get('limit'), '50');
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.Authorization, 'Bearer test-data-secret');
  assert.equal(options.headers['X-Console-Actor'], 'member-1');
  assert.equal(options.body, undefined);
});

test('잡지 조회 계약이 없는 서버에는 새 백오피스를 연결하지 않는다', async () => {
  const upstream = new Upstream({ mode: 'connected', environment: 'prod', expectedFcmProjectId: 'catus-prod',
    dataUrl: 'http://data.internal', notificationUrl: 'http://notification.internal',
    fetchImpl: async () => Response.json({ environment: 'prod', fcmProjectId: 'catus-prod',
      contractVersion: '1', capabilities: [...contract.data, ...contract.notification]
        .filter(value => value !== 'content.magazine-read.v1') }),
  });
  assert.ok(contract.data.includes('content.magazine-read.v1'));
  await assert.rejects(upstream.magazineContent(issueId, '', 'member-1',
    { dataToken: 'data', notificationToken: 'notification' }), /필수 계약/);
});

test('잡지 내용 HTTP는 로그인과 ID·페이지 검사를 거쳐 읽기만 수행한다', async t => {
  const store = new Store(':memory:');
  const origin = 'http://127.0.0.1:4310';
  const salt = 'ab'.repeat(16);
  const calls = [];
  const app = createApp({ store, mode: 'local', origin,
    operators: { test: { passwordHash: `${salt}:${scryptSync('test', salt, 64).toString('hex')}` } },
    upstream: { magazineContent: async (...args) => {
      calls.push(args); return { issueId: args[0], cells: [{ body: '그날의 홍보 글' }], nextCursor: null };
    } },
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const path = `/api/history/magazine/${issueId}`;
  assert.equal((await fetch(base + path)).status, 401);
  const login = await fetch(base + '/api/login', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: 'test', password: 'test' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie };
  const result = await fetch(base + path + '?cursor=' + encodeURIComponent(cursor), { headers });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).cells[0].body, '그날의 홍보 글');
  assert.deepEqual(calls[0].slice(0, 3), [issueId, cursor, 'test']);
  assert.equal((await fetch(base + '/api/history/magazine/not-a-uuid', { headers })).status, 400);
  assert.equal((await fetch(base + path + '?cursor=' + 'a'.repeat(201), { headers })).status, 400);
  assert.equal(calls.length, 1);
  assert.equal(store.list().length, 0);
});
