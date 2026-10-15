import assert from 'node:assert/strict';
import { API_URL, ApiError } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import {
  closeLetter,
  getLetter,
  getMailboxScreen,
  listIslandMessages,
  listLetters,
  sendIslandMessage,
  sendLetter,
} from '@/services/api/letters';

type Call = { url: string; init: RequestInit };

const calls: Call[] = [];

const LETTER = '66666666-7777-4888-8999-000000000000';
const ISLAND = '11111111-2222-4333-8444-555555555555';

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

test('GET /screens/mailbox — 무접두 경로·Bearer·세 fragment 를 그대로 돌려준다', async () => {
  const screen = {
    island: { id: ISLAND, name: '소다 섬', role: 'member', memberCount: 3 },
    messages: {
      items: [
        {
          id: 'm1',
          clientMessageId: 'c1',
          userId: 'u2',
          name: '민지',
          text: '안녕',
          createdAt: '2026-09-20T10:00:00Z',
        },
      ],
      nextCursor: null,
    },
    letters: {
      content: [
        {
          id: LETTER,
          counterpartUserId: 'u2',
          counterpartNickname: '민지',
          content: '반가워',
          isRead: false,
          createdAt: '2026-09-20T11:00:00Z',
        },
      ],
      size: 20,
      hasNext: false,
      nextCursor: null,
    },
    friends: [
      {
        userId: 'u2',
        nickname: '민지',
        mainIslandName: '하늘 섬',
        myFavorite: false,
        theirFavorite: false,
      },
    ],
  };
  stub(200, { data: screen });

  const mailbox = await getMailboxScreen();

  assert.equal(calls[0].url, `${API_URL}/screens/mailbox`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(headers().Authorization, 'Bearer AT');
  assert.equal(mailbox.island.id, ISLAND);
  assert.deepEqual(mailbox.letters, screen.letters);
  assert.deepEqual(mailbox.friends, screen.friends);
});

test('GET /letters — type 을 싣고 cursor 는 있을 때만 인코딩해 붙인다', async () => {
  stub(200, { data: { content: [], size: 20, hasNext: false, nextCursor: null } });
  await listLetters('received');
  assert.equal(calls[0].url, `${API_URL}/letters?type=received`);

  stub(200, { data: { content: [], size: 20, hasNext: false, nextCursor: null } });
  await listLetters('sent', 'cur/1+2=');
  assert.equal(
    calls[1].url,
    `${API_URL}/letters?type=sent&cursor=${encodeURIComponent('cur/1+2=')}`,
  );
});

test('GET /letters/{id} — 읽기다. 닫기(DELETE)가 아니며 본문·키를 싣지 않는다', async () => {
  stub(200, {
    data: {
      id: LETTER,
      senderId: 'u2',
      senderNickname: '민지',
      receiverId: 'u1',
      content: '본문',
      createdAt: '2026-09-20T11:00:00Z',
      readAt: '2026-09-20T12:00:00Z',
    },
  });

  const letter = await getLetter(LETTER);

  assert.equal(calls[0].url, `${API_URL}/letters/${LETTER}`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(letter.readAt, '2026-09-20T12:00:00Z');
});

test('POST /letters — 정확히 {receiverId,content}, Idempotency-Key 계약 없음을 지킨다', async () => {
  stub(201, {
    data: {
      id: LETTER,
      senderId: 'u1',
      senderNickname: '나',
      receiverId: 'u2',
      content: '잘 지내?',
      createdAt: '2026-09-20T12:00:00Z',
      readAt: null,
    },
  });

  const created = await sendLetter({ receiverId: 'u2', content: '잘 지내?' });

  assert.equal(calls[0].url, `${API_URL}/letters`);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(sentBody(), { receiverId: 'u2', content: '잘 지내?' });
  // 서버 계약에 멱등 키가 없다 — 헤더를 지어내지 않는다.
  assert.equal(headers()['Idempotency-Key'], undefined);
  assert.equal(created.id, LETTER);
  assert.equal(created.receiverId, 'u2');
});

test('DELETE /letters/{id} — 닫기다. 본문·Content-Type 없이 204 를 성공으로 돌려준다', async () => {
  stub(204, undefined);

  await closeLetter(LETTER);

  assert.equal(calls[0].url, `${API_URL}/letters/${LETTER}`);
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(headers()['Content-Type'], undefined);
});

test('닫기 재시도 — 이미 닫힌 편지는 404 NOT_FOUND 를 그대로 돌려준다', async () => {
  stub(404, {
    error: {
      code: 'NOT_FOUND',
      message: '편지를 찾을 수 없습니다.',
      field: 'letterId',
      retryable: false,
    },
    requestId: 'req-1',
  });

  const error = await failed(closeLetter(LETTER));
  assert.equal(error.code, 'NOT_FOUND');
  assert.equal(error.status, 404);
});

test('GET /islands/{id}/messages — cursor 는 있을 때만 인코딩해 붙인다', async () => {
  stub(200, { data: { items: [], nextCursor: null } });
  await listIslandMessages(ISLAND);
  assert.equal(calls[0].url, `${API_URL}/islands/${ISLAND}/messages`);

  stub(200, { data: { items: [], nextCursor: null } });
  await listIslandMessages(ISLAND, 'old/1+2');
  assert.equal(
    calls[1].url,
    `${API_URL}/islands/${ISLAND}/messages?cursor=${encodeURIComponent('old/1+2')}`,
  );
});

test('POST /islands/{id}/messages — 정확히 {clientMessageId,text} 를 보내고 저장본을 돌려준다', async () => {
  stub(201, {
    data: {
      id: 'm9',
      clientMessageId: 'key-1',
      userId: 'u1',
      name: '나',
      text: '같이 하자',
      createdAt: '2026-09-20T12:00:00Z',
    },
  });

  const message = await sendIslandMessage(ISLAND, { clientMessageId: 'key-1', text: '같이 하자' });

  assert.equal(calls[0].url, `${API_URL}/islands/${ISLAND}/messages`);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(sentBody(), { clientMessageId: 'key-1', text: '같이 하자' });
  assert.equal(message.id, 'm9');
});

test('오류를 빈 목록·가짜 성공으로 바꾸지 않는다 — 403 코드·status 를 그대로 전파한다', async () => {
  stub(403, {
    error: {
      code: 'SOCIAL_LOGIN_REQUIRED',
      message: '회원 연동이 필요합니다.',
      field: null,
      retryable: false,
    },
    requestId: 'req-1',
  });
  const guest = await failed(sendLetter({ receiverId: 'u2', content: 'x' }));
  assert.equal(guest.code, 'SOCIAL_LOGIN_REQUIRED');
  assert.equal(guest.status, 403);

  stub(403, {
    error: {
      code: 'NOT_LETTER_RECEIVER',
      message: '받는 사람만 닫을 수 있습니다.',
      field: null,
      retryable: false,
    },
    requestId: 'req-2',
  });
  const wrongSide = await failed(closeLetter(LETTER));
  assert.equal(wrongSide.code, 'NOT_LETTER_RECEIVER');
});
