/**
 * 섬 방명록 API (GROMO-2263 · 서버 계약 GROMO-2262) — 무접두 공개 경로, `{data}` 언랩.
 * 쓰기는 멱등 키 없이 `{content}` 하나만 보내고, 거절 코드는 그대로 오류로 올라간다.
 */
import assert from 'node:assert/strict';
import { ApiError } from '@/services/api/client';
import {
  deleteGuestbookEntry,
  getGuestbook,
  GUESTBOOK_CONTENT_MAX,
  writeGuestbook,
} from '@/services/api/islands';
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
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];
const error = (code: string, status: number) => ({
  status,
  body: { error: { code, message: '거절됐어요', field: null, retryable: false } },
});

const entry = {
  id: 'g1',
  authorId: 'u2',
  authorName: '수아',
  content: '놀러 왔어요 🐟',
  createdAt: '2026-10-12T01:00:00Z',
  mine: false,
};

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

test('getGuestbook — GET /islands/{id}/guestbook 을 {data} 언랩해 돌려준다', async () => {
  stub([{ status: 200, body: { data: { boardBuilt: true, items: [entry] } } }]);
  const page = await getGuestbook('i 1');
  assert.equal(path(calls[0]), '/islands/i%201/guestbook');
  assert.equal(calls[0].init.method ?? 'GET', 'GET');
  assert.equal(header(calls[0], 'Authorization'), 'Bearer AT');
  assert.equal(page.boardBuilt, true);
  assert.deepEqual(page.items, [entry]);
});

test('getGuestbook — 게시판이 없는 섬은 boardBuilt=false 와 빈 목록이다', async () => {
  stub([{ status: 200, body: { data: { boardBuilt: false, items: [] } } }]);
  assert.deepEqual(await getGuestbook('i1'), { boardBuilt: false, items: [] });
});

test('writeGuestbook — POST 는 {content} 하나만 보내고 멱등 키를 싣지 않는다', async () => {
  stub([{ status: 201, body: { data: entry } }]);
  const created = await writeGuestbook('i1', '놀러 왔어요 🐟');
  assert.equal(path(calls[0]), '/islands/i1/guestbook');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(header(calls[0], 'Idempotency-Key'), undefined);
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { content: '놀러 왔어요 🐟' });
  assert.equal(created.id, 'g1');
  assert.equal(GUESTBOOK_CONTENT_MAX, 20);
});

test.each([
  ['FACILITY_LOCKED', 403],
  ['SOCIAL_LOGIN_REQUIRED', 403],
  ['GUESTBOOK_ALREADY_WRITTEN_TODAY', 409],
])('writeGuestbook — %s(%i)는 코드 그대로 오류로 올라간다', async (code, status) => {
  stub([error(code, status)]);
  await assert.rejects(
    writeGuestbook('i1', '안녕'),
    (e) => e instanceof ApiError && e.code === code && e.status === status,
  );
});

test('deleteGuestbookEntry — DELETE /islands/{id}/guestbook/{entryId}, 404 는 오류로 올라간다', async () => {
  stub([{ status: 200, body: { data: { deleted: true } } }, error('NOT_FOUND', 404)]);
  assert.deepEqual(await deleteGuestbookEntry('i1', 'g 1'), { deleted: true });
  assert.equal(path(calls[0]), '/islands/i1/guestbook/g%201');
  assert.equal(calls[0].init.method, 'DELETE');
  await assert.rejects(
    deleteGuestbookEntry('i1', 'g1'),
    (e) => e instanceof ApiError && e.code === 'NOT_FOUND',
  );
});
