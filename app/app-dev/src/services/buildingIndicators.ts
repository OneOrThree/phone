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
const periodKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 0
  );
};

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
      periodKey(value.periodKey) &&
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

export function librarySnapshot(
  screen: LibraryScreen,
  now = new Date(),
  allowPartialRecords = false,
): LibrarySnapshot | null {
  if (
    screen.statisticsAvailability !== 'available' ||
    screen.missingFragments?.length ||
    !screen.focusStatistics ||
    !screen.screenTimeStatistics ||
    !screen.fishEarnings ||
    (!allowPartialRecords && screen.focusStatistics.nextCursor !== null)
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
    (current.periodKey === seen.periodKey &&
      comparableWeeklyFingerprint(current.weeklyFingerprint) !==
        comparableWeeklyFingerprint(seen.weeklyFingerprint))
  );
}

// /screens/library supplies complete weekly totals/series but only a page of records.
// Older saved fingerprints include all records; compare their aggregate summary so fast
// polls can safely skip cursor pagination without creating false-positive unread markers.
function comparableWeeklyFingerprint(fingerprint: string): string {
  try {
    const parsed: unknown = JSON.parse(fingerprint);
    if (!record(parsed) || !record(parsed.focus) || !Array.isArray(parsed.focus.series))
      return fingerprint;
    return JSON.stringify({
      focus: { totalSeconds: parsed.focus.totalSeconds, series: parsed.focus.series },
      usage: parsed.usage,
    });
  } catch {
    return fingerprint;
  }
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
    const pageIds = new Set<string>();
    for (const item of page.items) {
      if (!item || typeof item.id !== 'string' || !count(item.commentCount) || pageIds.has(item.id))
        throw contract('notices.items');
      pageIds.add(item.id);
      if (ids.has(item.id)) continue;
      ids.add(item.id);
      items.push(item);
    }
    const cursor = nextPage(page.nextCursor, cursors);
    if (cursor === null) return boardSnapshot(items);
    alive();
    page = await gated(listNotices(islandId, cursor), alive);
  }
}

export type BoardPollPage = { snapshot: BoardSnapshot; nextCursor: string | null };

/**
 * 60초 갱신용 게시판 조회. 최신 페이지와 순환 커서가 가리키는 과거 페이지 하나만
 * 확인하므로 요청량은 이력 길이에 비례하지 않는다. 오래된 공지 댓글 변경은 커서가
 * 한 바퀴 도는 동안 발견되며, 페이지 수에 따라 발견 지연이 늘어난다.
 */
export async function fetchBoardPollPage(
  islandId: string,
  historyCursor: string | null,
  isCurrent?: () => boolean,
): Promise<BoardPollPage> {
  const alive = guard(isCurrent);
  alive();
  const screen = await gated(getBoard(), alive);
  if (screen.island.id !== islandId) throw contract('board.island.id');
  const latest = validateNoticeItems(screen.notices);
  const firstHistoryCursor = nextPage(screen.notices.nextCursor, new Set());
  if (!firstHistoryCursor) return { snapshot: latest, nextCursor: null };

  const cursor = historyCursor ?? firstHistoryCursor;
  alive();
  const page = await gated(listNotices(islandId, cursor), alive);
  const historical = validateNoticeItems(page);
  const next = nextPage(page.nextCursor, new Set([cursor]));
  return {
    // 최신 페이지를 우선해 경계에서 중복된 공지의 값을 최신 응답으로 유지한다.
    snapshot: { ...historical, ...latest },
    nextCursor: next ?? firstHistoryCursor,
  };
}

function validateNoticeItems(page: NoticePage): BoardSnapshot {
  if (!Array.isArray(page.items)) throw contract('notices.items');
  const result: BoardSnapshot = {};
  for (const item of page.items) {
    if (!item || typeof item.id !== 'string' || !count(item.commentCount))
      throw contract('notices.items');
    result[item.id] = item.commentCount;
  }
  return result;
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
    }
    if (!page.hasNext) return unread;
    const cursor = nextPage(page.nextCursor, cursors);
    if (cursor === null) throw contract('letters.nextCursor');
    alive();
    page = await gated(listLetters('received', cursor), alive);
  }
}

export type MailboxPollPage = {
  latestUnread: boolean;
  historyUnread: boolean;
  cycleComplete: boolean;
  nextCursor: string | null;
};

/** 60초 갱신당 최신 편지와 과거 커서 페이지 하나만 읽는다. */
export async function fetchMailboxPollPage(
  islandId: string,
  historyCursor: string | null,
  isCurrent?: () => boolean,
): Promise<MailboxPollPage> {
  const alive = guard(isCurrent);
  alive();
  const screen = await gated(getMailboxScreen(), alive);
  if (screen.island.id !== islandId) throw contract('mailbox.island.id');
  const latest = validateLetterPage(screen.letters);
  const firstHistoryCursor = screen.letters.hasNext
    ? nextPage(screen.letters.nextCursor, new Set())
    : null;
  if (!firstHistoryCursor)
    return {
      latestUnread: latest.some((item) => !item.isRead),
      historyUnread: false,
      cycleComplete: true,
      nextCursor: null,
    };

  const cursor = historyCursor ?? firstHistoryCursor;
  alive();
  const page = await gated(listLetters('received', cursor), alive);
  const history = validateLetterPage(page);
  const next = page.hasNext ? nextPage(page.nextCursor, new Set([cursor])) : null;
  return {
    latestUnread: latest.some((item) => !item.isRead),
    historyUnread: history.some((item) => !item.isRead),
    cycleComplete: next === null,
    nextCursor: next ?? firstHistoryCursor,
  };
}

function validateLetterPage(page: LetterSlice): LetterSlice['content'] {
  if (!Array.isArray(page.content) || typeof page.hasNext !== 'boolean') throw contract('letters');
  const ids = new Set<string>();
  for (const item of page.content) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      typeof item.isRead !== 'boolean' ||
      ids.has(item.id)
    )
      throw contract('letters.content');
    ids.add(item.id);
  }
  return page.content;
}

export async function fetchLibrarySnapshot(
  islandId: string,
  isCurrent?: () => boolean,
  now = new Date(),
  initialScreen?: LibraryScreen,
  latestOnly = false,
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
  if (latestOnly) return librarySnapshot(screen, now, true);
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
    const pageIds = new Set<string>();
    for (const item of page.records) {
      if (pageIds.has(item.id)) throw contract('records');
      pageIds.add(item.id);
      if (ids.has(item.id)) continue;
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
