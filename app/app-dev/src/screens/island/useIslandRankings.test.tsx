/**
 * useIslandRankings (GROMO-2018) — UTC 일요일 week 로 서버 랭킹을 읽어
 * rank(동점 공동)·myRank 를 그대로 보존하고, empty/error/retry 를 구분한다.
 */
import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiError } from '@/services/api/client';
import { getIslandRankings, utcWeekStart } from '@/services/api/rankings';
import { sessionGeneration } from '@/services/api/session';
import type { IslandRankings } from '@/services/api/rankings';
import { useIslandRankings } from '@/screens/island/useIslandRankings';

jest.mock('@/services/api/rankings', () => ({
  ...jest.requireActual('@/services/api/rankings'),
  getIslandRankings: jest.fn(),
}));
jest.mock('@/services/api/session', () => ({
  ...jest.requireActual('@/services/api/session'),
  sessionGeneration: jest.fn(),
}));

const rankingsMock = getIslandRankings as jest.Mock;
const sessionMock = sessionGeneration as jest.Mock;

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

beforeEach(() => {
  jest.clearAllMocks();
  sessionMock.mockReturnValue(1);
});

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

test('활성 상태에서 같은 주의 순위와 UTC 주 경계를 주기적으로 다시 조회한다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-27T23:59:30Z'));
  rankingsMock
    .mockResolvedValueOnce(rankings({ myRank: 7 }))
    .mockResolvedValueOnce(rankings({ myRank: 6 }))
    .mockRejectedValueOnce(
      new ApiError('CLIENT_NETWORK_ERROR', '네트워크 오류', 0, { retryable: true }),
    );
  try {
    const { result, unmount } = await renderHook(() => useIslandRankings({ active: true }));
    await act(async () => {});
    assert.equal(rankingsMock.mock.calls[0][0].week, '2026-09-27');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => assert.equal(result.current.data?.myRank, 6));
    assert.equal(rankingsMock.mock.calls[1][0].week, '2026-09-27');

    jest.setSystemTime(new Date('2026-10-04T00:00:01Z'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => assert.equal(rankingsMock.mock.calls.length, 3));
    await waitFor(() => assert.equal(result.current.status, 'error'));
    assert.equal(rankingsMock.mock.calls[2][0].week, '2026-10-04');
    assert.equal(result.current.week, '2026-10-04');
    assert.equal(result.current.data, null);
    unmount();
  } finally {
    jest.useRealTimers();
  }
});

test('주기 갱신 중에는 직전 ready 순위 데이터를 유지한다', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-28T12:00:00Z'));
  let finishRefresh: ((value: IslandRankings) => void) | undefined;
  rankingsMock.mockResolvedValueOnce(rankings({ myRank: 7 })).mockImplementationOnce(
    () =>
      new Promise<IslandRankings>((resolve) => {
        finishRefresh = resolve;
      }),
  );
  try {
    const { result, unmount } = await renderHook(() => useIslandRankings({ active: true }));
    await waitFor(() => assert.equal(result.current.status, 'ready'));
    assert.equal(result.current.data?.myRank, 7);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    assert.equal(result.current.status, 'ready');
    assert.equal(result.current.data?.myRank, 7);

    await act(async () => {
      finishRefresh?.(rankings({ myRank: 6 }));
    });
    await waitFor(() => assert.equal(result.current.data?.myRank, 6));
    assert.equal(result.current.status, 'ready');
    unmount();
  } finally {
    jest.useRealTimers();
  }
});

test('세션 교체 시 이전 계정의 순위를 비우고 새 계정 결과를 기다린다', async () => {
  let finishRefresh: ((value: IslandRankings) => void) | undefined;
  rankingsMock.mockResolvedValueOnce(rankings({ myRank: 7 })).mockImplementationOnce(
    () =>
      new Promise<IslandRankings>((resolve) => {
        finishRefresh = resolve;
      }),
  );
  const { result, rerender, unmount } = await renderHook(() => useIslandRankings({ active: true }));
  await waitFor(() => assert.equal(result.current.status, 'ready'));
  assert.equal(result.current.data?.myRank, 7);

  sessionMock.mockReturnValue(2);
  await act(async () => rerender(undefined));
  assert.equal(result.current.status, 'loading');
  assert.equal(result.current.data, null);

  await act(async () => {
    finishRefresh?.(rankings({ myRank: 4 }));
  });
  await waitFor(() => assert.equal(result.current.data?.myRank, 4));
  assert.equal(result.current.status, 'ready');
  unmount();
});
