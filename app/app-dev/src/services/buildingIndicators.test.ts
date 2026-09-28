import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchLibrarySnapshot,
  fetchMailboxUnreadCount,
  librarySnapshot,
  libraryStatus,
  rolloverLibrarySeen,
  loadLibrarySeen,
  saveLibrarySeen,
} from './buildingIndicators';
import { getMailboxScreen, listLetters } from './api/letters';
import { getFocusStatistics, getLibraryScreen, type LibraryScreen } from './api/records';
import { clearSession, saveSession } from './api/session';
import { CLIENT_STALE_SESSION } from './api/client';

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
  await saveLibrarySeen(scope, snapshot);
  expect(await loadLibrarySeen(scope)).toEqual(snapshot);
  expect(await loadLibrarySeen({ ...scope, userId: 'u2' })).toBeNull();
  expect(await loadLibrarySeen({ ...scope, islandId: 'i2' })).toBeNull();
  expect(await loadLibrarySeen({ userId: 'u', islandId: '1:i:1' })).toBeNull();
});

test('깨진 JSON과 잘못된 마커는 미확인 baseline으로 돌아간다', async () => {
  await AsyncStorage.setItem('gromo:indicators:v1:u%3A1:i%3A1:library', '{');
  expect(await loadLibrarySeen(scope)).toBeNull();
  await AsyncStorage.setItem('gromo:indicators:v1:u%3A1:i%3A1:library', '{"periodKey":2}');
  expect(await loadLibrarySeen(scope)).toBeNull();
});

test('저장소 오류는 성공으로 숨기지 않는다', async () => {
  const spy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('저장 실패'));
  await expect(saveLibrarySeen(scope, librarySnapshot(library(), now)!)).rejects.toThrow(
    '저장 실패',
  );
  spy.mockRestore();
});

test('도서관 관측 시각과 주민 이름만 바뀌면 배지가 생기지 않는다', () => {
  const screen = library();
  const seen = librarySnapshot(screen, now);
  screen.focusStatistics!.asOf = '새 조회 시각';
  screen.fishEarnings!.members[0].name = '새 이름';
  expect(libraryStatus(librarySnapshot(screen, now), seen)).toBe(false);
  screen.focusStatistics!.totalSeconds = 11;
  screen.focusStatistics!.series[0].seconds = 11;
  expect(libraryStatus(librarySnapshot(screen, now), seen)).toBe(true);
});

test('스크린타임 집계와 날짜별 updatedAt만 바뀌면 도서관 fingerprint가 유지된다', () => {
  const screen = library();
  const seen = librarySnapshot(screen, now);
  screen.screenTimeStatistics!.updatedAt = 't2';
  screen.screenTimeStatistics!.series[0].updatedAt = 't2';
  const current = librarySnapshot(screen, now);
  expect(current).toEqual(seen);
  expect(libraryStatus(current, seen)).toBe(false);
  screen.screenTimeStatistics!.series[0].minutes = 3;
  expect(libraryStatus(librarySnapshot(screen, now), seen)).toBe(true);
  screen.screenTimeStatistics!.series[0].minutes = 2;
  screen.screenTimeStatistics!.series[0].measurementStatus = 'denied';
  expect(libraryStatus(librarySnapshot(screen, now), seen)).toBe(true);
});

test('33쪽을 넘는 정상 편지 페이지를 끝까지 조회한다', async () => {
  const last = 40;
  const cursor = (page: number) => (page < last ? String(page + 1) : null);
  (getMailboxScreen as jest.Mock).mockResolvedValue({
    island: { id: 'i:1' },
    letters: { content: [{ id: 'l0', isRead: true }], hasNext: true, nextCursor: '1' },
  });
  (listLetters as jest.Mock).mockImplementation(async (_type, next) => {
    const page = Number(next);
    return {
      content: [{ id: `l${page}`, isRead: page < last }],
      hasNext: page < last,
      nextCursor: cursor(page),
    };
  });
  expect(await fetchMailboxUnreadCount('i:1')).toBe(1);
  expect(listLetters).toHaveBeenCalledTimes(last);
});

test('잠긴 도서관·누락 조각·남은 기록 페이지·UTC 주 변경은 배지를 만들지 않는다', () => {
  const screen = library();
  const seen = librarySnapshot(screen, now);
  expect(libraryStatus(librarySnapshot(screen, new Date('2026-09-27T00:00:00Z')), seen)).toBe(
    false,
  );
  expect(librarySnapshot({ ...screen, statisticsAvailability: 'facility_locked' }, now)).toBeNull();
  expect(librarySnapshot({ ...screen, missingFragments: ['fishEarnings'] }, now)).toBeNull();
  // 기록 목록은 지문에 없으므로 다음 페이지가 남아 있어도 같은 지문을 만든다.
  screen.focusStatistics!.nextCursor = 'more';
  expect(libraryStatus(librarySnapshot(screen, now), seen)).toBe(false);
});

test('주 경계에서는 주간 통계만 초기화하고 미확인 누적 어획 증가는 유지한다', () => {
  const screen = library();
  const seen = librarySnapshot(screen, now)!;
  const nextWeek = new Date('2026-09-27T00:00:00Z');

  expect(libraryStatus(librarySnapshot(screen, nextWeek), seen)).toBe(false);

  screen.fishEarnings!.members[0].earnedFish = 3;
  const current = librarySnapshot(screen, nextWeek)!;
  expect(libraryStatus(current, seen)).toBe(true);

  const rolled = rolloverLibrarySeen(current, seen);
  expect(rolled.periodKey).toBe(current.periodKey);
  expect(rolled.weeklyFingerprint).toBe(current.weeklyFingerprint);
  expect(rolled.fishEarnings).toEqual(seen.fishEarnings);
  expect(libraryStatus(current, rolled)).toBe(true);
  expect(libraryStatus(current, current)).toBe(false);
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

test('전부 읽음을 확인한 경계 이후에는 새로 온 편지만 확인하고 이전 페이지를 다시 돌지 않는다', async () => {
  (getMailboxScreen as jest.Mock).mockResolvedValue({
    island: { id: 'i:1' },
    letters: { content: [{ id: 'l2', isRead: true }], hasNext: true, nextCursor: 'older' },
  });
  (listLetters as jest.Mock).mockResolvedValue({
    content: [{ id: 'l1', isRead: true }],
    hasNext: false,
    nextCursor: null,
  });
  const readThrough = { id: null as string | null };
  expect(await fetchMailboxUnreadCount('i:1', undefined, readThrough)).toBe(0);
  expect(readThrough.id).toBe('l2');
  expect(listLetters).toHaveBeenCalledTimes(1);

  // 새 편지가 없으면 첫 페이지의 경계 편지에서 멈춘다.
  expect(await fetchMailboxUnreadCount('i:1', undefined, readThrough)).toBe(0);
  expect(listLetters).toHaveBeenCalledTimes(1);

  // 새로 온 읽은 편지 뒤에서 경계를 만나면 멈추고 경계를 최신 편지로 옮긴다.
  (getMailboxScreen as jest.Mock).mockResolvedValue({
    island: { id: 'i:1' },
    letters: {
      content: [
        { id: 'l3', isRead: true },
        { id: 'l2', isRead: true },
      ],
      hasNext: true,
      nextCursor: 'older',
    },
  });
  expect(await fetchMailboxUnreadCount('i:1', undefined, readThrough)).toBe(0);
  expect(readThrough.id).toBe('l3');
  expect(listLetters).toHaveBeenCalledTimes(1);

  // 미열람 편지가 오면 표시하고 경계는 옮기지 않는다.
  (getMailboxScreen as jest.Mock).mockResolvedValue({
    island: { id: 'i:1' },
    letters: {
      content: [
        { id: 'l4', isRead: false },
        { id: 'l3', isRead: true },
      ],
      hasNext: true,
      nextCursor: 'older',
    },
  });
  expect(await fetchMailboxUnreadCount('i:1', undefined, readThrough)).toBe(1);
  expect(readThrough.id).toBe('l3');
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

test('페이지 경계의 편지 중복은 건너뛰고 hasNext에 없는 커서는 계약 오류다', async () => {
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
  expect(await fetchMailboxUnreadCount('i:1')).toBe(0);
  (getMailboxScreen as jest.Mock).mockResolvedValue({
    island: { id: 'i:1' },
    letters: { content: [], hasNext: true, nextCursor: null },
  });
  await expect(fetchMailboxUnreadCount('i:1')).rejects.toMatchObject({
    code: 'CLIENT_CONTRACT_ERROR',
  });
});

test('홈 조회는 /screens/library 한 번만 읽고 집중 기록 다음 페이지를 따라가지 않는다', async () => {
  const screen = library();
  screen.focusStatistics!.nextCursor = 'more';
  (getLibraryScreen as jest.Mock).mockResolvedValue(screen);
  const result = await fetchLibrarySnapshot('i:1', undefined, now);
  expect(result).toEqual(librarySnapshot(screen, now));
  expect(getLibraryScreen).toHaveBeenCalledTimes(1);
  expect(getFocusStatistics).not.toHaveBeenCalled();
});

test('이미 표시한 도서관 응답이 있으면 다시 요청하지 않고 그 응답을 기준으로 삼는다', async () => {
  const screen = library();
  const result = await fetchLibrarySnapshot('i:1', undefined, now, screen);
  expect(result).toEqual(librarySnapshot(screen, now));
  expect(getLibraryScreen).not.toHaveBeenCalled();
  expect(getFocusStatistics).not.toHaveBeenCalled();
});

test('현재 섬과 다른 화면 응답을 거부한다', async () => {
  (getMailboxScreen as jest.Mock).mockResolvedValue({ island: { id: 'other' } });
  (getLibraryScreen as jest.Mock).mockResolvedValue({ ...library(), island: { id: 'other' } });
  for (const pending of [fetchMailboxUnreadCount('i:1'), fetchLibrarySnapshot('i:1')]) {
    await expect(pending).rejects.toMatchObject({ code: 'CLIENT_CONTRACT_ERROR' });
  }
});

test('비활성 호출은 요청을 보내지 않고 계정 전환 후 늦은 응답도 버린다', async () => {
  await expect(fetchMailboxUnreadCount('i:1', () => false)).rejects.toMatchObject({
    code: CLIENT_STALE_SESSION,
  });
  expect(getMailboxScreen).not.toHaveBeenCalled();
  let release!: (value: unknown) => void;
  (getMailboxScreen as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const pending = fetchMailboxUnreadCount('i:1');
  await saveSession({ userId: 'u2', accessToken: 'at', refreshToken: 'rt' });
  release({ island: { id: 'i:1' }, letters: { content: [], hasNext: false, nextCursor: null } });
  await expect(pending).rejects.toMatchObject({ code: CLIENT_STALE_SESSION });
});
