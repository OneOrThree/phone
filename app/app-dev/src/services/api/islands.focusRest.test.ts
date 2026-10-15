/**
 * 집중/휴식 멤버 스냅숏 API (GROMO-2010) — 무접두 공개 경로, `{data}` 언랩,
 * 403·네트워크 오류는 그대로 오류로 올린다(빈 성공으로 접지 않는다).
 */
import assert from 'node:assert/strict';
import { ApiError } from '@/services/api/client';
import { focusMembers, restMembers } from '@/services/api/islands';
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

const path = (c: Call) => new URL(c.url).pathname;

const focusSnap = {
  items: [
    {
      userId: 'u1',
      name: '민지',
      catColor: 'ginger',
      appearance: null,
      sessionId: 's-u1',
      subject: '영어 단어',
      activeSeconds: 1320,
      status: 'active',
    },
  ],
  serverNow: '2026-09-24T12:00:00Z',
  watermarks: [{ projection: 'focus.member', islandId: 'i1', aggregateId: 'u1', version: 3 }],
};
const restSnap = {
  items: [
    {
      userId: 'u2',
      name: '수아',
      catColor: 'gray',
      restSeat: 1,
      restStartedAt: '2026-09-24T11:55:00Z',
    },
  ],
  serverNow: '2026-09-24T12:00:00Z',
  watermarks: [{ projection: 'rest.member', islandId: 'i1', aggregateId: 'u2', version: 2 }],
};

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

test('focus-members·rest-members 는 무접두 공개 경로로 읽고 {data}를 언랩한다', async () => {
  stub([
    { status: 200, body: { data: focusSnap } },
    { status: 200, body: { data: restSnap } },
  ]);
  const focus = await focusMembers('i 1');
  const rest = await restMembers('i 1');
  assert.equal(path(calls[0]), '/islands/i%201/focus-members');
  assert.equal(path(calls[1]), '/islands/i%201/rest-members');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer AT');
  assert.equal(focus.items[0].userId, 'u1');
  assert.equal(focus.watermarks?.[0].version, 3);
  assert.equal(rest.items[0].restSeat, 1);
});

test('빈 목록은 성공이다 — 오류로 접지 않는다', async () => {
  stub([{ status: 200, body: { data: { items: [], serverNow: '2026-09-24T12:00:00Z' } } }]);
  const focus = await focusMembers('i1');
  assert.equal(focus.items.length, 0);
});

test('403 MEMBER_ONLY 는 오류로 올라간다', async () => {
  stub([
    {
      status: 403,
      body: {
        error: {
          code: 'MEMBER_ONLY',
          message: '섬 주민만 볼 수 있어요',
          field: null,
          retryable: false,
        },
      },
    },
  ]);
  await assert.rejects(focusMembers('i1'), (e) => (e as ApiError).code === 'MEMBER_ONLY');
});
