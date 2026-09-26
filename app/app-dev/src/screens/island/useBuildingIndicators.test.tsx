import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  fetchBoardSnapshot,
  fetchBoardPollPage,
  fetchLibrarySnapshot,
  fetchLibraryQuestOccurrenceIds,
  fetchMailboxUnreadLetterIds,
  fetchMailboxPollPage,
  loadBoardSeen,
  loadLibrarySeen,
  saveBoardSeen,
  saveLibrarySeen,
} from '@/services/buildingIndicators';
import { clearSession, saveSession } from '@/services/api/session';
import { ApiError } from '@/services/api/client';
import { useBuildingIndicators as useBuildingIndicatorsHook } from './useBuildingIndicators';
import type { LibraryScreen } from '@/services/api/records';

jest.mock('@/services/buildingIndicators', () => ({
  ...jest.requireActual('@/services/buildingIndicators'),
  fetchBoardSnapshot: jest.fn(),
  fetchBoardPollPage: jest.fn(),
  fetchLibrarySnapshot: jest.fn(),
  fetchLibraryQuestOccurrenceIds: jest.fn(),
  fetchMailboxUnreadLetterIds: jest.fn(),
  fetchMailboxPollPage: jest.fn(),
  loadBoardSeen: jest.fn(),
  loadLibrarySeen: jest.fn(),
  saveBoardSeen: jest.fn(),
  saveLibrarySeen: jest.fn(),
}));

const boardNow = fetchBoardSnapshot as jest.Mock;
const boardPoll = fetchBoardPollPage as jest.Mock;
const libraryNow = fetchLibrarySnapshot as jest.Mock;
const libraryQuestNow = fetchLibraryQuestOccurrenceIds as jest.Mock;
const mailboxNow = fetchMailboxUnreadLetterIds as jest.Mock;
const mailboxPoll = fetchMailboxPollPage as jest.Mock;
const boardSeen = loadBoardSeen as jest.Mock;
const librarySeen = loadLibrarySeen as jest.Mock;
const saveBoard = saveBoardSeen as jest.Mock;
const saveLibrary = saveLibrarySeen as jest.Mock;
const useBuildingIndicators = (
  options: Omit<Parameters<typeof useBuildingIndicatorsHook>[0], 'completedBuildings'> & {
    completedBuildings?: readonly string[] | null;
  },
) =>
  useBuildingIndicatorsHook({
    ...options,
    completedBuildings:
      'completedBuildings' in options ? options.completedBuildings! : ['board', 'mail', 'library'],
  });
const displayedLibraryScreen: LibraryScreen = {
  island: { id: 'island-1', name: '섬', role: 'host' },
  statisticsAvailability: 'available',
  focusStatistics: {
    scope: 'me',
    totalSeconds: 1,
    series: [],
    records: [],
    nextCursor: null,
    asOf: '2026-09-27T12:00:00Z',
  },
  screenTimeStatistics: {
    scope: 'me',
    measurementStatus: 'authorized',
    totalMinutes: 0,
    series: [],
    updatedAt: null,
  },
  fishEarnings: { members: [] },
};

beforeEach(async () => {
  jest.clearAllMocks();
  await clearSession();
  await saveSession({ accessToken: 'AT', refreshToken: 'RT', userId: 'user-1' });
  boardNow.mockResolvedValue({ notice: 2 });
  boardPoll.mockResolvedValue({
    snapshot: { notice: 2 },
    latestSnapshot: { notice: 2 },
    historySnapshot: {},
    firstHistoryCursor: null,
    historyPageKey: null,
    nextCursor: null,
  });
  libraryNow.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'new',
    fishEarnings: { user: 2 },
  });
  mailboxNow.mockResolvedValue([]);
  mailboxPoll.mockResolvedValue({
    latestUnread: false,
    historyUnread: false,
    latestItems: [],
    historyItems: [],
    firstHistoryCursor: null,
    cycleComplete: true,
    nextCursor: null,
  });
  boardSeen.mockResolvedValue({ notice: 2 });
  librarySeen.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'new',
    fishEarnings: { user: 2 },
    questOccurrenceIds: [],
  });
  libraryQuestNow.mockResolvedValue([]);
  saveBoard.mockResolvedValue(undefined);
  saveLibrary.mockResolvedValue(undefined);
});

test('홈이 아니거나 서버 섬이 없으면 배지 API를 호출하지 않는다', async () => {
  await renderHook(() =>
    useBuildingIndicators({ active: false, islandId: null, onHome: false, refreshKey: 0 }),
  );
  assert.equal(boardNow.mock.calls.length, 0);
  assert.equal(libraryNow.mock.calls.length, 0);
  assert.equal(mailboxNow.mock.calls.length, 0);
});

test('완공 목록이 없거나 시설이 미완공이면 해당 시설 폴링을 건너뛴다', async () => {
  const { result, rerender } = await renderHook(
    (props: { completedBuildings: readonly string[] | null }) =>
      useBuildingIndicatorsHook({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: 0,
        completedBuildings: props.completedBuildings,
      }),
    { initialProps: { completedBuildings: null } },
  );
  await act(async () => {});
  expect(boardNow).not.toHaveBeenCalled();
  expect(libraryNow).not.toHaveBeenCalled();
  expect(mailboxNow).not.toHaveBeenCalled();

  await rerender({ completedBuildings: ['hall', 'shop'] });
  await act(async () => {});
  expect(boardNow).not.toHaveBeenCalled();
  expect(libraryNow).not.toHaveBeenCalled();
  expect(mailboxNow).not.toHaveBeenCalled();
  expect(result.current).toEqual(
    expect.objectContaining({
      boardStatus: null,
      libraryState: 'normal',
      showMailboxLetters: false,
    }),
  );

  await rerender({ completedBuildings: ['library'] });
  await waitFor(() => expect(libraryNow).toHaveBeenCalledTimes(1));
  expect(boardNow).not.toHaveBeenCalled();
  expect(mailboxNow).not.toHaveBeenCalled();
});

test('저장된 확인 상태와 서버 현재 값을 비교해 세 배지를 계산한다', async () => {
  boardSeen.mockResolvedValue({ notice: 1 });
  librarySeen.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'old',
    fishEarnings: { user: 2 },
  });
  mailboxNow.mockResolvedValue(['letter-1', 'letter-2']);
  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );

  await waitFor(() => assert.equal(result.current.showMailboxLetters, true));
  assert.equal(result.current.boardStatus, 'new-comment');
  assert.equal(result.current.libraryState, 'new-reading');
});

test('같은 일일 퀘스트의 새 회차는 도서관 알림으로 표시하고 확인 시 회차 기준점을 저장한다', async () => {
  librarySeen.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'new',
    fishEarnings: { user: 2 },
    questOccurrenceIds: ['daily-quest:2026-09-26'],
  });
  libraryQuestNow.mockResolvedValue(['daily-quest:2026-09-27']);
  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );

  await waitFor(() => assert.equal(result.current.libraryState, 'new-quest'));
  await act(async () => result.current.markLibrarySeen(displayedLibraryScreen));
  expect(saveLibrary).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ questOccurrenceIds: ['daily-quest:2026-09-27'] }),
  );
  assert.equal(result.current.libraryState, 'normal');
});

test('이전 정의 ID 기준점은 현재 회차 기준점으로 한 번 이전해 거짓 배지를 막는다', async () => {
  librarySeen.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'new',
    fishEarnings: { user: 2 },
    questIds: ['daily-quest'],
  });
  libraryQuestNow.mockResolvedValue(['daily-quest:2026-09-27']);
  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );

  await waitFor(() =>
    expect(saveLibrary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ questOccurrenceIds: ['daily-quest:2026-09-27'] }),
    ),
  );
  assert.equal(result.current.libraryState, 'normal');
});

test('퀘스트 서버 조회 실패 시 도서관 진입으로 새 퀘스트 알림을 지우지 않는다', async () => {
  librarySeen.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'new',
    fishEarnings: { user: 2 },
    questOccurrenceIds: [],
  });
  libraryQuestNow.mockResolvedValue(['quest-1']);
  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );
  await waitFor(() => assert.equal(result.current.libraryState, 'new-quest'));

  libraryQuestNow.mockRejectedValue(new Error('offline'));
  await act(async () => result.current.markLibrarySeen(displayedLibraryScreen));
  assert.equal(result.current.libraryState, 'new-quest');
});

test('퀘스트 API가 일시 실패하면 홈 폴링도 마지막 새 퀘스트 알림을 보존한다', async () => {
  librarySeen.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'new',
    fishEarnings: { user: 2 },
    questOccurrenceIds: [],
  });
  libraryQuestNow.mockResolvedValue(['quest-1']);
  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );
  await waitFor(() => assert.equal(hook.result.current.libraryState, 'new-quest'));

  libraryQuestNow.mockRejectedValue(new Error('offline'));
  await hook.rerender({ refreshKey: 1 });
  await waitFor(() => assert.equal(libraryQuestNow.mock.calls.length, 2));
  assert.equal(hook.result.current.libraryState, 'new-quest');
  hook.unmount();
});

test('과거 공지 페이지에서 발견한 새 댓글은 전체 관측 snapshot에 병합된다', async () => {
  boardNow.mockResolvedValue({ old: 2, latest: 0 });
  boardSeen.mockResolvedValue({ old: 2, latest: 0 });
  boardPoll.mockResolvedValue({
    snapshot: { old: 3 },
    latestSnapshot: {},
    historySnapshot: { old: 3 },
    historyPageKey: 'older-1',
    nextCursor: 'older-2',
  });
  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );

  await waitFor(() => assert.equal(boardNow.mock.calls.length, 1));
  await hook.rerender({ refreshKey: 1 });
  await waitFor(() => assert.equal(hook.result.current.boardStatus, 'new-comment'));
  expect(boardPoll).toHaveBeenCalledWith('island-1', null, expect.any(Function));
  hook.unmount();
});

test('최신 페이지에서 과거로 밀린 공지는 이력에서 재관측될 때까지 댓글 배지에 남긴다', async () => {
  boardSeen.mockResolvedValue({ shifted: 2, stable: 0, older: 0 });
  boardNow.mockImplementation(async (_islandId, _alive, onPages) => {
    onPages([
      { key: 'latest', snapshot: { shifted: 3, stable: 0 } },
      { key: 'history-1', snapshot: { older: 0 } },
    ]);
    return { shifted: 3, stable: 0, older: 0 };
  });
  boardPoll.mockResolvedValue({
    snapshot: { older: 0 },
    latestSnapshot: { stable: 0 },
    historySnapshot: { older: 0 },
    historyPageKey: 'history-1',
    cycleComplete: false,
    nextCursor: 'history-2',
  });
  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );

  await waitFor(() => assert.equal(boardNow.mock.calls.length, 1));
  await hook.rerender({ refreshKey: 1 });
  await waitFor(() => assert.equal(boardPoll.mock.calls.length, 1));
  await waitFor(() => assert.equal(hook.result.current.boardStatus, 'new-comment'));
  hook.unmount();
});

test('최신 공지 경계가 바뀌면 새 첫 이력 커서 순환을 완주한 뒤 stale 공지를 prune한다', async () => {
  boardSeen.mockResolvedValue({ latestOld: 0, latestNew: 0, stale: 1, firstPageNotice: 0 });
  boardNow.mockImplementation(async (_islandId, _alive, onPages) => {
    onPages([
      { key: 'latest', snapshot: { latestOld: 0 } },
      { key: 'old-first-cursor', snapshot: { stale: 2 } },
      { key: 'old-second-cursor', snapshot: {} },
    ]);
    return { latestOld: 0, stale: 2 };
  });
  boardPoll
    .mockResolvedValueOnce({
      snapshot: { latestNew: 0 },
      latestSnapshot: { latestNew: 0 },
      historySnapshot: {},
      firstHistoryCursor: 'new-first-cursor',
      historyPageKey: 'old-cursor-from-inflight-cycle',
      cycleComplete: false,
      nextCursor: 'old-next-cursor',
    })
    .mockResolvedValueOnce({
      snapshot: { latestNew: 0 },
      latestSnapshot: { latestNew: 0 },
      historySnapshot: { firstPageNotice: 0 },
      firstHistoryCursor: 'renewed-first-cursor-token',
      historyPageKey: 'new-first-page-content',
      cycleComplete: false,
      nextCursor: 'new-second-cursor',
    })
    .mockResolvedValueOnce({
      snapshot: { latestNew: 0 },
      latestSnapshot: { latestNew: 0 },
      historySnapshot: {},
      firstHistoryCursor: 'another-renewed-token',
      historyPageKey: 'new-second-page-content',
      cycleComplete: true,
      nextCursor: 'new-first-cursor',
    });
  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );
  await waitFor(() => assert.equal(hook.result.current.boardStatus, 'new-comment'));

  await hook.rerender({ refreshKey: 1 });
  await waitFor(() => assert.equal(boardPoll.mock.calls.length, 1));
  expect(hook.result.current.boardStatus).toBe('new-comment');
  await hook.rerender({ refreshKey: 2 });
  await waitFor(() => assert.equal(boardPoll.mock.calls.length, 2));
  expect(boardPoll.mock.calls[1][1]).toBe('new-first-cursor');
  expect(hook.result.current.boardStatus).toBe('new-comment');
  await hook.rerender({ refreshKey: 3 });
  await waitFor(() => assert.equal(boardPoll.mock.calls.length, 3));
  expect(boardPoll.mock.calls[2][1]).toBe('new-second-cursor');
  await waitFor(() => assert.equal(hook.result.current.boardStatus, null));
  hook.unmount();
});

test.each(['INVALID_CURSOR', 'CURSOR_EXPIRED'] as const)(
  '게시판 순환 커서 %s가 무효화되면 기존 순환을 폐기하고 새 첫 이력 커서부터 재개한다',
  async (code) => {
    boardNow.mockImplementation(async (_islandId, _alive, onPages) => {
      onPages([
        { key: 'latest', snapshot: { latest: 0 } },
        { key: 'fresh-first-history', snapshot: { old: 2 } },
      ]);
      return { latest: 0, old: 2 };
    });
    boardPoll.mockRejectedValueOnce(
      new ApiError(code, 'expired', code === 'CURSOR_EXPIRED' ? 409 : 400),
    );
    const hook = await renderHook(
      (props: { refreshKey: number }) =>
        useBuildingIndicators({
          active: true,
          islandId: 'island-1',
          onHome: true,
          refreshKey: props.refreshKey,
        }),
      { initialProps: { refreshKey: 0 } },
    );
    await waitFor(() => assert.equal(boardNow.mock.calls.length, 1));

    await hook.rerender({ refreshKey: 1 });
    await waitFor(() => assert.equal(boardNow.mock.calls.length, 2));
    expect(boardPoll).toHaveBeenNthCalledWith(1, 'island-1', null, expect.any(Function));

    await hook.rerender({ refreshKey: 2 });
    await waitFor(() => assert.equal(boardPoll.mock.calls.length, 2));
    expect(boardPoll).toHaveBeenNthCalledWith(
      2,
      'island-1',
      'fresh-first-history',
      expect.any(Function),
    );
    hook.unmount();
  },
);

test('완주한 게시판 페이지 순환은 삭제된 공지의 캐시 snapshot도 정리한다', async () => {
  boardSeen.mockResolvedValue({ stale: 1 });
  boardNow.mockImplementation(async (_islandId, _alive, onPages) => {
    onPages([
      { key: 'latest', snapshot: {} },
      { key: 'cursor-1', snapshot: {} },
      { key: 'orphaned-cursor', snapshot: { stale: 2 } },
    ]);
    return { stale: 2 };
  });
  boardPoll.mockResolvedValue({
    snapshot: {},
    latestSnapshot: {},
    historySnapshot: {},
    firstHistoryCursor: 'cursor-1',
    historyPageKey: 'cursor-1',
    cycleComplete: true,
    nextCursor: 'cursor-1',
  });
  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );
  await waitFor(() => assert.equal(hook.result.current.boardStatus, 'new-comment'));
  await hook.rerender({ refreshKey: 1 });
  await waitFor(() => assert.equal(boardPoll.mock.calls.length, 1));
  await waitFor(() => assert.equal(hook.result.current.boardStatus, null));
  hook.unmount();
});

test('첫 관측은 기준점으로 저장하고 과거 콘텐츠 배지를 만들지 않는다', async () => {
  boardSeen.mockResolvedValue(null);
  librarySeen.mockResolvedValue(null);
  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );

  await waitFor(() => assert.equal(saveBoard.mock.calls.length, 1));
  await waitFor(() => assert.equal(saveLibrary.mock.calls.length, 1));
  assert.equal(result.current.boardStatus, null);
  assert.equal(result.current.libraryState, 'normal');
  assert.equal(
    JSON.stringify(saveBoard.mock.calls[0]),
    JSON.stringify([{ userId: 'user-1', islandId: 'island-1' }, { notice: 2 }]),
  );
});

test('주가 바뀌어도 미확인 누적 어획 증가는 읽음 기준에 덮어쓰지 않는다', async () => {
  libraryNow.mockResolvedValue({
    periodKey: '2026-09-27',
    weeklyFingerprint: 'new-week',
    fishEarnings: { user: 3 },
  });
  librarySeen.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'old-week',
    fishEarnings: { user: 2 },
  });

  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );

  await waitFor(() => assert.equal(result.current.libraryState, 'new-reading'));
  assert.equal(
    JSON.stringify(saveLibrary.mock.calls[0]),
    JSON.stringify([
      { userId: 'user-1', islandId: 'island-1' },
      {
        periodKey: '2026-09-27',
        weeklyFingerprint: 'new-week',
        fishEarnings: { user: 2 },
      },
    ]),
  );
});

test('새 주 첫 응답에 사용 기록이 있으면 도서관 확인 전까지 읽음 기준과 알림을 유지한다', async () => {
  const newWeek = {
    periodKey: '2026-09-27',
    weeklyFingerprint: JSON.stringify({
      focus: { totalSeconds: 600, series: [{ date: '2026-09-27', seconds: 600 }] },
      usage: { totalMinutes: 0, series: [] },
    }),
    fishEarnings: { user: 2 },
  };
  const oldSeen = {
    periodKey: '2026-09-20',
    weeklyFingerprint: JSON.stringify({
      focus: { totalSeconds: 0, series: [] },
      usage: { totalMinutes: 0, series: [] },
    }),
    fishEarnings: { user: 2 },
    questOccurrenceIds: [],
  };
  libraryNow.mockResolvedValue(newWeek);
  librarySeen.mockResolvedValue(oldSeen);

  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );
  await waitFor(() => assert.equal(hook.result.current.libraryState, 'new-reading'));
  expect(saveLibrary).not.toHaveBeenCalled();

  await hook.rerender({ refreshKey: 1 });
  await waitFor(() => assert.equal(libraryNow.mock.calls.length, 2));
  assert.equal(hook.result.current.libraryState, 'new-reading');
  expect(saveLibrary).not.toHaveBeenCalled();

  await act(async () => hook.result.current.markLibrarySeen(displayedLibraryScreen));
  assert.equal(hook.result.current.libraryState, 'normal');
  assert.equal(saveLibrary.mock.calls.at(-1)?.[1].periodKey, '2026-09-27');
  hook.unmount();
});

test('사용 기록이 전혀 없는 새 주에만 도서관 읽음 기준을 자동으로 넘긴다', async () => {
  const emptyWeek = {
    periodKey: '2026-09-27',
    weeklyFingerprint: JSON.stringify({
      focus: { totalSeconds: 0, series: [] },
      usage: { totalMinutes: 0, series: [] },
    }),
    fishEarnings: { user: 2 },
  };
  libraryNow.mockResolvedValue(emptyWeek);
  librarySeen.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'previous-week',
    fishEarnings: { user: 2 },
    questOccurrenceIds: [],
  });

  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );
  await waitFor(() => assert.equal(saveLibrary.mock.calls.length, 1));
  assert.equal(result.current.libraryState, 'normal');
  assert.equal(saveLibrary.mock.calls[0][1].periodKey, '2026-09-27');
});

test('게시판에서 실제로 불러온 페이지만 기존 확인 상태에 병합한다', async () => {
  boardNow.mockResolvedValue({ old: 2, fresh: 0 });
  boardSeen.mockResolvedValue({ old: 1 });
  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );
  await waitFor(() => assert.equal(result.current.boardStatus, 'unread'));

  await act(async () => {
    await result.current.markBoardSeen({
      islandId: 'island-1',
      items: [{ id: 'fresh', title: '새 공지', commentCount: 0 }],
      nextCursor: null,
    });
  });

  assert.equal(
    JSON.stringify(saveBoard.mock.calls.at(-1)),
    JSON.stringify([
      { userId: 'user-1', islandId: 'island-1' },
      { old: 1, fresh: 0 },
    ]),
  );
  assert.equal(result.current.boardStatus, 'new-comment');
});

test('일부만 로드한 상세 댓글은 더 높은 기존 확인 기준을 낮추지 않는다', async () => {
  boardNow.mockResolvedValue({ n1: 110 });
  boardSeen.mockResolvedValue({ n1: 100 });
  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );
  await waitFor(() => assert.equal(result.current.boardStatus, 'new-comment'));

  await act(async () => {
    await result.current.markBoardSeen({
      islandId: 'island-1',
      items: [{ id: 'n1', title: '오래된 공지', commentCount: 30 }],
      nextCursor: null,
      preserveHigherCommentCounts: true,
    });
  });

  assert.deepEqual(saveBoard.mock.calls.at(-1)?.[1], { n1: 100 });
  assert.equal(result.current.boardStatus, 'new-comment');
});

test('홈 기준점 저장이 게시판에서 방금 확인한 페이지를 덮어쓰지 않는다', async () => {
  let releaseHome!: (value: Record<string, number>) => void;
  boardNow.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseHome = resolve;
      }),
  );
  let persisted: Record<string, number> | null = null;
  boardSeen.mockImplementation(async () => persisted);
  saveBoard.mockImplementation(async (_scope, value) => {
    persisted = value;
  });

  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );
  await act(async () => {
    await result.current.markBoardSeen({
      islandId: 'island-1',
      items: [{ id: 'page-only', title: '읽은 페이지', commentCount: 0 }],
      nextCursor: null,
    });
  });
  releaseHome({ latest: 3 });
  await waitFor(() => assert.deepEqual(persisted, { 'page-only': 0 }));
  assert.deepEqual(persisted, { 'page-only': 0 });
});

test('게시판 페이지 확인이 겹쳐도 늦게 끝난 이전 저장이 최신 범위를 덮지 않는다', async () => {
  let persisted: Record<string, number> | null = null;
  let releaseFirst!: () => void;
  const firstSave = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  boardSeen.mockImplementation(async () => persisted);
  saveBoard.mockImplementation(async (_scope, value) => {
    if (saveBoard.mock.calls.length === 1) await firstSave;
    persisted = value;
  });

  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: false, refreshKey: 0 }),
  );
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = result.current.markBoardSeen({
      islandId: 'island-1',
      items: [{ id: 'first', title: '첫 페이지', commentCount: 0 }],
      nextCursor: 'next',
    });
    second = result.current.markBoardSeen({
      islandId: 'island-1',
      items: [{ id: 'second', title: '두 번째 페이지', commentCount: 0 }],
      nextCursor: null,
    });
    await waitFor(() => assert.equal(saveBoard.mock.calls.length, 1));
    releaseFirst();
    await Promise.all([first, second]);
  });

  assert.deepEqual(persisted, { first: 0, second: 0 });
});

test('도서관 확인은 전체 기록 조회와 저장이 모두 성공한 뒤 배지를 내린다', async () => {
  librarySeen.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'old',
    fishEarnings: { user: 2 },
    questOccurrenceIds: [],
  });
  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );
  await waitFor(() => assert.equal(result.current.libraryState, 'new-reading'));

  await act(async () => {
    await result.current.markLibrarySeen(displayedLibraryScreen);
  });
  assert.equal(saveLibrary.mock.calls.length, 1);
  assert.equal(libraryNow.mock.calls.at(-1)?.[3], displayedLibraryScreen);
  assert.equal(result.current.libraryState, 'normal');
});

test('늦게 끝난 홈 조회는 더 최신인 도서관 확인 기준점을 되돌리지 않는다', async () => {
  let releaseHome!: (value: {
    periodKey: string;
    weeklyFingerprint: string;
    fishEarnings: Record<string, number>;
  }) => void;
  const homeSnapshot = new Promise<{
    periodKey: string;
    weeklyFingerprint: string;
    fishEarnings: Record<string, number>;
  }>((resolve) => {
    releaseHome = resolve;
  });
  libraryNow.mockReturnValueOnce(homeSnapshot).mockResolvedValueOnce({
    periodKey: '2026-09-27',
    weeklyFingerprint: 'confirmed',
    fishEarnings: { user: 4 },
  });
  let persisted = {
    periodKey: '2026-09-20',
    weeklyFingerprint: 'old',
    fishEarnings: { user: 2 },
  };
  librarySeen.mockImplementation(async () => persisted);
  saveLibrary.mockImplementation(async (_scope, value) => {
    persisted = value;
  });

  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );
  await waitFor(() => assert.equal(libraryNow.mock.calls.length, 1));
  await act(async () => result.current.markLibrarySeen(displayedLibraryScreen));
  assert.equal(persisted.periodKey, '2026-09-27');
  assert.equal(persisted.weeklyFingerprint, 'confirmed');

  await act(async () => {
    releaseHome({
      periodKey: '2026-09-27',
      weeklyFingerprint: 'stale-home',
      fishEarnings: { user: 3 },
    });
    await homeSnapshot;
  });
  assert.equal(persisted.periodKey, '2026-09-27');
  assert.equal(persisted.weeklyFingerprint, 'confirmed');
  assert.deepEqual(persisted.fishEarnings, { user: 4 });
  assert.equal(result.current.libraryState, 'normal');
});

test('60초 폴링은 과거 페이지 하나만 순환하고 중복 조회를 막는다', async () => {
  jest.useFakeTimers();
  let release!: (value: Record<string, number>) => void;
  const pending = new Promise<Record<string, number>>((resolve) => {
    release = resolve;
  });
  boardNow.mockReturnValueOnce(pending).mockResolvedValue({ notice: 2 });
  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );
  await act(async () => Promise.resolve());
  assert.equal(boardNow.mock.calls.length, 1);
  assert.equal(libraryNow.mock.calls[0][4], false);

  await act(async () => {
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
  });
  assert.equal(boardNow.mock.calls.length, 1);

  release({ notice: 2 });
  jest.useRealTimers();
  await act(async () => {
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => {
    assert.equal(boardPoll.mock.calls.length, 1);
    assert.equal(libraryNow.mock.calls.length, 2);
  });
  assert.equal(boardPoll.mock.calls[0][1], null);
  assert.equal(libraryNow.mock.calls[1][4], true);
  hook.unmount();
});

test('과거 커서는 성공 응답에서만 전진하고 한 주기당 한 페이지 예산을 지킨다', async () => {
  jest.useFakeTimers();
  boardNow.mockResolvedValue({ latest: 0, old: 0 });
  boardPoll
    .mockResolvedValueOnce({
      snapshot: { latest: 0, old1: 2 },
      latestSnapshot: { latest: 0 },
      historySnapshot: { old1: 2 },
      historyPageKey: 'cursor-1',
      nextCursor: 'cursor-2',
    })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      snapshot: { latest: 0, old2: 3 },
      latestSnapshot: { latest: 0 },
      historySnapshot: { old2: 3 },
      historyPageKey: 'cursor-2',
      nextCursor: 'cursor-3',
    });
  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );
  await waitFor(() => assert.equal(boardNow.mock.calls.length, 1));

  await act(async () => {
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
  });
  await waitFor(() => assert.equal(boardPoll.mock.calls.length, 1));
  assert.equal(boardPoll.mock.calls[0][1], null);

  await act(async () => {
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
  });
  await waitFor(() => assert.equal(boardPoll.mock.calls.length, 2));
  assert.equal(boardPoll.mock.calls[1][1], 'cursor-2');

  await act(async () => {
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
  });
  await waitFor(() => assert.equal(boardPoll.mock.calls.length, 3));
  // 실패한 요청의 커서는 저장되지 않으므로 같은 페이지를 다시 요청한다.
  assert.equal(boardPoll.mock.calls[2][1], 'cursor-2');
  jest.useRealTimers();
  hook.unmount();
});

test('우체통 커서와 확인된 배지는 페이지 조회 실패 때 보존된다', async () => {
  jest.useFakeTimers();
  mailboxPoll
    .mockResolvedValueOnce({
      latestUnread: false,
      historyUnread: true,
      latestItems: [],
      historyItems: [{ id: 'unread-old', isRead: false }],
      historyPageKey: 'mail-cursor-1',
      cycleComplete: false,
      nextCursor: 'mail-cursor-2',
    })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      latestUnread: false,
      historyUnread: false,
      latestItems: [],
      historyItems: [{ id: 'unread-old', isRead: false }],
      historyPageKey: 'mail-cursor-2',
      cycleComplete: true,
      nextCursor: 'mail-cursor-1',
    })
    .mockResolvedValueOnce({
      latestUnread: false,
      historyUnread: false,
      latestItems: [],
      historyItems: [{ id: 'unread-old', isRead: true }],
      historyPageKey: 'mail-cursor-2',
      cycleComplete: true,
      nextCursor: 'mail-cursor-1',
    });
  const hook = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );
  await waitFor(() => assert.equal(mailboxNow.mock.calls.length, 1));

  const tick = async () => {
    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  await tick();
  await waitFor(() => assert.equal(hook.result.current.showMailboxLetters, true));
  expect(mailboxPoll.mock.calls[0][1]).toBeNull();
  await tick();
  expect(mailboxPoll.mock.calls[1][1]).toBe('mail-cursor-2');
  expect(hook.result.current.showMailboxLetters).toBe(true);
  await tick();
  expect(mailboxPoll.mock.calls[2][1]).toBe('mail-cursor-2');
  expect(hook.result.current.showMailboxLetters).toBe(true);
  await tick();
  expect(hook.result.current.showMailboxLetters).toBe(false);

  jest.useRealTimers();
  hook.unmount();
});

test('최신 페이지 경계에서 밀린 미확인 편지는 새 이력 순환 확인 전까지 보존한다', async () => {
  mailboxNow.mockImplementation(async (_islandId, _alive, onPages) => {
    onPages([
      { key: 'latest', ids: ['shifted-mail', 'stable-mail'] },
      { key: 'mail-cursor-1', ids: ['older-mail'] },
      { key: 'mail-cursor-2', ids: ['oldest-mail'] },
    ]);
    return ['shifted-mail'];
  });
  mailboxPoll
    .mockResolvedValueOnce({
      latestUnread: true,
      historyUnread: false,
      latestItems: [
        { id: 'shifted-mail', isRead: false },
        { id: 'stable-mail', isRead: true },
      ],
      historyItems: [],
      historyPageKey: 'mail-cursor-1',
      cycleComplete: false,
      nextCursor: 'mail-cursor-2',
    })
    .mockResolvedValueOnce({
      latestUnread: false,
      historyUnread: false,
      latestItems: [
        { id: 'new-mail', isRead: true },
        { id: 'stable-mail', isRead: true },
      ],
      historyItems: [{ id: 'older-mail', isRead: true }],
      historyPageKey: 'mail-cursor-2',
      cycleComplete: true,
      nextCursor: 'mail-cursor-1',
    })
    .mockResolvedValueOnce({
      latestUnread: false,
      historyUnread: true,
      latestItems: [
        { id: 'new-mail', isRead: true },
        { id: 'stable-mail', isRead: true },
      ],
      historyItems: [{ id: 'shifted-mail', isRead: false }],
      historyPageKey: 'mail-cursor-1',
      cycleComplete: false,
      nextCursor: 'mail-cursor-2',
    });
  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );
  await waitFor(() => assert.equal(mailboxNow.mock.calls.length, 1));

  await hook.rerender({ refreshKey: 1 });
  await waitFor(() => assert.equal(mailboxPoll.mock.calls.length, 1));
  await hook.rerender({ refreshKey: 2 });
  await waitFor(() => assert.equal(mailboxPoll.mock.calls.length, 2));
  assert.equal(hook.result.current.showMailboxLetters, true);
  await hook.rerender({ refreshKey: 3 });
  await waitFor(() => assert.equal(mailboxPoll.mock.calls.length, 3));
  assert.equal(hook.result.current.showMailboxLetters, true);
  hook.unmount();
});

test('마지막 미확인 편지의 성공한 열람은 즉시 배지를 내리고 늦은 폴링도 다시 띄우지 않는다', async () => {
  mailboxNow.mockResolvedValue(['last-unread']);
  mailboxPoll.mockResolvedValue({
    latestUnread: true,
    historyUnread: false,
    latestItems: [{ id: 'last-unread', isRead: false }],
    historyItems: [],
    cycleComplete: false,
    nextCursor: 'older',
  });
  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );
  await waitFor(() => assert.equal(hook.result.current.showMailboxLetters, true));

  await act(async () => {
    hook.result.current.markMailboxLetterRead('last-unread');
  });
  await waitFor(() => assert.equal(hook.result.current.showMailboxLetters, false));

  await hook.rerender({ refreshKey: 1 });
  await waitFor(() => assert.equal(mailboxPoll.mock.calls.length, 1));
  assert.equal(hook.result.current.showMailboxLetters, false);
  hook.unmount();
});

test('다른 기기에서 삭제된 미확인 편지는 우체통 순환 완료 때 배지 집합에서 제거한다', async () => {
  mailboxNow.mockResolvedValue(['deleted-unread']);
  mailboxPoll
    .mockResolvedValueOnce({
      latestUnread: false,
      historyUnread: false,
      latestItems: [],
      historyItems: [],
      historyPageKey: 'cursor-1',
      cycleComplete: false,
      nextCursor: 'cursor-2',
    })
    .mockResolvedValueOnce({
      latestUnread: false,
      historyUnread: false,
      latestItems: [],
      historyItems: [],
      historyPageKey: 'cursor-2',
      cycleComplete: true,
      nextCursor: 'cursor-1',
    });
  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );
  await waitFor(() => assert.equal(hook.result.current.showMailboxLetters, true));

  await hook.rerender({ refreshKey: 1 });
  await waitFor(() => assert.equal(mailboxPoll.mock.calls.length, 1));
  assert.equal(hook.result.current.showMailboxLetters, true);
  await hook.rerender({ refreshKey: 2 });
  await waitFor(() => assert.equal(mailboxPoll.mock.calls.length, 2));
  await waitFor(() => assert.equal(hook.result.current.showMailboxLetters, false));
  hook.unmount();
});

test('최신 페이지 경계가 바뀌면 새 첫 이력 커서 순환을 완주한 뒤 삭제 편지를 정리한다', async () => {
  mailboxNow.mockImplementation(async (_islandId, _alive, onPages) => {
    onPages([
      { key: 'latest', ids: [] },
      { key: 'old-first-cursor', ids: ['deleted-unread'] },
      { key: 'old-second-cursor', ids: [] },
    ]);
    return ['deleted-unread'];
  });
  mailboxPoll
    .mockResolvedValueOnce({
      latestUnread: false,
      historyUnread: false,
      latestItems: [{ id: 'new-letter', isRead: true }],
      historyItems: [],
      firstHistoryCursor: 'new-first-cursor',
      historyPageKey: 'new-first-cursor',
      cycleComplete: false,
      nextCursor: 'new-second-cursor',
    })
    .mockResolvedValueOnce({
      latestUnread: false,
      historyUnread: false,
      latestItems: [{ id: 'new-letter', isRead: true }],
      historyItems: [],
      firstHistoryCursor: 'new-first-cursor',
      historyPageKey: 'new-second-cursor',
      cycleComplete: true,
      nextCursor: 'new-first-cursor',
    });
  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );
  await waitFor(() => assert.equal(hook.result.current.showMailboxLetters, true));

  await hook.rerender({ refreshKey: 1 });
  await waitFor(() => assert.equal(mailboxPoll.mock.calls.length, 1));
  expect(hook.result.current.showMailboxLetters).toBe(true);
  await hook.rerender({ refreshKey: 2 });
  await waitFor(() => assert.equal(mailboxPoll.mock.calls.length, 2));
  await waitFor(() => assert.equal(hook.result.current.showMailboxLetters, false));
  hook.unmount();
});

test('서명 커서 토큰만 갱신되면 우체통 순환을 재시작하지 않는다', async () => {
  mailboxNow.mockImplementation(async (_islandId, _alive, onPages) => {
    onPages([
      { key: 'latest', ids: ['old-latest'] },
      { key: 'old-first-cursor', ids: ['deleted-unread'] },
      { key: 'old-second-cursor', ids: [] },
    ]);
    return ['deleted-unread'];
  });
  mailboxPoll
    .mockResolvedValueOnce({
      latestUnread: false,
      historyUnread: false,
      latestItems: [{ id: 'new-latest', isRead: true }],
      historyItems: [],
      firstHistoryCursor: 'new-first-token',
      historyPageKey: 'old-inflight-cursor',
      cycleComplete: false,
      nextCursor: 'old-next-token',
    })
    .mockResolvedValueOnce({
      latestUnread: false,
      historyUnread: false,
      latestItems: [{ id: 'new-latest', isRead: true }],
      historyItems: [],
      firstHistoryCursor: 'renewed-first-token-1',
      historyPageKey: 'new-first-page',
      cycleComplete: false,
      nextCursor: 'new-next-token',
    })
    .mockResolvedValueOnce({
      latestUnread: false,
      historyUnread: false,
      latestItems: [{ id: 'new-latest', isRead: true }],
      historyItems: [],
      firstHistoryCursor: 'renewed-first-token-2',
      historyPageKey: 'new-last-page',
      cycleComplete: true,
      nextCursor: 'renewed-first-token-2',
    });
  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );
  await waitFor(() => assert.equal(hook.result.current.showMailboxLetters, true));

  await hook.rerender({ refreshKey: 1 });
  await waitFor(() => assert.equal(mailboxPoll.mock.calls.length, 1));
  expect(mailboxPoll.mock.calls[0][1]).toBeNull();
  await hook.rerender({ refreshKey: 2 });
  await waitFor(() => assert.equal(mailboxPoll.mock.calls.length, 2));
  expect(mailboxPoll.mock.calls[1][1]).toBe('new-first-token');
  expect(hook.result.current.showMailboxLetters).toBe(true);
  await hook.rerender({ refreshKey: 3 });
  await waitFor(() => assert.equal(mailboxPoll.mock.calls.length, 3));
  expect(mailboxPoll.mock.calls[2][1]).toBe('new-next-token');
  await waitFor(() => assert.equal(hook.result.current.showMailboxLetters, false));
  hook.unmount();
});

test('만료된 우체통 커서는 폐기하고 full unread snapshot으로 다시 초기화한다', async () => {
  mailboxNow
    .mockImplementationOnce(async (_islandId, _alive, onPages) => {
      onPages([
        { key: 'latest', ids: ['old-latest'] },
        { key: 'old-first-cursor', ids: ['deleted-unread'] },
      ]);
      return ['deleted-unread'];
    })
    .mockImplementationOnce(async (_islandId, _alive, onPages) => {
      onPages([{ key: 'latest', ids: [] }]);
      return [];
    });
  mailboxPoll.mockRejectedValueOnce(new ApiError('CURSOR_EXPIRED', 'expired', 409));
  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );
  await waitFor(() => assert.equal(hook.result.current.showMailboxLetters, true));

  await hook.rerender({ refreshKey: 1 });
  await waitFor(() => assert.equal(mailboxNow.mock.calls.length, 2));
  await waitFor(() => assert.equal(hook.result.current.showMailboxLetters, false));
  expect(mailboxPoll).toHaveBeenCalledTimes(1);

  await hook.rerender({ refreshKey: 2 });
  await waitFor(() => assert.equal(mailboxPoll.mock.calls.length, 2));
  expect(mailboxPoll.mock.calls[1][1]).toBeNull();
  hook.unmount();
});

test('도서관 확인은 가장 늦게 시작한 확인 요청만 기준점에 반영한다', async () => {
  let releaseOld!: (value: {
    periodKey: string;
    weeklyFingerprint: string;
    fishEarnings: Record<string, number>;
  }) => void;
  const old = new Promise<{
    periodKey: string;
    weeklyFingerprint: string;
    fishEarnings: Record<string, number>;
  }>((resolve) => {
    releaseOld = resolve;
  });
  libraryNow.mockResolvedValueOnce(old).mockResolvedValueOnce({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'latest-screen',
    fishEarnings: { user: 5 },
  });
  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: false, refreshKey: 0 }),
  );

  let oldMark!: Promise<void>;
  let newMark!: Promise<void>;
  await act(async () => {
    oldMark = result.current.markLibrarySeen(displayedLibraryScreen);
    newMark = result.current.markLibrarySeen({
      ...displayedLibraryScreen,
      focusStatistics: { ...displayedLibraryScreen.focusStatistics!, totalSeconds: 99 },
    });
    await newMark;
    releaseOld({
      periodKey: '2026-09-20',
      weeklyFingerprint: 'stale-screen',
      fishEarnings: { user: 2 },
    });
    await oldMark;
  });

  expect(saveLibrary).toHaveBeenCalledTimes(1);
  expect(saveLibrary.mock.calls[0][1].weeklyFingerprint).toBe('latest-screen');
});

test('같은 섬 재조회가 실패해도 마지막 성공 배지를 유지한다', async () => {
  boardSeen.mockResolvedValue({ notice: 1 });
  mailboxNow.mockResolvedValue(['letter-1']);
  const hook = await renderHook(
    (props: { refreshKey: number }) =>
      useBuildingIndicators({
        active: true,
        islandId: 'island-1',
        onHome: true,
        refreshKey: props.refreshKey,
      }),
    { initialProps: { refreshKey: 0 } },
  );
  await waitFor(() => assert.equal(hook.result.current.boardStatus, 'new-comment'));
  await waitFor(() => assert.equal(hook.result.current.showMailboxLetters, true));

  boardNow.mockRejectedValue(new Error('offline'));
  libraryNow.mockRejectedValue(new Error('offline'));
  mailboxNow.mockRejectedValue(new Error('offline'));
  mailboxPoll.mockRejectedValue(new Error('offline'));
  await hook.rerender({ refreshKey: 1 });
  await act(async () => Promise.resolve());

  assert.equal(hook.result.current.boardStatus, 'new-comment');
  assert.equal(hook.result.current.showMailboxLetters, true);
});

test('섬 전환 뒤 끝난 이전 섬 확인 작업은 새 섬 배지를 덮지 않는다', async () => {
  let release!: (value: Record<string, number>) => void;
  boardSeen.mockResolvedValueOnce({ notice: 2 }).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const hook = await renderHook(
    (props: { islandId: string }) =>
      useBuildingIndicators({
        active: true,
        islandId: props.islandId,
        onHome: true,
        refreshKey: 0,
      }),
    { initialProps: { islandId: 'island-1' } },
  );
  await waitFor(() => assert.equal(boardSeen.mock.calls.length, 1));
  const staleMark = hook.result.current.markBoardSeen({
    islandId: 'island-1',
    items: [{ id: 'notice', title: '공지', commentCount: 2 }],
    nextCursor: null,
  });

  await hook.rerender({ islandId: 'island-2' });
  release({ notice: 1 });
  await act(async () => staleMark);

  assert.equal(saveBoard.mock.calls.length, 0);
  assert.equal(hook.result.current.boardStatus, null);
});
