/**
 * useIslandRankings (GROMO-2018) — UTC 일요일 week 로 서버 랭킹을 읽어
 * rank(동점 공동)·myRank 를 그대로 보존하고, empty/error/retry 를 구분한다.
 */
import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import { getIslandRankings, utcWeekStart } from '@/services/api/rankings';
import type { IslandRankings } from '@/services/api/rankings';
import { useIslandRankings } from '@/screens/island/useIslandRankings';

jest.mock('@/services/api/rankings', () => ({
  ...jest.requireActual('@/services/api/rankings'),
  getIslandRankings: jest.fn(),
}));

const rankingsMock = getIslandRankings as jest.Mock;

const rankings = (over: Partial<IslandRankings> = {}): IslandRankings => ({
  items: [
    { rank: 1, islandId: 'a', name: '딸기소다', averageFocusSeconds: 7200 },
    { rank: 1, islandId: 'b', name: '소금빵', averageFocusSeconds: 7200 },
    { rank: 3, islandId: 'c', name: '메로나', averageFocusSeconds: 3600 },
  ],
  myRank: 7,
  nextCursor: null,
  asOf: '2026-09-24T12:00:00Z',
  ...over,
});

beforeEach(() => jest.clearAllMocks());

test('비활성이면 조회하지 않는다', async () => {
  const { result } = await renderHook(() => useIslandRankings({ active: false }));
  assert.equal(result.current.status, 'loading');
  assert.equal(rankingsMock.mock.calls.length, 0);
});

test('이번 UTC 일요일 week 로 조회하고 동점 순위·myRank 를 그대로 돌려준다', async () => {
  rankingsMock.mockResolvedValue(rankings());
  const { result } = await renderHook(() => useIslandRankings({ active: true }));

  await waitFor(() => assert.equal(result.current.status, 'ready'));
  const week = rankingsMock.mock.calls[0][0].week as string;
  assert.equal(week, utcWeekStart());
  // week 는 반드시 UTC 일요일이다
  assert.equal(new Date(week + 'T00:00:00Z').getUTCDay(), 0);
  assert.deepEqual(
    result.current.data?.items.map((i) => i.rank),
    [1, 1, 3],
  );
  assert.equal(result.current.data?.myRank, 7);
});

test('items 가 비면 ready+빈 목록 — 오류로 접지 않는다', async () => {
  rankingsMock.mockResolvedValue(rankings({ items: [], myRank: null }));
  const { result } = await renderHook(() => useIslandRankings({ active: true }));

  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(result.current.data?.items.length, 0);
  assert.equal(result.current.data?.myRank, null);
});

test('API 오류는 error 상태로 두고 retry 가 같은 week 로 다시 읽는다', async () => {
  rankingsMock
    .mockRejectedValueOnce(
      new ApiError('CLIENT_NETWORK_ERROR', '네트워크 오류', 0, { retryable: true }),
    )
    .mockResolvedValueOnce(rankings({ items: [] }));
  const { result } = await renderHook(() => useIslandRankings({ active: true }));

  await waitFor(() => assert.equal(result.current.status, 'error'));
  assert.equal(result.current.error?.code, 'CLIENT_NETWORK_ERROR');

  await act(async () => result.current.retry());
  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(rankingsMock.mock.calls.length, 2);
  assert.equal(rankingsMock.mock.calls[1][0].week, utcWeekStart());
});

test('활성 상태에서 UTC 주 경계를 지나면 새 주 랭킹을 다시 조회한다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-27T23:59:30Z'));
  rankingsMock.mockResolvedValue(rankings());
  try {
    const { result, unmount } = await renderHook(() => useIslandRankings({ active: true }));
    await act(async () => {});
    assert.equal(rankingsMock.mock.calls[0][0].week, '2026-09-27');

    jest.setSystemTime(new Date('2026-10-04T00:00:01Z'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => assert.equal(rankingsMock.mock.calls.length, 2));
    assert.equal(rankingsMock.mock.calls[1][0].week, '2026-10-04');
    unmount();
  } finally {
    jest.useRealTimers();
  }
});
