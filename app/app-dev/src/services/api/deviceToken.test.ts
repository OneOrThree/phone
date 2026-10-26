import assert from 'node:assert/strict';
import { API_URL, ApiError } from '@/services/api/client';
import { deleteDevice, registerDevice } from '@/services/api/deviceToken';
import { clearSession, getSession, saveSession } from '@/services/api/session';

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

const FCM_TOKEN = 'fcm-token-1';
const OWNERSHIP = '0b8f4f0e-6a1e-4f43-9d61-3a5f1f7c9e21';
const NEXT_OWNERSHIP = '7c1d2a52-3e0b-4a8e-9b4f-2f6f5d0f8a10';
const TAG = '5d1c2f0a-9a53-4b36-8f0e-1c2d3e4f5a6b';
const UUID36 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('registerDevice — 2.0 의 /api/v1 첫 예외: PUT /api/v1/users/me/device-token 에 본문과 넘긴 멱등 키를 싣는다', async () => {
  stub([{ status: 200, body: { ownershipToken: NEXT_OWNERSHIP, deliveryTag: TAG } }]);

  const registered = await registerDevice(
    { deviceToken: FCM_TOKEN, ownershipToken: OWNERSHIP, deviceBootstrap: 'bootstrap-1' },
    'register-key',
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API_URL}/api/v1/users/me/device-token`);
  assert.equal(path(calls[0]), '/api/v1/users/me/device-token');
  assert.equal(calls[0].init.method, 'PUT');
  assert.deepEqual(body(calls[0]), {
    deviceToken: FCM_TOKEN,
    ownershipToken: OWNERSHIP,
    deviceBootstrap: 'bootstrap-1',
  });
  // 키는 호출자가 고정해서 넘긴다 — 응답 유실 뒤 같은 키·같은 본문으로 다시 보내야 서버가 재생한다.
  assert.equal(header(calls[0], 'Idempotency-Key'), 'register-key');
  assert.equal(header(calls[0], 'Authorization'), 'Bearer AT');
  // 봉투 없는 legacy 본문 그대로 통과한다.
  assert.deepEqual(registered, { ownershipToken: NEXT_OWNERSHIP, deliveryTag: TAG });
});

test('registerDevice — 값 없는 선택 필드는 키째 생략하고, deliveryTag 가 없으면 키 없이 돌려준다', async () => {
  stub([
    { status: 200, body: { ownershipToken: NEXT_OWNERSHIP } },
    { status: 200, body: { ownershipToken: NEXT_OWNERSHIP, deliveryTag: null } },
  ]);

  const first = await registerDevice({ deviceToken: FCM_TOKEN }, 'key-1');
  const second = await registerDevice({ deviceToken: FCM_TOKEN }, 'key-2');

  // 빈 값·null 의 ownershipToken 은 서버가 400 이다 — 없으면 키 자체를 보내지 않는다.
  assert.deepEqual(body(calls[0]), { deviceToken: FCM_TOKEN });
  // deliveryTag 부재는 영구 정상(서버가 아직 안 싣거나 응답 재생)이다 — 키를 만들지 않는다.
  assert.deepEqual(first, { ownershipToken: NEXT_OWNERSHIP });
  assert.equal('deliveryTag' in first, false);
  assert.deepEqual(second, { ownershipToken: NEXT_OWNERSHIP });
  assert.equal('deliveryTag' in second, false);
});

test('registerDevice — 응답의 ownershipToken 이 문자열이 아니면 계약 불일치로 던진다', async () => {
  const bodies: unknown[] = [
    {},
    { ownershipToken: null },
    { ownershipToken: 7 },
    { ownershipToken: '' },
  ];
  for (const responseBody of bodies) {
    stub([{ status: 200, body: responseBody }]);
    const error = await registerDevice({ deviceToken: FCM_TOKEN }, 'key-3').catch((e) => e);
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'UPSTREAM_CONTRACT_MISMATCH');
    assert.equal(error.status, 502);
  }

  // 본문 자체가 없는 200 도 같다.
  stub([{ status: 200 }]);
  const empty = await registerDevice({ deviceToken: FCM_TOKEN }, 'key-4').catch((e) => e);
  assert.ok(empty instanceof ApiError);
  assert.equal(empty.code, 'UPSTREAM_CONTRACT_MISMATCH');
});

test('deleteDevice — 2.0 의 /api/v1 첫 예외: DELETE 에 X-Device-Token·X-Device-Ownership·Idempotency-Key 헤더 3개를 싣고 본문은 없다', async () => {
  stub([{ status: 204 }]);

  const result = await deleteDevice(FCM_TOKEN, OWNERSHIP, 'delete-key');

  assert.equal(result, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API_URL}/api/v1/users/me/device-token`);
  assert.equal(path(calls[0]), '/api/v1/users/me/device-token');
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(header(calls[0], 'X-Device-Token'), FCM_TOKEN);
  assert.equal(header(calls[0], 'X-Device-Ownership'), OWNERSHIP);
  assert.equal(header(calls[0], 'Idempotency-Key'), 'delete-key');
  assert.equal(header(calls[0], 'Authorization'), 'Bearer AT');
  // 본문이 없다 — 본문으로 요구하면 구 서버가 거절한다.
  assert.equal(calls[0].init.body, undefined);
  assert.equal(header(calls[0], 'Content-Type'), undefined);
});

test('deleteDevice — ownership 을 모르면 그 헤더를 생략하고, 키를 생략하면 UUID36 을 만든다', async () => {
  stub([{ status: 204 }]);

  await deleteDevice(FCM_TOKEN, undefined);

  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers['X-Device-Token'], FCM_TOKEN);
  // 빈 값을 실으면 서버가 «깨진 값» 으로 400 이다 — 없으면 헤더 자체를 보내지 않는다.
  assert.equal('X-Device-Ownership' in headers, false);
  assert.match(headers['Idempotency-Key'], UUID36);
});

test('legacy 최상위 {code,message} 오류가 ApiError.code 로 읽힌다 — 409 4종·401·502·503', async () => {
  const cases: [number, string][] = [
    [409, 'DEVICE_OWNERSHIP_CONFLICT'],
    [409, 'SESSION_REVOKED'],
    [409, 'STALE_AUTH_GENERATION'],
    [409, 'IDEMPOTENCY_KEY_CONFLICT'],
    [401, 'USER_INACTIVE'],
    [502, 'UPSTREAM_CONTRACT_MISMATCH'],
    [503, 'UPSTREAM_UNAVAILABLE'],
  ];
  for (const [status, code] of cases) {
    stub([{ status, body: { code, message: '서버 안내 문구' } }]);

    const put = await registerDevice({ deviceToken: FCM_TOKEN }, 'k').catch((e) => e);
    assert.ok(put instanceof ApiError);
    assert.equal(put.code, code);
    assert.equal(put.status, status);
    assert.equal(put.message, '서버 안내 문구');

    const del = await deleteDevice(FCM_TOKEN, OWNERSHIP, 'k').catch((e) => e);
    assert.ok(del instanceof ApiError);
    assert.equal(del.code, code);
    assert.equal(del.status, status);
  }
  // UNAUTHORIZED 가 아닌 401(USER_INACTIVE)은 refresh 도 세션 정리도 일으키지 않는다.
  assert.notEqual(getSession(), null);
  assert.equal(
    calls.some((call) => path(call).endsWith('/refresh')),
    false,
  );
});

test('registerDevice — 만료 AT 의 legacy 401 UNAUTHORIZED 는 refresh 뒤 같은 멱등 키·같은 본문으로 한 번 다시 보낸다', async () => {
  stub([
    { status: 401, body: { code: 'UNAUTHORIZED', message: '인증이 필요합니다.' } },
    { status: 200, body: { data: { accessToken: 'NEW_AT', refreshToken: null } } },
    { status: 200, body: { ownershipToken: NEXT_OWNERSHIP, deliveryTag: TAG } },
  ]);

  const registered = await registerDevice({ deviceToken: FCM_TOKEN }, 'retry-key');

  assert.equal(calls.length, 3);
  assert.equal(path(calls[1]), '/auth/sessions/current/refresh');
  assert.equal(path(calls[2]), '/api/v1/users/me/device-token');
  assert.equal(calls[2].init.method, 'PUT');
  assert.equal(header(calls[2], 'Authorization'), 'Bearer NEW_AT');
  assert.equal(header(calls[2], 'Idempotency-Key'), 'retry-key');
  assert.deepEqual(body(calls[2]), body(calls[0]));
  assert.deepEqual(registered, { ownershipToken: NEXT_OWNERSHIP, deliveryTag: TAG });
});
