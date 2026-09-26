import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  fetchBoardSnapshot,
  fetchLibrarySnapshot,
  fetchMailboxUnreadCount,
  loadBoardSeen,
  loadLibrarySeen,
  saveBoardSeen,
  saveLibrarySeen,
} from '@/services/buildingIndicators';
import { clearSession, saveSession } from '@/services/api/session';
import { useBuildingIndicators } from './useBuildingIndicators';
import type { LibraryScreen } from '@/services/api/records';

jest.mock('@/services/buildingIndicators', () => ({
  ...jest.requireActual('@/services/buildingIndicators'),
  fetchBoardSnapshot: jest.fn(),
  fetchLibrarySnapshot: jest.fn(),
  fetchMailboxUnreadCount: jest.fn(),
  loadBoardSeen: jest.fn(),
  loadLibrarySeen: jest.fn(),
  saveBoardSeen: jest.fn(),
  saveLibrarySeen: jest.fn(),
}));

const boardNow = fetchBoardSnapshot as jest.Mock;
const libraryNow = fetchLibrarySnapshot as jest.Mock;
const mailboxNow = fetchMailboxUnreadCount as jest.Mock;
const boardSeen = loadBoardSeen as jest.Mock;
const librarySeen = loadLibrarySeen as jest.Mock;
const saveBoard = saveBoardSeen as jest.Mock;
const saveLibrary = saveLibrarySeen as jest.Mock;
const displayedLibraryScreen: LibraryScreen = {
  island: { id: 'island-1', name: '섬', role: 'host' },
  statisticsAvailability: 'available',
  focusStatistics: {
    scope: 'me',
    totalSeconds: 1,
    series: [],
    records: [],
    nextCursor: null,
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
  libraryNow.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'new',
    fishEarnings: { user: 2 },
  });
  mailboxNow.mockResolvedValue(0);
  boardSeen.mockResolvedValue({ notice: 2 });
  librarySeen.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'new',
    fishEarnings: { user: 2 },
  });
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

test('저장된 확인 상태와 서버 현재 값을 비교해 세 배지를 계산한다', async () => {
  boardSeen.mockResolvedValue({ notice: 1 });
  librarySeen.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'old',
    fishEarnings: { user: 2 },
  });
  mailboxNow.mockResolvedValue(2);
  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );

  await waitFor(() => assert.equal(result.current.showMailboxLetters, true));
  assert.equal(result.current.boardStatus, 'new-comment');
  assert.equal(result.current.libraryState, 'new-reading');
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

test('같은 섬 재조회가 실패해도 마지막 성공 배지를 유지한다', async () => {
  boardSeen.mockResolvedValue({ notice: 1 });
  mailboxNow.mockResolvedValue(1);
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
