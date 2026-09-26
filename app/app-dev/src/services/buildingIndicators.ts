import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, CLIENT_STALE_SESSION } from './api/client';
import { CLIENT_CONTRACT_ERROR } from './api/home';
import { getMailboxScreen, listLetters, type LetterSlice } from './api/letters';
import { getBoard, listNotices, type NoticePage } from './api/notices';
import { getFocusStatistics, getLibraryScreen, type LibraryScreen } from './api/records';
import { sessionGeneration } from './api/session';

export type IndicatorScope = { userId: string; islandId: string };
export type BoardSnapshot = Record<string, number>;
export type LibrarySnapshot = {
  periodKey: string;
  weeklyFingerprint: string;
  fishEarnings: Record<string, number>;
};

const key = (scope: IndicatorScope, building: 'board' | 'library') =>
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

export const loadBoardSeen = (scope: IndicatorScope) =>
  load(
    key(scope, 'board'),
    (value): value is BoardSnapshot => record(value) && Object.values(value).every(count),
  );
export const saveBoardSeen = (scope: IndicatorScope, snapshot: BoardSnapshot) =>
  AsyncStorage.setItem(key(scope, 'board'), JSON.stringify(snapshot));
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

export function boardSnapshot(items: NoticePage['items']): BoardSnapshot {
  return Object.fromEntries(items.map((item) => [item.id, item.commentCount]));
}

export function boardStatus(
  current: BoardSnapshot,
  seen: BoardSnapshot | null,
): 'unread' | 'new-comment' | null {
  if (!seen) return null;
  if (Object.keys(current).some((id) => !Object.prototype.hasOwnProperty.call(seen, id)))
    return 'unread';
  return Object.entries(current).some(([id, comments]) => comments > seen[id])
    ? 'new-comment'
    : null;
}

/** 댓글 삭제로 카운트가 내려간 공지는 기준점도 낮춰 이후 새 댓글을 다시 감지한다. */
export function reconcileBoardSeen(current: BoardSnapshot, seen: BoardSnapshot): BoardSnapshot {
  return Object.fromEntries(
    Object.entries(seen).map(([id, comments]) => [
      id,
      Object.prototype.hasOwnProperty.call(current, id)
        ? Math.min(comments, current[id])
        : comments,
    ]),
  );
}

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
    !screen.fishEarnings ||
    screen.focusStatistics.nextCursor !== null
  )
    return null;
  const focus = screen.focusStatistics;
  const usage = screen.screenTimeStatistics;
  // 조회·집계 시각(asOf/updatedAt), 주민 이름, 배열 순서는 콘텐츠 변경으로 세지 않는다.
  return {
    periodKey: week(now).from,
    weeklyFingerprint: JSON.stringify({
      focus: {
        totalSeconds: focus.totalSeconds,
        series: focus.series
          .map(({ date, seconds }) => ({ date, seconds }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        records: focus.records
          .map(({ id, subject, activeSeconds, completedAt }) => ({
            id,
            subject,
            activeSeconds,
            completedAt,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
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

export async function fetchBoardSnapshot(
  islandId: string,
  isCurrent?: () => boolean,
): Promise<BoardSnapshot> {
  const alive = guard(isCurrent);
  alive();
  const screen = await gated(getBoard(), alive);
  if (screen.island.id !== islandId) throw contract('board.island.id');
  const items: NoticePage['items'] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let page = screen.notices;
  for (;;) {
    if (!Array.isArray(page.items)) throw contract('notices.items');
    for (const item of page.items) {
      if (!item || typeof item.id !== 'string' || !count(item.commentCount) || ids.has(item.id))
        throw contract('notices.items');
      ids.add(item.id);
      items.push(item);
    }
    const cursor = nextPage(page.nextCursor, cursors);
    if (cursor === null) return boardSnapshot(items);
    alive();
    page = await gated(listNotices(islandId, cursor), alive);
  }
}

export async function fetchMailboxUnreadCount(
  islandId: string,
  isCurrent?: () => boolean,
): Promise<number> {
  const alive = guard(isCurrent);
  alive();
  const screen = await gated(getMailboxScreen(), alive);
  if (screen.island.id !== islandId) throw contract('mailbox.island.id');
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let page: LetterSlice = screen.letters;
  let unread = 0;
  for (;;) {
    if (!Array.isArray(page.content) || typeof page.hasNext !== 'boolean')
      throw contract('letters');
    for (const item of page.content) {
      if (
        !item ||
        typeof item.id !== 'string' ||
        typeof item.isRead !== 'boolean' ||
        ids.has(item.id)
      )
        throw contract('letters.content');
      ids.add(item.id);
      if (!item.isRead) return unread + 1;
    }
    if (!page.hasNext) return unread;
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
  // When the library screen has already been loaded for display, use that exact
  // response as the first page. Fetch only any remaining focus-record pages.
  const screen = initialScreen ?? (await gated(getLibraryScreen(), alive));
  alive();
  if (screen.island.id !== islandId) throw contract('library.island.id');
  if (screen.statisticsAvailability !== 'available' || screen.missingFragments?.length) return null;
  if (!screen.focusStatistics) return null;
  const focus = screen.focusStatistics;
  const records = [...focus.records];
  const ids = new Set(records.map((item) => item.id));
  if (ids.size !== records.length) throw contract('records');
  const cursors = new Set<string>();
  let cursor = nextPage(focus.nextCursor, cursors);
  while (cursor !== null) {
    alive();
    const page = await gated(
      getFocusStatistics(islandId, { ...week(now), scope: 'me', cursor }),
      alive,
    );
    for (const item of page.records) {
      if (ids.has(item.id)) throw contract('records');
      ids.add(item.id);
      records.push(item);
    }
    cursor = nextPage(page.nextCursor, cursors);
  }
  return librarySnapshot(
    { ...screen, focusStatistics: { ...focus, records, nextCursor: null } },
    now,
  );
}
