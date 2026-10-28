import assert from 'node:assert/strict';
import { API_URL, ApiError } from '@/services/api/client';
import { CLIENT_CONTRACT_ERROR } from '@/services/api/home';
import { clearSession, saveSession } from '@/services/api/session';
import { getIslandRankings, utcWeekStart, type IslandRankings } from '@/services/api/rankings';

type Call = { url: string; init: RequestInit };

const calls: Call[] = [];

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

const rankingsBody = (over: Partial<IslandRankings> = {}): IslandRankings => ({
  items: [
    {
      rank: 1,
      islandId: '00000000-0000-7000-8000-0000000000aa',
      name: '소다 섬',
      averageFocusSeconds: 18000,
    },
    {
      rank: 1,
      islandId: '00000000-0000-7000-8000-0000000000bb',
      name: '딸기 섬',
      averageFocusSeconds: 18000,
    },
    {
      rank: 3,
      islandId: '00000000-0000-7000-8000-0000000000cc',
      name: '포도 섬',
      averageFocusSeconds: 9000,
    },
  ],
  myRank: 4,
  nextCursor: null,
  asOf: '2026-09-21T00:00:05Z',
  ...over,
});

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
});

test('getIslandRankings — week(주 시작일)·limit 만 보낸다, ISO 주차·cursor 없음', async () => {
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
  stub(200, { data: rankingsBody() });

  const res = await getIslandRankings({ week: '2026-09-20', limit: 30 });

  const url = calls[0].url;
  assert.ok(url.startsWith(`${API_URL}/rankings/islands?`));
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  assert.deepEqual([...params.keys()].sort(), ['limit', 'week']);
  assert.equal(params.get('week'), '2026-09-20');
  assert.equal(params.get('limit'), '30');
  assert.equal(res.asOf, '2026-09-21T00:00:05Z');
});

test('getIslandRankings — 동점은 서버 공동 순위(1,1,3)를 그대로 보존한다', async () => {
  stub(200, { data: rankingsBody() });

  const res = await getIslandRankings({ week: '2026-09-20' });

  assert.deepEqual(
    res.items.map((i) => i.rank),
    [1, 1, 3],
  );
});

test('getIslandRankings — 참가하지 않는 주는 myRank null, 미집계·빈 주는 items []', async () => {
  stub(200, { data: rankingsBody({ items: [], myRank: null }) });

  const res = await getIslandRankings({ week: '2026-09-13' });

  assert.deepEqual(res.items, []);
  assert.equal(res.myRank, null);
});

test('getIslandRankings — 422 OUT_OF_RANGE(일요일 아님·미래 주) 를 그대로 던진다', async () => {
  stub(422, {
    error: { code: 'OUT_OF_RANGE', message: '주 시작일은 일요일이어야 해요.', field: 'week' },
    requestId: 'r1',
  });

  const error = await failed(getIslandRankings({ week: '2026-09-21' }));
  assert.equal(error.code, 'OUT_OF_RANGE');
  assert.equal(error.field, 'week');
  assert.equal(error.status, 422);
});

test('getIslandRankings — rank 를 다시 매기지 않으므로 모양이 다른 응답은 계약 오류다', async () => {
  stub(200, {
    data: { items: [{ rank: '1', islandId: 'x', name: 'y' }], myRank: null, asOf: 'z' },
  });

  const error = await failed(getIslandRankings({ week: '2026-09-20' }));
  assert.equal(error.code, CLIENT_CONTRACT_ERROR);
});

// ── utcWeekStart — UTC 일요일 주 시작일 ──

test('utcWeekStart — 화요일은 그 주의 일요일을 돌려준다', () => {
  assert.equal(utcWeekStart(Date.UTC(2026, 8, 22, 15)), '2026-09-20');
});

test('utcWeekStart — 일요일 00:00Z 정각은 그날이 시작이다', () => {
  assert.equal(utcWeekStart(Date.UTC(2026, 8, 20, 0, 0)), '2026-09-20');
});

test('utcWeekStart — 토요일 밤·월 경계·연 경계도 같은 주의 일요일로 내린다', () => {
  assert.equal(utcWeekStart(Date.UTC(2026, 8, 26, 23, 59)), '2026-09-20');
  assert.equal(utcWeekStart(Date.UTC(2026, 9, 1)), '2026-09-27'); // 10/1 목 → 9/27 일
  assert.equal(utcWeekStart(Date.UTC(2026, 0, 1)), '2025-12-28'); // 1/1 목 → 전 해 일요일
});
