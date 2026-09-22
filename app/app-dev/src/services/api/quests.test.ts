import assert from 'node:assert/strict';
import { API_URL, ApiError } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import {
  claimQuest,
  createQuest,
  getCurrentQuests,
  getQuestProgress,
  updateQuest,
} from '@/services/api/quests';

type Call = { url: string; init: RequestInit };

const calls: Call[] = [];

const ISLAND = '11111111-2222-4333-8444-555555555555';
const QUEST = '66666666-7777-4888-8999-000000000000';
const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const item = (over: Record<string, unknown> = {}) => ({
  id: QUEST,
  occurrenceId: 'occ-1',
  title: '저녁 집중',
  type: 'focus',
  windowStart: '19:00',
  windowEnd: '22:00',
  timezone: 'UTC',
  date: '2026-09-21',
  targetMinutes: 50,
  myRate: 64,
  reward: { currency: 'village_points', amount: 10 },
  settlementStatus: 'open',
  claimable: false,
  claimBlockedReason: 'NOT_ACHIEVED',
  claimed: false,
  bonusAmount: 20,
  bonusGranted: false,
  version: 3,
  ...over,
});

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

test('GET /islands/{id}/quests/current — 무접두 경로·Bearer·회차 헤더를 그대로 돌려준다', async () => {
  stub(200, { data: { items: [item()] } });

  const current = await getCurrentQuests(ISLAND);

  assert.equal(calls[0].url, `${API_URL}/islands/${ISLAND}/quests/current`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(headers().Authorization, 'Bearer AT');
  // rate null·claimBlockedReason·version 을 합성·변형하지 않고 그대로 보존한다.
  assert.deepEqual(current.items[0], item());
});

test('GET progress — occurrenceId 를 유일한 query 로 인코딩해 싣는다(cursor 없음)', async () => {
  stub(200, {
    data: {
      ...item(),
      members: [
        {
          userId: 'u-1',
          name: '민지',
          rate: 100,
          measurementStatus: 'measured',
          achieved: true,
          claimed: true,
        },
        // 측정이 안 된 주민 — rate null 을 0 으로 바꾸지 않고 그대로 받는다.
        {
          userId: 'u-2',
          name: null,
          rate: null,
          measurementStatus: 'unavailable',
          achieved: false,
          claimed: false,
        },
      ],
      nextCursor: null,
    },
  });

  const progress = await getQuestProgress(ISLAND, QUEST, 'occ/with+symbol=');

  assert.equal(
    calls[0].url,
    `${API_URL}/islands/${ISLAND}/quests/${QUEST}/progress?occurrenceId=${encodeURIComponent('occ/with+symbol=')}`,
  );
  assert.equal(progress.members.length, 2);
  assert.equal(progress.members[1].rate, null);
  assert.equal(progress.members[1].name, null);
  assert.equal(progress.members[0].achieved, true);
  assert.equal(progress.members[0].claimed, true);
});

test('POST quests — 허용 키만 싣고 Idempotency-Key, 201 의 {id,title} 를 돌려준다', async () => {
  stub(201, { data: { id: QUEST, title: '저녁 집중' } });
  const body = {
    title: '저녁 집중',
    type: 'focus' as const,
    targetMinutes: 50,
    windowStart: '19:00',
    windowEnd: '22:00',
    timezone: 'UTC',
  };

  const created = await createQuest(ISLAND, body, KEY);

  assert.equal(calls[0].url, `${API_URL}/islands/${ISLAND}/quests`);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(sentBody(), body);
  assert.equal(headers()['Idempotency-Key'], KEY);
  assert.deepEqual(created, { id: QUEST, title: '저녁 집중' });
});

test('POST quests — screen 은 창 필드 없이 간다(서버가 허용 키 밖을 400 으로 거절)', async () => {
  stub(201, { data: { id: QUEST, title: '폰 줄이기' } });
  const body = { title: '폰 줄이기', type: 'screen' as const, targetMinutes: 90 };

  await createQuest(ISLAND, body, KEY);

  assert.deepEqual(sentBody(), { title: '폰 줄이기', type: 'screen', targetMinutes: 90 });
});

test('PATCH quests/{id} — 보낸 필드만 전달한다(expectedVersion·창 필드 추가 금지)', async () => {
  stub(200, { data: { id: QUEST, title: '새 제목', targetMinutes: 60 } });

  await updateQuest(ISLAND, QUEST, { title: '새 제목' }, KEY);

  assert.equal(calls[0].url, `${API_URL}/islands/${ISLAND}/quests/${QUEST}`);
  assert.equal(calls[0].init.method, 'PATCH');
  assert.deepEqual(sentBody(), { title: '새 제목' });
  assert.equal(headers()['Idempotency-Key'], KEY);
});

test('POST claims — 본문은 정확히 {occurrenceId, expectedVersion} 두 키다', async () => {
  stub(201, {
    data: {
      claimId: 'claim-1',
      occurrenceId: 'occ-1',
      villagePointsAdded: 10,
      bonusAdded: 20,
      claimed: true,
    },
  });

  const result = await claimQuest(
    ISLAND,
    QUEST,
    { occurrenceId: 'occ-1', expectedVersion: 3 },
    KEY,
  );

  assert.equal(calls[0].url, `${API_URL}/islands/${ISLAND}/quests/${QUEST}/claims`);
  assert.equal(calls[0].init.method, 'POST');
  // 지급량·claimable·사용자 id 는 서버가 판정한다 — 보내지 않는다.
  assert.deepEqual(sentBody(), { occurrenceId: 'occ-1', expectedVersion: 3 });
  assert.equal(headers()['Idempotency-Key'], KEY);
  assert.deepEqual(result, {
    claimId: 'claim-1',
    occurrenceId: 'occ-1',
    villagePointsAdded: 10,
    bonusAdded: 20,
    claimed: true,
  });
});

test('재시도는 같은 key 로 간다 — 호출자가 넘긴 값을 그대로 싣는다', async () => {
  stub(201, {
    data: { claimId: 'c1', occurrenceId: 'o', villagePointsAdded: 0, bonusAdded: 0, claimed: true },
  });
  const body = { occurrenceId: 'o', expectedVersion: 1 };
  await claimQuest(ISLAND, QUEST, body, KEY);
  await claimQuest(ISLAND, QUEST, body, KEY);
  assert.equal(headers(0)['Idempotency-Key'], KEY);
  assert.equal(headers(1)['Idempotency-Key'], KEY);
});

test('오류를 빈 목록·가짜 성공으로 바꾸지 않는다 — 400/403/409 코드·field·retryable 을 전파한다', async () => {
  stub(409, {
    error: {
      code: 'VERSION_CONFLICT',
      message: '다른 기기에서 먼저 바뀌었습니다.',
      field: 'expectedVersion',
      retryable: false,
    },
    requestId: 'req-1',
  });
  const conflict = await failed(
    claimQuest(ISLAND, QUEST, { occurrenceId: 'occ-1', expectedVersion: 3 }, KEY),
  );
  assert.equal(conflict.code, 'VERSION_CONFLICT');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.field, 'expectedVersion');

  stub(403, {
    error: { code: 'FORBIDDEN', message: '권한이 없습니다.', field: null, retryable: false },
    requestId: 'req-2',
  });
  const forbidden = await failed(
    createQuest(ISLAND, { title: 't', type: 'screen', targetMinutes: 30 }, KEY),
  );
  assert.equal(forbidden.code, 'FORBIDDEN');
  assert.equal(forbidden.status, 403);

  stub(400, {
    error: {
      code: 'INVALID_REQUEST',
      message: 'windowEnd 는 HH:mm 이어야 합니다.',
      field: 'windowEnd',
      retryable: false,
    },
    requestId: 'req-3',
  });
  const bad = await failed(
    createQuest(
      ISLAND,
      { title: 't', type: 'focus', targetMinutes: 30, windowStart: '19:00', windowEnd: '24:00' },
      KEY,
    ),
  );
  assert.equal(bad.code, 'INVALID_REQUEST');
  assert.equal(bad.field, 'windowEnd');
});
