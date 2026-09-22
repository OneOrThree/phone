import assert from 'node:assert/strict';
import { updateProfile, withdrawAccount } from '@/services/api/account';
import { API_URL } from '@/services/api/client';
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

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('updateProfile — PATCH /me 에 본문과 넘긴 멱등 키를 싣고 저장본을 돌려준다', async () => {
  stub([
    {
      status: 200,
      body: { data: { id: 'u1', name: '구름이', catColor: 'calico', mainIslandId: 'i1' } },
    },
  ]);

  const saved = await updateProfile({ name: '구름이', catColor: 'calico' }, 'key-1');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API_URL}/me`);
  assert.equal(path(calls[0]), '/me');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.deepEqual(body(calls[0]), { name: '구름이', catColor: 'calico' });
  assert.equal(header(calls[0], 'Idempotency-Key'), 'key-1');
  assert.equal(header(calls[0], 'Authorization'), 'Bearer AT');
  assert.deepEqual(saved, { id: 'u1', name: '구름이', catColor: 'calico', mainIslandId: 'i1' });
});

test('updateProfile — 키 생략 시 UUID36 멱등 키를 만든다', async () => {
  stub([
    {
      status: 200,
      body: { data: { id: 'u1', name: '구름이', catColor: 'calico', mainIslandId: null } },
    },
  ]);

  await updateProfile({ name: '구름이' });

  const key = header(calls[0], 'Idempotency-Key');
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // 보내지 않은 키는 생략된다 — 명시 null 은 계약 위반(400)이다
  assert.deepEqual(body(calls[0]), { name: '구름이' });
});

test('withdrawAccount — DELETE /me 에 확인 본문과 멱등 키를 싣는다', async () => {
  stub([{ status: 200, body: { data: { deleted: true } } }]);

  const result = await withdrawAccount('withdraw-key');

  assert.equal(path(calls[0]), '/me');
  assert.equal(calls[0].init.method, 'DELETE');
  assert.deepEqual(body(calls[0]), { confirmation: 'DELETE' });
  assert.equal(header(calls[0], 'Idempotency-Key'), 'withdraw-key');
  assert.equal(header(calls[0], 'Authorization'), 'Bearer AT');
  assert.deepEqual(result, { deleted: true });
});
