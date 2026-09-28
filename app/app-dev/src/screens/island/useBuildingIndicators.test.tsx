import assert from 'node:assert/strict';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  fetchLibrarySnapshot,
  fetchMailboxUnreadCount,
  loadLibrarySeen,
  saveLibrarySeen,
} from '@/services/buildingIndicators';
import { clearSession, saveSession } from '@/services/api/session';
import { useBuildingIndicators } from './useBuildingIndicators';
import type { LibraryScreen } from '@/services/api/records';

jest.mock('@/services/buildingIndicators', () => ({
  ...jest.requireActual('@/services/buildingIndicators'),
  fetchLibrarySnapshot: jest.fn(),
  fetchMailboxUnreadCount: jest.fn(),
  loadLibrarySeen: jest.fn(),
  saveLibrarySeen: jest.fn(),
}));

const libraryNow = fetchLibrarySnapshot as jest.Mock;
const mailboxNow = fetchMailboxUnreadCount as jest.Mock;
const librarySeen = loadLibrarySeen as jest.Mock;
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
  libraryNow.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'new',
    fishEarnings: { user: 2 },
  });
  mailboxNow.mockResolvedValue(0);
  librarySeen.mockResolvedValue({
    periodKey: '2026-09-20',
    weeklyFingerprint: 'new',
    fishEarnings: { user: 2 },
  });
  saveLibrary.mockResolvedValue(undefined);
});

test('홈이 아니거나 서버 섬이 없으면 배지 API를 호출하지 않는다', async () => {
  await renderHook(() =>
    useBuildingIndicators({ active: false, islandId: null, onHome: false, refreshKey: 0 }),
  );
  assert.equal(libraryNow.mock.calls.length, 0);
  assert.equal(mailboxNow.mock.calls.length, 0);
});

test('저장된 확인 상태와 서버 현재 값을 비교해 도서관·우편함 배지를 계산하고 게시판은 조회하지 않는다', async () => {
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
  assert.equal(result.current.libraryState, 'new-reading');
  // 게시판 배지는 useBoardHomeIndicator 가 담당한다.
  assert.equal('boardStatus' in result.current, false);
});

test('첫 관측은 기준점으로 저장하고 과거 콘텐츠 배지를 만들지 않는다', async () => {
  librarySeen.mockResolvedValue(null);
  const { result } = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );

  await waitFor(() => assert.equal(saveLibrary.mock.calls.length, 1));
  assert.equal(result.current.libraryState, 'normal');
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

test('60초 폴링은 진행 중인 조회를 재시작하지 않고 완료 뒤 한 번 갱신한다', async () => {
  jest.useFakeTimers();
  const snapshot = {
    periodKey: '2026-09-20',
    weeklyFingerprint: 'new',
    fishEarnings: { user: 2 },
  };
  let release!: (value: typeof snapshot) => void;
  const pending = new Promise<typeof snapshot>((resolve) => {
    release = resolve;
  });
  libraryNow.mockReturnValueOnce(pending).mockResolvedValue(snapshot);
  const hook = await renderHook(() =>
    useBuildingIndicators({ active: true, islandId: 'island-1', onHome: true, refreshKey: 0 }),
  );
  await act(async () => Promise.resolve());
  assert.equal(libraryNow.mock.calls.length, 1);

  await act(async () => {
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
  });
  assert.equal(libraryNow.mock.calls.length, 1);

  release(snapshot);
  jest.useRealTimers();
  await act(async () => {
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(libraryNow.mock.calls.length, 2);
  hook.unmount();
});

test('같은 섬 재조회가 실패해도 마지막 성공 배지를 유지한다', async () => {
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
  await waitFor(() => assert.equal(hook.result.current.showMailboxLetters, true));

  libraryNow.mockRejectedValue(new Error('offline'));
  mailboxNow.mockRejectedValue(new Error('offline'));
  await hook.rerender({ refreshKey: 1 });
  await act(async () => Promise.resolve());

  assert.equal(hook.result.current.showMailboxLetters, true);
});
