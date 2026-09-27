import assert from 'node:assert/strict';
import { API_URL, ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import { getLedger, getTownHall } from '@/services/api/townHall';

type Call = { url: string; init: RequestInit };

const calls: Call[] = [];

/** 반드시 거절돼야 하는 요청. 성공하면 그 자체가 실패다. */
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

const ISLAND = '3f6b9c2a-7d4e-4a1b-8c5d-2e9f0a1b3c4d';

const townHallBody = {
  island: {
    id: ISLAND,
    name: '소다 섬',
    intro: '',
    visibility: 'public',
    approvalRequired: true,
    memberCount: 3,
    maxMembers: 8,
    membershipStatus: 'member',
    growthStage: null,
    themeId: null,
    role: 'member',
    version: 12,
  },
  members: { items: [], nextCursor: null, version: 7 },
  constructionOptions: {
    islandVersion: 12,
    costPolicyVersion: 3,
    selectedBuildingId: null,
    villagePoints: 0,
    walletVersion: 9,
    items: [],
  },
  joinRequests: null,
  joinRequestsAvailability: 'host_only',
  wallets: { fish: 1240, villagePoints: 0, fishVersion: null, villagePointsVersion: 9 },
  ledger: {
    month: '2026-09',
    earnedTotal: 60,
    spentTotal: 15,
    items: [
      {
        id: '8e1d2c3b-4a5f-4e6d-9c8b-7a6f5e4d3c2b',
        direction: 'earn',
        reason: 'contribution',
        amount: 480,
        createdAt: '2026-09-20T00:12:00Z',
        groupedUntil: '2026-09-20T09:51:00Z',
        entryCount: 480,
      },
    ],
    nextCursor: 'sig.abc+/==',
  },
};

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
});

test('getTownHall — 무접두 /screens/town-hall 을 GET·Bearer 로 부르고 {data} 를 벗긴다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub(200, { data: townHallBody });

  const screen = await getTownHall();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API_URL}/screens/town-hall`);
  assert.equal(calls[0].init.method, 'GET');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer AT');
  assert.equal(screen.island.id, ISLAND);
  assert.equal(screen.wallets.fish, 1240);
});

test('getTownHall — 일반 주민의 joinRequests null 과 빈 ledger 를 손실 없이 돌려준다', async () => {
  stub(200, {
    data: {
      ...townHallBody,
      joinRequests: null,
      joinRequestsAvailability: 'host_only',
      ledger: { month: '2026-09', earnedTotal: 0, spentTotal: 0, items: [], nextCursor: null },
    },
  });

  const screen = await getTownHall();

  assert.equal(screen.joinRequests, null);
  assert.equal(screen.joinRequestsAvailability, 'host_only');
  assert.deepEqual(screen.ledger.items, []);
  assert.equal(screen.ledger.nextCursor, null);
});

test('getLedger — month·direction·cursor 만 보내고 limit·timezone·멱등 키는 없다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub(200, { data: townHallBody.ledger });

  const page = await getLedger(ISLAND, {
    month: '2026-09',
    direction: 'earn',
    cursor: 'sig.abc+/==',
  });

  const url = calls[0].url;
  assert.ok(url.startsWith(`${API_URL}/islands/${ISLAND}/resources/ledger?`));
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  assert.deepEqual([...params.keys()].sort(), ['cursor', 'direction', 'month']);
  assert.equal(params.get('month'), '2026-09');
  assert.equal(params.get('direction'), 'earn');
  assert.equal(params.get('cursor'), 'sig.abc+/==');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers['Idempotency-Key'], undefined);
  assert.equal(page.items[0].groupedUntil, '2026-09-20T09:51:00Z');
  assert.equal(page.items[0].entryCount, 480);
  assert.equal(page.earnedTotal, 60);
  assert.equal(page.spentTotal, 15);
  assert.equal(page.nextCursor, 'sig.abc+/==');
});

test('getLedger — direction·cursor 없이 month 만 보낸다', async () => {
  stub(200, { data: townHallBody.ledger });

  await getLedger(ISLAND, { month: '2026-08' });

  const url = calls[0].url;
  assert.equal(url, `${API_URL}/islands/${ISLAND}/resources/ledger?month=2026-08`);
});

test('403 을 빈 장부로 접지 않고 ApiError 그대로 던진다 — 못 읽음과 거래 없음은 다르다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub(403, {
    error: { code: 'FORBIDDEN', message: '섬 주민만 볼 수 있어요.', field: null, retryable: false },
    requestId: 'req-ledger-1',
  });

  const error = await failed(getLedger(ISLAND, { month: '2026-09' }));
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, 'FORBIDDEN');
  assert.equal(error.status, 403);
});

test('응답 도중 세션이 교체되면 결과를 적용하지 않는다', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  (global as any).fetch = jest.fn(async () => {
    await saveSession({ accessToken: 'NEW', refreshToken: 'NEW', userId: 'u2' });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ data: townHallBody }),
    } as unknown as Response;
  });

  const error = await failed(getTownHall());
  assert.equal(error.code, CLIENT_STALE_SESSION);
});
