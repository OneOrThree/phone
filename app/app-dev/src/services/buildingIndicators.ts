import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, CLIENT_STALE_SESSION } from './api/client';
import { CLIENT_CONTRACT_ERROR } from './api/home';
import { getMailboxScreen, listLetters, type LetterSlice } from './api/letters';
import { getLibraryScreen, type LibraryScreen } from './api/records';
import { sessionGeneration } from './api/session';

export type IndicatorScope = { userId: string; islandId: string };
export type LibrarySnapshot = {
  periodKey: string;
  weeklyFingerprint: string;
  fishEarnings: Record<string, number>;
};

const key = (scope: IndicatorScope, building: 'library') =>
  `gromo:indicators:v1:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.islandId)}:${building}`;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

async function load<T>(
  storageKey: string,
  valid: (value: unknown) => value is T,
): Promise<T | null> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

export const loadLibrarySeen = (scope: IndicatorScope) =>
  load(
    key(scope, 'library'),
    (value): value is LibrarySnapshot =>
      record(value) &&
      typeof value.periodKey === 'string' &&
      typeof value.weeklyFingerprint === 'string' &&
      record(value.fishEarnings) &&
      Object.values(value.fishEarnings).every(count),
  );
export const saveLibrarySeen = (scope: IndicatorScope, snapshot: LibrarySnapshot) =>
  AsyncStorage.setItem(key(scope, 'library'), JSON.stringify(snapshot));

const week = (now: Date) => {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
};

export function librarySnapshot(screen: LibraryScreen, now = new Date()): LibrarySnapshot | null {
  if (
    screen.statisticsAvailability !== 'available' ||
    screen.missingFragments?.length ||
    !screen.focusStatistics ||
    !screen.screenTimeStatistics ||
    !screen.fishEarnings
  )
    return null;
  const focus = screen.focusStatistics;
  const usage = screen.screenTimeStatistics;
  // 조회·집계 시각(asOf/updatedAt), 주민 이름, 배열 순서는 콘텐츠 변경으로 세지 않는다.
  // 새 집중 기록은 합계와 일별 시계열을 반드시 바꾸므로, 기록 목록(페이지)은 지문에 넣지 않는다.
  // 그래서 홈 폴링은 /screens/library 한 번만 읽고 집중 기록 다음 페이지를 따라가지 않는다.
  return {
    periodKey: week(now).from,
    weeklyFingerprint: JSON.stringify({
      focus: {
        totalSeconds: focus.totalSeconds,
        series: focus.series
          .map(({ date, seconds }) => ({ date, seconds }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      },
      usage: {
        measurementStatus: usage.measurementStatus,
        totalMinutes: usage.totalMinutes,
        series: usage.series
          .map(({ date, minutes, measurementStatus }) => ({
            date,
            minutes,
            measurementStatus,
          }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      },
    }),
    fishEarnings: Object.fromEntries(
      screen.fishEarnings.members.map(({ userId, earnedFish }) => [userId, earnedFish]),
    ),
  };
}

export function libraryStatus(
  current: LibrarySnapshot | null,
  seen: LibrarySnapshot | null,
): boolean {
  if (!current || !seen) return false;
  const hasNewFish = Object.entries(current.fishEarnings).some(
    ([userId, earnedFish]) => earnedFish > (seen.fishEarnings[userId] ?? 0),
  );
  return (
    hasNewFish ||
    (current.periodKey === seen.periodKey && current.weeklyFingerprint !== seen.weeklyFingerprint)
  );
}

/** 주가 바뀌면 주간 통계만 새 기준으로 옮기고, 미확인 누적 어획 기준은 보존한다. */
export function rolloverLibrarySeen(
  current: LibrarySnapshot,
  seen: LibrarySnapshot,
): LibrarySnapshot {
  return {
    ...current,
    fishEarnings: seen.fishEarnings,
  };
}

const contract = (field: string) =>
  new ApiError(CLIENT_CONTRACT_ERROR, `계약과 다른 응답입니다 (${field}).`, 0, { field });

function guard(isCurrent?: () => boolean) {
  const generation = sessionGeneration();
  return () => {
    if (sessionGeneration() !== generation || isCurrent?.() === false)
      throw new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요.', 0);
  };
}

async function gated<T>(pending: Promise<T>, alive: () => void): Promise<T> {
  try {
    const result = await pending;
    alive();
    return result;
  } catch (error) {
    alive();
    throw error;
  }
}

function nextPage(cursor: unknown, used: Set<string>): string | null {
  if (cursor === null) return null;
  if (typeof cursor !== 'string' || !cursor || used.has(cursor)) throw contract('nextCursor');
  used.add(cursor);
  return cursor;
}

/**
 * 받은 편지는 최신순이고 읽음 → 안 읽음으로 되돌아가지 않는다. 전부 읽음을 확인했을 때의
 * 최신 편지 id 를 기억해 두면, 다음 조회는 그 편지에 닿는 순간 멈춰 새로 온 페이지만 확인한다.
 */
export type MailboxReadThrough = { id: string | null };

export async function fetchMailboxUnreadCount(
  islandId: string,
  isCurrent?: () => boolean,
  readThrough?: MailboxReadThrough,
): Promise<number> {
  const alive = guard(isCurrent);
  alive();
  const screen = await gated(getMailboxScreen(), alive);
  if (screen.island.id !== islandId) throw contract('mailbox.island.id');
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let page: LetterSlice = screen.letters;
  let unread = 0;
  const newestId = Array.isArray(page.content) ? (page.content[0]?.id ?? null) : null;
  const confirmAllRead = () => {
    if (readThrough) readThrough.id = newestId;
    return unread;
  };
  for (;;) {
    if (!Array.isArray(page.content) || typeof page.hasNext !== 'boolean')
      throw contract('letters');
    const pageIds = new Set<string>();
    for (const item of page.content) {
      if (
        !item ||
        typeof item.id !== 'string' ||
        typeof item.isRead !== 'boolean' ||
        pageIds.has(item.id)
      )
        throw contract('letters.content');
      pageIds.add(item.id);
      if (ids.has(item.id)) continue;
      ids.add(item.id);
      if (!item.isRead) return unread + 1;
      if (readThrough?.id != null && item.id === readThrough.id) return confirmAllRead();
    }
    if (!page.hasNext) return confirmAllRead();
    const cursor = nextPage(page.nextCursor, cursors);
    if (cursor === null) throw contract('letters.nextCursor');
    alive();
    page = await gated(listLetters('received', cursor), alive);
  }
}

export async function fetchLibrarySnapshot(
  islandId: string,
  isCurrent?: () => boolean,
  now = new Date(),
  initialScreen?: LibraryScreen,
): Promise<LibrarySnapshot | null> {
  const alive = guard(isCurrent);
  alive();
  // 화면이 이미 표시한 응답이 있으면 그 응답을 그대로 기준으로 삼는다.
  const screen = initialScreen ?? (await gated(getLibraryScreen(), alive));
  alive();
  if (screen.island.id !== islandId) throw contract('library.island.id');
  return librarySnapshot(screen, now);
}
