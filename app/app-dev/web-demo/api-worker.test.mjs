import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from './api-worker.mjs';

const origin = 'https://try.oneorthree.world';

test('웹 고양이 꾸미기 카탈로그를 공개 API에 연결한다', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (request) => {
    assert.equal(request.url, 'https://catus-api-v2.oneorthree.world/customization/catalog');
    return new Response('{"data":{"products":[]}}');
  };
  try {
    const response = await worker.fetch(new Request(origin + '/service-api/customization/catalog'));
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});

test('공개 API의 인증·본문을 전달하고 쿠키와 응답 캐시를 차단한다', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (request, options) => {
    called = true;
    assert.equal(request.url, 'https://catus-api-v2.oneorthree.world/focus-sessions');
    assert.equal(request.headers.get('Authorization'), 'Bearer test-only-token');
    assert.equal(request.headers.get('Cookie'), null);
    assert.equal(request.headers.get('Origin'), 'https://catus-api-v2.oneorthree.world');
    assert.equal(await request.text(), '{"subject":"local-test"}');
    assert.equal(options.redirect, 'manual');
    return new Response('{"data":{}}', { headers: { 'Set-Cookie': 'ignored=1' } });
  };
  try {
    const response = await worker.fetch(
      new Request(origin + '/service-api/focus-sessions', {
        method: 'POST',
        headers: { Origin: origin, Authorization: 'Bearer test-only-token', Cookie: 'ignored=1' },
        body: '{"subject":"local-test"}',
      }),
    );
    assert.equal(called, true);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('Set-Cookie'), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('다른 출처·내부 경로·다른 호스트는 upstream 호출 전에 거절한다', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('upstream을 호출하면 안 된다');
  };
  try {
    for (const [url, init, status] of [
      [origin + '/service-api/me', { headers: { Origin: 'https://elsewhere.example' } }, 403],
      [origin + '/service-api/auth/sessions/guest', { method: 'POST' }, 403],
      [origin + '/service-api/internal/users', {}, 404],
      [origin + '/service-api/me/%2e%2e%2finternal', {}, 400],
      ['https://elsewhere.example/service-api/me', {}, 404],
    ])
      assert.equal((await worker.fetch(new Request(url, init))).status, status);
  } finally {
    globalThis.fetch = original;
  }
});

test('WebSocket upgrade 응답은 스트림을 소비하지 않고 그대로 돌려준다', async () => {
  const original = globalThis.fetch;
  const upgraded = { status: 101, webSocket: {} };
  globalThis.fetch = async (request) => {
    assert.equal(request.url, 'https://catus-api-v2.oneorthree.world/ws/realtime');
    assert.equal(request.headers.get('Upgrade'), 'websocket');
    return upgraded;
  };
  try {
    const response = await worker.fetch(
      new Request(origin + '/service-api/ws/realtime', {
        headers: { Origin: origin, Upgrade: 'websocket' },
      }),
    );
    assert.equal(response, upgraded);
  } finally {
    globalThis.fetch = original;
  }
});
