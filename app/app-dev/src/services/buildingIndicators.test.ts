import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  boardSnapshot,
  boardStatus,
  fetchBoardSnapshot,
  fetchLibrarySnapshot,
  fetchMailboxUnreadCount,
  librarySnapshot,
  libraryStatus,
  reconcileBoardSeen,
  loadBoardSeen,
  loadLibrarySeen,
  saveBoardSeen,
  saveLibrarySeen,
} from './buildingIndicators';
import { getBoard, listNotices } from './api/notices';
import { getMailboxScreen, listLetters } from './api/letters';
import { getFocusStatistics, getLibraryScreen, type LibraryScreen } from './api/records';
import { clearSession, saveSession } from './api/session';
import { CLIENT_STALE_SESSION } from './api/client';

jest.mock('./api/notices', () => ({ getBoard: jest.fn(), listNotices: jest.fn() }));
jest.mock('./api/letters', () => ({ getMailboxScreen: jest.fn(), listLetters: jest.fn() }));
jest.mock('./api/records', () => ({ getLibraryScreen: jest.fn(), getFocusStatistics: jest.fn() }));

const scope = { userId: 'u:1', islandId: 'i:1' };
const now = new Date('2026-09-24T12:00:00Z');
const library = (): LibraryScreen => ({
  island: { id: 'i:1', name: '섬', role: 'host' },
  statisticsAvailability: 'available',
  focusStatistics: {
    scope: 'me',
    totalSeconds: 10,
    series: [{ date: '2026-09-24', seconds: 10 }],
    records: [
      { id: 'r1', subject: '공부', activeSeconds: 10, completedAt: '2026-09-24T10:00:00Z' },
    ],
    nextCursor: null,
  },
  screenTimeStatistics: {
    scope: 'me',
    measurementStatus: 'authorized',
    totalMinutes: 2,
    series: [{ date: '2026-09-24', minutes: 2, measurementStatus: 'authorized', updatedAt: 't1' }],
    updatedAt: 't1',
  },
  fishEarnings: { members: [{ userId: 'u1', name: '나', earnedFish: 2 }] },
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await clearSession();
});

test('읽음 저장은 계정·섬·건물별로 격리되고 다시 로드된다', async () => {
  const snapshot = librarySnapshot(library(), now)!;
  await Promise.all([saveBoardSeen(scope, { n1: 3 }), saveLibrarySeen(scope, snapshot)]);
  expect(await loadBoardSeen(scope)).toEqual({ n1: 3 });
  expect(await loadLibrarySeen(scope)).toEqual(snapshot);
  expect(await loadBoardSeen({ ...scope, userId: 'u2' })).toBeNull();
  expect(await loadBoardSeen({ ...scope, islandId: 'i2' })).toBeNull();
  expect(await loadBoardSeen({ userId: 'u', islandId: '1:i:1' })).toBeNull();
});

test('깨진 JSON과 잘못된 마커는 미확인 baseline으로 돌아간다', async () => {
  await AsyncStorage.setItem('gromo:indicators:v1:u%3A1:i%3A1:board', '{');
  expect(await loadBoardSeen(scope)).toBeNull();
  await AsyncStorage.setItem('gromo:indicators:v1:u%3A1:i%3A1:board', '{"n1":-1}');
  expect(await loadBoardSeen(scope)).toBeNull();
  await AsyncStorage.setItem('gromo:indicators:v1:u%3A1:i%3A1:library', '{"periodKey":2}');
  expect(await loadLibrarySeen(scope)).toBeNull();
});

test('저장소 오류는 성공으로 숨기지 않는다', async () => {
  const spy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('저장 실패'));
  await expect(saveBoardSeen(scope, { n: 1 })).rejects.toThrow('저장 실패');
  spy.mockRestore();
});

test('공지 신규 ID가 새 댓글보다 우선하며 삭제와 댓글 감소는 배지를 만들지 않는다', () => {
  const baseline = boardSnapshot([{ id: 'n1', title: '공지', commentCount: 2 }]);
  expect(boardStatus({ n1: 3 }, baseline)).toBe('new-comment');
  expect(boardStatus({ n1: 3, n2: 0 }, baseline)).toBe('unread');
  expect(boardStatus({ n1: 1 }, baseline)).toBeNull();
  expect(boardStatus({}, baseline)).toBeNull();
  expect(boardStatus({ n1: 2 }, null)).toBeNull();
  expect(boardStatus({ toString: 0 }, {})).toBe('unread');
});

test('댓글 감소 시 확인 기준도 낮춰 이후 새 댓글을 다시 감지할 수 있게 한다', () => {
  expect(reconcileBoardSeen({ n1: 2 }, { n1: 5, removed: 1 })).toEqual({
    n1: 2,
    removed: 1,
  });
});

test('도서관 관측 시각과 주민 이름만 바뀌면 배지가 생기지 않는다', () => {
  const screen = library();
  const seen = librarySnapshot(screen, now);
  screen.focusStatistics!.asOf = '새 조회 시각';
  screen.fishEarnings!.members[0].name = '새 이름';
  expect(libraryStatus(librarySnapshot(screen, now), seen)).toBe(false);
  screen.focusStatistics!.records[0].activeSeconds = 11;
  expect(libraryStatus(librarySnapshot(screen, now), seen)).toBe(true);
});

test('잠긴 도서관·누락 조각·미완성 페이지·UTC 주 변경은 배지를 만들지 않는다', () => {
  const screen = library();
  const seen = librarySnapshot(screen, now);
  expect(libraryStatus(librarySnapshot(screen, new Date('2026-09-27T00:00:00Z')), seen)).toBe(
    false,
  );
  expect(librarySnapshot({ ...screen, statisticsAvailability: 'facility_locked' }, now)).toBeNull();
  expect(librarySnapshot({ ...screen, missingFragments: ['fishEarnings'] }, now)).toBeNull();
  screen.focusStatistics!.nextCursor = 'more';
  expect(librarySnapshot(screen, now)).toBeNull();
});

test('공지 전체 페이지의 과거 공지 새 댓글을 모은다', async () => {
  (getBoard as jest.Mock).mockResolvedValue({
    island: { id: 'i:1' },
    notices: {
      items: [{ id: 'new', title: '최근', commentCount: 0 }],
      nextCursor: 'older',
    },
  });
  (listNotices as jest.Mock).mockResolvedValue({
    items: [{ id: 'old', title: '과거', commentCount: 3 }],
    nextCursor: null,
  });
  expect(await fetchBoardSnapshot('i:1')).toEqual({ new: 0, old: 3 });
  expect(listNotices).toHaveBeenCalledWith('i:1', 'older');
});

test('공지 페이지 반복과 부분 실패는 불완전한 snapshot을 반환하지 않는다', async () => {
  (getBoard as jest.Mock).mockResolvedValue({
    island: { id: 'i:1' },
    notices: { items: [], nextCursor: 'loop' },
  });
  (listNotices as jest.Mock).mockResolvedValue({ items: [], nextCursor: 'loop' });
  await expect(fetchBoardSnapshot('i:1')).rejects.toMatchObject({ code: 'CLIENT_CONTRACT_ERROR' });
  (listNotices as jest.Mock).mockRejectedValueOnce(new Error('다음 페이지 실패'));
  await expect(fetchBoardSnapshot('i:1')).rejects.toThrow('다음 페이지 실패');
});

test('받은 편지 전체 페이지의 미열람 수를 센다', async () => {
  (getMailboxScreen as jest.Mock).mockResolvedValue({
    island: { id: 'i:1' },
    letters: {
      content: [{ id: 'l1', isRead: true }],
      hasNext: true,
      nextCursor: 'older',
    },
  });
  (listLetters as jest.Mock).mockResolvedValue({
    content: [{ id: 'l2', isRead: false }],
    hasNext: false,
    nextCursor: null,
  });
  expect(await fetchMailboxUnreadCount('i:1')).toBe(1);
  expect(listLetters).toHaveBeenCalledWith('received', 'older');
});

test('첫 페이지에서 미열람 편지를 찾으면 뒤 페이지 장애와 무관하게 즉시 표시한다', async () => {
  (getMailboxScreen as jest.Mock).mockResolvedValue({
    island: { id: 'i:1' },
    letters: {
      content: [{ id: 'l1', isRead: false }],
      hasNext: true,
      nextCursor: 'older',
    },
  });
  (listLetters as jest.Mock).mockRejectedValue(new Error('뒤 페이지 실패'));
  expect(await fetchMailboxUnreadCount('i:1')).toBe(1);
  expect(listLetters).not.toHaveBeenCalled();
});

test('편지 중복과 hasNext에 없는 커서는 계약 오류다', async () => {
  (getMailboxScreen as jest.Mock).mockResolvedValue({
    island: { id: 'i:1' },
    letters: {
      content: [{ id: 'l1', isRead: true }],
      hasNext: true,
      nextCursor: 'older',
    },
  });
  (listLetters as jest.Mock).mockResolvedValue({
    content: [{ id: 'l1', isRead: false }],
    hasNext: false,
    nextCursor: null,
  });
  await expect(fetchMailboxUnreadCount('i:1')).rejects.toMatchObject({
    code: 'CLIENT_CONTRACT_ERROR',
  });
  (getMailboxScreen as jest.Mock).mockResolvedValue({
    island: { id: 'i:1' },
    letters: { content: [], hasNext: true, nextCursor: null },
  });
  await expect(fetchMailboxUnreadCount('i:1')).rejects.toMatchObject({
    code: 'CLIENT_CONTRACT_ERROR',
  });
});

test('도서관 집중 기록을 끝까지 수집해 안정 snapshot을 만든다', async () => {
  const screen = library();
  screen.focusStatistics!.nextCursor = 'more';
  (getLibraryScreen as jest.Mock).mockResolvedValue(screen);
  (getFocusStatistics as jest.Mock).mockResolvedValue({
    ...screen.focusStatistics,
    records: [{ id: 'r2', subject: '책', activeSeconds: 5, completedAt: 't2' }],
    nextCursor: null,
  });
  const result = await fetchLibrarySnapshot('i:1', undefined, now);
  expect(result?.fingerprint).toContain('r2');
  expect(getFocusStatistics).toHaveBeenCalledWith('i:1', {
    from: '2026-09-20',
    to: '2026-09-26',
    scope: 'me',
    cursor: 'more',
  });
});

test('현재 섬과 다른 화면 응답을 거부한다', async () => {
  (getBoard as jest.Mock).mockResolvedValue({ island: { id: 'other' } });
  (getMailboxScreen as jest.Mock).mockResolvedValue({ island: { id: 'other' } });
  (getLibraryScreen as jest.Mock).mockResolvedValue({ ...library(), island: { id: 'other' } });
  for (const pending of [
    fetchBoardSnapshot('i:1'),
    fetchMailboxUnreadCount('i:1'),
    fetchLibrarySnapshot('i:1'),
  ]) {
    await expect(pending).rejects.toMatchObject({ code: 'CLIENT_CONTRACT_ERROR' });
  }
});

test('비활성 호출은 요청을 보내지 않고 계정 전환 후 늦은 응답도 버린다', async () => {
  await expect(fetchBoardSnapshot('i:1', () => false)).rejects.toMatchObject({
    code: CLIENT_STALE_SESSION,
  });
  expect(getBoard).not.toHaveBeenCalled();
  let release!: (value: unknown) => void;
  (getBoard as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const pending = fetchBoardSnapshot('i:1');
  await saveSession({ userId: 'u2', accessToken: 'at', refreshToken: 'rt' });
  release({ island: { id: 'i:1' }, notices: { items: [], nextCursor: null } });
  await expect(pending).rejects.toMatchObject({ code: CLIENT_STALE_SESSION });
});
