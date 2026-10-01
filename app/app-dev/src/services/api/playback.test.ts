import assert from 'node:assert/strict';
import { API_URL } from '@/services/api/client';
import { clearSession, saveSession } from '@/services/api/session';
import { getPlayback, patchPlayback } from '@/services/api/playback';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
const ISLAND = '11111111-2222-4333-8444-555555555555';
const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function stub(body: unknown) {
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ data: body }),
    } as unknown as Response;
  });
}

beforeEach(async () => {
  calls.length = 0;
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'u1' });
});

test('재생 조회와 변경은 섬 playback 경로와 현재 버전·멱등 키를 그대로 쓴다', async () => {
  const playback = {
    trackId: 'rain',
    playing: true,
    positionSeconds: 0,
    effectiveAt: '2026-09-22T00:00:00Z',
    changedBy: 'u1',
    version: 4,
    serverNow: '2026-09-22T00:00:00Z',
    durationSeconds: 120,
  };
  stub(playback);

  assert.deepEqual(await getPlayback(ISLAND), playback);
  assert.equal(calls[0].url, `${API_URL}/islands/${ISLAND}/playback`);
  assert.equal(calls[0].init.method, 'GET');

  await patchPlayback(ISLAND, { trackId: 'rain', playing: true, expectedVersion: 3 }, KEY);
  assert.equal(calls[1].url, `${API_URL}/islands/${ISLAND}/playback`);
  assert.equal(calls[1].init.method, 'PATCH');
  assert.equal((calls[1].init.headers as Record<string, string>)['Idempotency-Key'], KEY);
  assert.deepEqual(JSON.parse(calls[1].init.body as string), {
    trackId: 'rain',
    playing: true,
    expectedVersion: 3,
  });
});
