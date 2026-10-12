/**
 * 망원경 API (GROMO-2266·2269·2273 · 서버 계약 GROMO-2260·2265·2268) — 무접두 공개 경로, `{data}` 언랩.
 * 서버가 아직 없어 계약 모양의 응답을 fetch 스텁으로 흘려 본다.
 */
import assert from 'node:assert/strict';
import { ApiError } from '@/services/api/client';
import {
  arriveAtIsland,
  getTelescope,
  pinToTelescope,
  unpinFromTelescope,
} from '@/services/api/telescope';
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

const wireItem = (over: object = {}) => ({
  islandId: 'i1',
  name: '단풍섬',
  intro: '같이 집중해요',
  memberCount: 4,
  maxMembers: 15,
  approvalRequired: false,
  membershipStatus: 'none',
  slot: 'nearby',
  sailingMinutes: 15,
  averageFocusMinutesPerDay: 83,
  full: false,
  arrivedBefore: false,
  ...over,
});

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'me' });
});

test('getTelescope — GET /me/telescope 을 {data} 언랩해 돌려준다(게스트도 같은 경로)', async () => {
  const data = {
    bucketStart: '2026-10-12T05:00:00Z',
    nextRefreshMinutes: 37,
    items: [wireItem(), wireItem({ islandId: 'i2', averageFocusMinutesPerDay: null })],
  };
  stub([{ status: 200, body: { data } }]);
  const result = await getTelescope();
  assert.equal(path(calls[0]), '/me/telescope');
  assert.equal(calls[0].init.method ?? 'GET', 'GET');
  assert.equal(header(calls[0], 'Authorization'), 'Bearer AT');
  assert.deepEqual(result, data);
});

test('getTelescope — 소속 섬이 하나도 없는 빈 목록도 정상이다', async () => {
  stub([{ status: 200, body: { data: { bucketStart: 'b', nextRefreshMinutes: 60, items: [] } } }]);
  assert.deepEqual((await getTelescope()).items, []);
});

test.each([
  ['items 가 배열이 아님', { bucketStart: 'b', nextRefreshMinutes: 5, items: null }],
  ['남은 시간이 숫자가 아님', { bucketStart: 'b', nextRefreshMinutes: '5', items: [] }],
  [
    '항목에 islandId 가 없음',
    { bucketStart: 'b', nextRefreshMinutes: 5, items: [wireItem({ islandId: 1 })] },
  ],
  [
    '항목의 항해 시간이 없음',
    { bucketStart: 'b', nextRefreshMinutes: 5, items: [wireItem({ sailingMinutes: undefined })] },
  ],
])(
  'getTelescope — 계약과 다른 응답(%s)은 CLIENT_CONTRACT_ERROR 로 실패한다',
  async (_name, data) => {
    stub([{ status: 200, body: { data } }]);
    await assert.rejects(getTelescope(), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, 'CLIENT_CONTRACT_ERROR');
      return true;
    });
  },
);

test('arriveAtIsland — POST /islands/{id}/arrivals 는 본문 없이 Idempotency-Key 를 싣고(재시도는 같은 키) 응답을 그대로 돌려준다', async () => {
  const data = {
    islandId: 'i 1',
    arrivedBefore: true,
    membershipStatus: 'active',
    currentIslandId: 'i 1',
  };
  stub([
    { status: 200, body: { data } },
    { status: 200, body: { data } },
  ]);
  const result = await arriveAtIsland('i 1', 'idem-arrive');
  const retry = await arriveAtIsland('i 1', 'idem-arrive'); // 응답 유실 재시도 — 같은 키(switchCurrentIsland 와 같다)
  assert.equal(path(calls[0]), '/islands/i%201/arrivals');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-arrive');
  assert.equal(header(calls[1], 'Idempotency-Key'), 'idem-arrive');
  assert.equal(header(calls[0], 'Authorization'), 'Bearer AT');
  assert.deepEqual(result, data);
  assert.deepEqual(retry, data);
});

test('arriveAtIsland — 의도마다 다른 키는 다른 헤더로 나간다', async () => {
  stub([{ status: 200, body: { data: { membershipStatus: 'none' } } }]);
  await arriveAtIsland('a', 'idem-a');
  await arriveAtIsland('b', 'idem-b');
  assert.equal(header(calls[0], 'Idempotency-Key'), 'idem-a');
  assert.equal(header(calls[1], 'Idempotency-Key'), 'idem-b');
});

test('arriveAtIsland — 서버 거절 코드는 그대로 오류로 올라간다', async () => {
  stub([
    {
      status: 404,
      body: {
        error: { code: 'NOT_FOUND', message: '없는 섬이에요', field: null, retryable: false },
      },
    },
  ]);
  await assert.rejects(arriveAtIsland('gone', 'idem-gone'), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.code, 'NOT_FOUND');
    assert.equal(e.status, 404);
    return true;
  });
});

test('pinToTelescope — POST /me/telescope/pins 에 {islandId, source} 를 싣고(멱등 키 없음) item·evicted 를 그대로 돌려준다', async () => {
  const data = {
    item: wireItem({
      islandId: 'i 1',
      slot: 'pinned',
      pinnedFrom: 'observatory',
      pinnedAt: '2026-10-12T05:10:00Z',
    }),
    evicted: { islandId: 'old', name: '옛섬' },
  };
  stub([{ status: 201, body: { data } }]);
  const result = await pinToTelescope('i 1', 'observatory');
  assert.equal(path(calls[0]), '/me/telescope/pins');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    islandId: 'i 1',
    source: 'observatory',
  });
  assert.equal(header(calls[0], 'Authorization'), 'Bearer AT');
  assert.equal(header(calls[0], 'Idempotency-Key'), undefined);
  assert.deepEqual(result, data);
});

test('pinToTelescope — 빠진 섬이 없으면 evicted 는 null 이고, 이미 넣은 섬(200)도 같은 모양이다', async () => {
  const data = { item: wireItem({ slot: 'pinned', pinnedFrom: 'magazine' }), evicted: null };
  stub([{ status: 200, body: { data } }]);
  const result = await pinToTelescope('i1', 'magazine');
  assert.equal(JSON.parse(String(calls[0].init.body)).source, 'magazine');
  assert.equal(result.evicted, null);
  assert.equal(result.item.pinnedFrom, 'magazine');
});

test.each([
  [404, 'GROUP_NOT_FOUND'],
  [403, 'FORBIDDEN'],
  [409, 'STATE_CONFLICT'],
])('pinToTelescope — 서버 거절(%s %s)은 공개 코드 그대로 오류로 올라간다', async (status, code) => {
  stub([
    {
      status,
      body: { error: { code, message: '넣을 수 없어요', field: 'islandId', retryable: false } },
    },
  ]);
  await assert.rejects(pinToTelescope('gone', 'observatory'), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.code, code);
    assert.equal(e.status, status);
    assert.equal(e.field, 'islandId');
    return true;
  });
});

test('unpinFromTelescope — DELETE /me/telescope/pins/{id} 를 본문·멱등 키 없이 보내고 {deleted:true} 를 그대로 돌려준다(이미 없는 섬도 200)', async () => {
  stub([
    { status: 200, body: { data: { deleted: true } } },
    { status: 200, body: { data: { deleted: true } } },
  ]);
  const result = await unpinFromTelescope('i 1');
  const retry = await unpinFromTelescope('i 1'); // 응답 유실 재시도·이미 뺀 섬 — 같은 200
  assert.equal(path(calls[0]), '/me/telescope/pins/i%201');
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(header(calls[0], 'Authorization'), 'Bearer AT');
  assert.equal(header(calls[0], 'Idempotency-Key'), undefined);
  assert.deepEqual(result, { deleted: true });
  assert.deepEqual(retry, { deleted: true });
});

test('unpinFromTelescope — 서버 거절 코드는 그대로 오류로 올라간다', async () => {
  stub([
    {
      status: 503,
      body: {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: '잠시 뒤 다시 시도해 주세요',
          field: null,
          retryable: true,
        },
      },
    },
  ]);
  await assert.rejects(unpinFromTelescope('i1'), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.code, 'SERVICE_UNAVAILABLE');
    assert.equal(e.status, 503);
    return true;
  });
});
