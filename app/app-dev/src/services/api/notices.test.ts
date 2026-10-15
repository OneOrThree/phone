import assert from 'node:assert/strict';
import { API_URL, ApiError } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import {
  createNotice,
  createNoticeComment,
  deleteNotice,
  getBoard,
  getNotice,
  listNotices,
  updateNotice,
} from '@/services/api/notices';

type Call = { url: string; init: RequestInit };

const calls: Call[] = [];

const ISLAND = '11111111-2222-4333-8444-555555555555';
const NOTICE = '66666666-7777-4888-8999-000000000000';
const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const failed = (p: Promise<unknown>): Promise<ApiError> =>
  p.then(
    () => {
      throw new Error('요청이 거절돼야 한다');
    },
    (e: unknown) => e as ApiError,
  );

function stub(status: number, body: unknown) {
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    } as unknown as Response;
  });
}

const headers = (n = 0) => calls[n].init.headers as Record<string, string>;
const sentBody = (n = 0) => JSON.parse(calls[n].init.body as string);

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('GET /screens/board — 무접두 경로·Bearer·섬/공지 첫 페이지를 그대로 돌려준다', async () => {
  const screen = {
    island: { id: ISLAND, role: 'member', version: 3 },
    quests: { items: [] },
    notices: {
      items: [{ id: NOTICE, title: '환영해요', commentCount: 2 }],
      nextCursor: null,
    },
    wallets: { fish: 0, villagePoints: 0, fishVersion: null, villagePointsVersion: 7 },
  };
  stub(200, { data: screen });

  const board = await getBoard();

  assert.equal(calls[0].url, `${API_URL}/screens/board`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(headers().Authorization, 'Bearer AT');
  assert.equal(board.island.id, ISLAND);
  // 목록 항목의 commentCount·null 커서를 그대로 보존한다(createdAt 같은 값을 합성하지 않는다).
  assert.deepEqual(board.notices, screen.notices);
});

test('GET /islands/{id}/notices — 커서 없으면 query 없이, 있으면 인코딩해 싣는다', async () => {
  stub(200, { data: { items: [], nextCursor: 'next+with/symbol=' } });

  const page = await listNotices(ISLAND);
  assert.equal(calls[0].url, `${API_URL}/islands/${ISLAND}/notices`);
  assert.equal(page.nextCursor, 'next+with/symbol=');

  stub(200, { data: { items: [], nextCursor: null } });
  await listNotices(ISLAND, 'next+with/symbol=');
  assert.equal(
    calls[1].url,
    `${API_URL}/islands/${ISLAND}/notices?cursor=${encodeURIComponent('next+with/symbol=')}`,
  );
});

test('GET /islands/{id}/notices/{nid} — commentsCursor·탈퇴 작성자 null 을 보존한다', async () => {
  stub(200, {
    data: {
      id: NOTICE,
      title: '공지',
      body: '본문',
      version: 4,
      comments: [
        {
          id: 'c1',
          userId: 'u-1',
          name: '민지',
          text: '좋아요',
          createdAt: '2026-09-11T09:10:00Z',
        },
        // 탈퇴·삭제된 작성자 — 앱이 가짜 이름을 채우지 않고 null 그대로 받는다.
        { id: 'c2', userId: null, name: null, text: '응원', createdAt: '2026-09-11T10:00:00Z' },
      ],
      nextCommentsCursor: null,
    },
  });

  const detail = await getNotice(ISLAND, NOTICE, 'cur/1+2');

  assert.equal(
    calls[0].url,
    `${API_URL}/islands/${ISLAND}/notices/${NOTICE}?commentsCursor=${encodeURIComponent('cur/1+2')}`,
  );
  assert.equal(detail.version, 4);
  assert.equal(detail.comments[1].userId, null);
  assert.equal(detail.comments[1].name, null);
});

test('POST notices — 정확히 {title,body}, Idempotency-Key, 201 의 {id,title,body}', async () => {
  stub(201, { data: { id: NOTICE, title: '제목', body: '본문' } });

  const created = await createNotice(ISLAND, { title: '제목', body: '본문' }, KEY);

  assert.equal(calls[0].url, `${API_URL}/islands/${ISLAND}/notices`);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(sentBody(), { title: '제목', body: '본문' });
  assert.equal(headers()['Idempotency-Key'], KEY);
  assert.deepEqual(created, { id: NOTICE, title: '제목', body: '본문' });
});

test('PATCH notices/{id} — 보낸 필드만 전달한다(expectedVersion·생략 필드 추가 금지)', async () => {
  stub(200, { data: { id: NOTICE, title: '새 제목', body: '옛 본문' } });

  await updateNotice(ISLAND, NOTICE, { title: '새 제목' }, KEY);

  assert.equal(calls[0].init.method, 'PATCH');
  // body 키·expectedVersion 을 싣지 않는다 — 있으면 서버가 400 으로 거절한다.
  assert.deepEqual(sentBody(), { title: '새 제목' });
  assert.equal(headers()['Idempotency-Key'], KEY);
});

test('DELETE notices/{id} — 본문·Content-Type 없이 key 만 싣고 {deleted:true} 를 돌려준다', async () => {
  stub(200, { data: { deleted: true } });

  const result = await deleteNotice(ISLAND, NOTICE, KEY);

  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(headers()['Content-Type'], undefined);
  assert.equal(headers()['Idempotency-Key'], KEY);
  assert.deepEqual(result, { deleted: true });
});

test('POST comments — 정확히 {text} 만 보낸다(대리 userId 추가 금지), 201 을 돌려준다', async () => {
  stub(201, { data: { id: 'c9', name: null, text: '같이 해요' } });

  const created = await createNoticeComment(ISLAND, NOTICE, { text: '같이 해요' }, KEY);

  assert.equal(calls[0].url, `${API_URL}/islands/${ISLAND}/notices/${NOTICE}/comments`);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(sentBody(), { text: '같이 해요' });
  assert.equal(headers()['Idempotency-Key'], KEY);
  assert.deepEqual(created, { id: 'c9', name: null, text: '같이 해요' });
});

test('재시도는 같은 key 로 간다 — 호출자가 넘긴 값을 그대로 싣는다', async () => {
  stub(201, { data: { id: NOTICE, title: 't', body: 'b' } });
  await createNotice(ISLAND, { title: 't', body: 'b' }, KEY);
  await createNotice(ISLAND, { title: 't', body: 'b' }, KEY);
  assert.equal(headers(0)['Idempotency-Key'], KEY);
  assert.equal(headers(1)['Idempotency-Key'], KEY);
});

test('오류를 빈 목록·가짜 성공으로 바꾸지 않는다 — 403/409 코드·field 를 그대로 전파한다', async () => {
  stub(403, {
    error: { code: 'FORBIDDEN', message: '권한이 없습니다.', field: null, retryable: false },
    requestId: 'req-1',
  });
  const forbidden = await failed(createNotice(ISLAND, { title: 't', body: 'b' }, KEY));
  assert.equal(forbidden.code, 'FORBIDDEN');
  assert.equal(forbidden.status, 403);

  stub(409, {
    error: {
      code: 'CURSOR_EXPIRED',
      message: '커서가 만료됐습니다.',
      field: 'cursor',
      retryable: false,
    },
    requestId: 'req-2',
  });
  const expired = await failed(listNotices(ISLAND, 'old-cursor'));
  assert.equal(expired.code, 'CURSOR_EXPIRED');
  assert.equal(expired.field, 'cursor');
});
