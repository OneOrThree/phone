/**
 * 도서관 화면 집계와 집중·스크린타임 통계 조회 (GROMO-2018 — island-records 공개 계약).
 *
 * 계약(동결표 — docs/prd/fishcat/island-records + bff-screens §4):
 *  - `GET /screens/library`                          도서관 진입 집계. query 없음. 조각은
 *      `statisticsAvailability`(`available`·`facility_locked`, missing 조각이면 null)와
 *      `focusStatistics`·`screenTimeStatistics`(완공 시 **이번 UTC 주(일~토)·scope=me**),
 *      `fishEarnings`(전 기간 누적, 기간 축 없음). 미완공이면 셋 다 null + `facility_locked`.
 *  - `GET /islands/{islandId}/statistics/focus`      query `from`·`to`(UTC `YYYY-MM-DD`,
 *      양끝 포함)·`timezone`·`scope=me|island`·`cursor`(scope=me 는 records 쪽, island 는
 *      members 쪽 페이지). 날짜 축은 UTC 다(결정 RC-축) — KST 날짜로 바꿔 보내지 않는다.
 *  - `GET /islands/{islandId}/statistics/screen-time`  같은 query 에 cursor 없음.
 *
 * 실패를 빈 기록으로 접지 않는다 — `totalSeconds:0`·`series:[]` 는 「그 기간에 기록이 없다」는
 * 뜻이고 「못 읽었다」(401/403/네트워크)와 다른 상태다. 스크린타임의 `minutes:null`·
 * `measurementStatus` ≠ authorized 는 미측정이지 0분이 아니다 — 0으로 보간하지 않는다.
 */
import { ApiError, request } from './client';
import { CLIENT_CONTRACT_ERROR } from './home';

export type MeasurementStatus = 'authorized' | 'denied' | 'pending' | 'unavailable';
const MEASUREMENT = new Set<string>(['authorized', 'denied', 'pending', 'unavailable']);

export type FocusSeriesPoint = { date: string; seconds: number };
export type ScreenSeriesPoint = {
  date: string;
  /** null 은 알려진 미측정 날짜다 — 0으로 읽지 않는다. */
  minutes: number | null;
  measurementStatus: MeasurementStatus;
  updatedAt: string | null;
};

/** scope=me 집중 통계 — records 는 완료 세션당 1행(30개씩 cursor 로 잇는다). */
export type FocusStatsMe = {
  scope: 'me';
  totalSeconds: number;
  series: FocusSeriesPoint[];
  records: { id: string; subject: string; activeSeconds: number; completedAt: string }[];
  nextCursor: string | null;
  asOf?: string;
};

/** scope=island 집중 통계 — 현재 활성 주민의 기간 합계·일별 series 만. 개인 과목·records 없음. */
export type FocusStatsIsland = {
  scope: 'island';
  members: {
    userId: string;
    name: string | null;
    catColor: string | null;
    totalSeconds: number;
    series: FocusSeriesPoint[];
  }[];
  nextCursor: string | null;
  asOf?: string;
};

export type ScreenStatsMe = {
  scope: 'me';
  measurementStatus: MeasurementStatus;
  /** 부분 합계를 전체로 보이지 않게 서버가 null 로 둘 수 있다 — 앱이 null 을 0으로 접지 않는다. */
  totalMinutes: number | null;
  series: ScreenSeriesPoint[];
  updatedAt: string | null;
};

export type ScreenStatsIsland = {
  scope: 'island';
  members: {
    userId: string;
    name: string | null;
    catColor: string | null;
    minutes: number | null;
    measurementStatus: MeasurementStatus;
    series: ScreenSeriesPoint[];
    updatedAt: string | null;
  }[];
};

/** 주민별 누적 물고기 — 전 기간 누적(기간 축 없음), earnedFish 내림차순·동점 userId 오름차순. */
export type FishEarnings = {
  members: { userId: string; name: string | null; earnedFish: number }[];
};

export type LibraryScreen = {
  island: { id: string; name: string; role: string };
  statisticsAvailability: 'available' | 'facility_locked' | null;
  focusStatistics: FocusStatsMe | null;
  screenTimeStatistics: ScreenStatsMe | null;
  fishEarnings: FishEarnings | null;
  /** 아직 서버에 없는 조각 이름 — 앱은 해당 조각을 「준비 중」으로 그리고 빈 값으로 접지 않는다. */
  missingFragments?: string[];
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const nullable = (v: unknown, ok: (x: unknown) => boolean) => v === null || ok(v);

const contractError = (field: string) =>
  new ApiError(CLIENT_CONTRACT_ERROR, `계약과 다른 응답입니다 (${field}).`, 0, { field });

const validFocusSeries = (v: unknown): v is FocusSeriesPoint[] =>
  Array.isArray(v) && v.every((p) => isRecord(p) && isDay(p.date) && isNumber(p.seconds));

const validScreenSeries = (v: unknown): v is ScreenSeriesPoint[] =>
  Array.isArray(v) &&
  v.every(
    (p) =>
      isRecord(p) &&
      isDay(p.date) &&
      nullable(p.minutes, isNumber) &&
      typeof p.measurementStatus === 'string' &&
      MEASUREMENT.has(p.measurementStatus) &&
      nullable(p.updatedAt, (x) => typeof x === 'string'),
  );

const validMember = (m: unknown) =>
  isRecord(m) &&
  typeof m.userId === 'string' &&
  nullable(m.name, (x) => typeof x === 'string') &&
  nullable(m.catColor, (x) => typeof x === 'string');

export function validateFocusStats(raw: unknown): FocusStatsMe | FocusStatsIsland {
  if (!isRecord(raw)) throw contractError('focusStatistics');
  if (raw.scope === 'me') {
    if (!isNumber(raw.totalSeconds)) throw contractError('totalSeconds');
    if (!validFocusSeries(raw.series)) throw contractError('series');
    if (!Array.isArray(raw.records)) throw contractError('records');
    for (const r of raw.records) {
      if (
        !isRecord(r) ||
        typeof r.id !== 'string' ||
        typeof r.subject !== 'string' ||
        !isNumber(r.activeSeconds) ||
        typeof r.completedAt !== 'string'
      ) {
        throw contractError('records');
      }
    }
    if (!nullable(raw.nextCursor, (x) => typeof x === 'string')) {
      throw contractError('nextCursor');
    }
    return raw as unknown as FocusStatsMe;
  }
  if (raw.scope === 'island') {
    if (!Array.isArray(raw.members)) throw contractError('members');
    for (const m of raw.members) {
      if (!validMember(m) || !isNumber(m.totalSeconds) || !validFocusSeries(m.series)) {
        throw contractError('members');
      }
    }
    if (!nullable(raw.nextCursor, (x) => typeof x === 'string')) {
      throw contractError('nextCursor');
    }
    return raw as unknown as FocusStatsIsland;
  }
  throw contractError('scope');
}

export function validateScreenStats(raw: unknown): ScreenStatsMe | ScreenStatsIsland {
  if (!isRecord(raw)) throw contractError('screenTimeStatistics');
  if (raw.scope === 'me') {
    if (typeof raw.measurementStatus !== 'string' || !MEASUREMENT.has(raw.measurementStatus)) {
      throw contractError('measurementStatus');
    }
    if (!nullable(raw.totalMinutes, isNumber)) throw contractError('totalMinutes');
    if (!validScreenSeries(raw.series)) throw contractError('series');
    if (!nullable(raw.updatedAt, (x) => typeof x === 'string')) {
      throw contractError('updatedAt');
    }
    return raw as unknown as ScreenStatsMe;
  }
  if (raw.scope === 'island') {
    if (!Array.isArray(raw.members)) throw contractError('members');
    for (const m of raw.members) {
      if (
        !validMember(m) ||
        !nullable(m.minutes, isNumber) ||
        typeof m.measurementStatus !== 'string' ||
        !MEASUREMENT.has(m.measurementStatus) ||
        !validScreenSeries(m.series) ||
        !nullable(m.updatedAt, (x) => typeof x === 'string')
      ) {
        throw contractError('members');
      }
    }
    return raw as unknown as ScreenStatsIsland;
  }
  throw contractError('scope');
}

function validateFish(raw: unknown): FishEarnings {
  if (!isRecord(raw) || !Array.isArray(raw.members)) throw contractError('fishEarnings');
  for (const m of raw.members) {
    // 이 조각의 멤버는 {userId,name,earnedFish} 뿐이다 — catColor 는 계약에 없다.
    if (
      !isRecord(m) ||
      typeof m.userId !== 'string' ||
      !nullable(m.name, (x) => typeof x === 'string') ||
      !isNumber(m.earnedFish)
    ) {
      throw contractError('fishEarnings.members');
    }
  }
  return raw as unknown as FishEarnings;
}

function validateLibraryScreen(raw: unknown): LibraryScreen {
  if (!isRecord(raw) || !isRecord(raw.island) || typeof raw.island.id !== 'string') {
    throw contractError('island');
  }
  const availability = raw.statisticsAvailability;
  if (availability !== null && availability !== 'available' && availability !== 'facility_locked') {
    throw contractError('statisticsAvailability');
  }
  // 조각은 null(잠김·준비 중)이거나 계약 모양이어야 한다 — 잘못 온 조각을 빈 기록으로 접지 않는다.
  if (raw.focusStatistics !== null) validateFocusStats(raw.focusStatistics);
  if (raw.screenTimeStatistics !== null) validateScreenStats(raw.screenTimeStatistics);
  if (raw.fishEarnings !== null) validateFish(raw.fishEarnings);
  if (raw.missingFragments !== undefined && !Array.isArray(raw.missingFragments)) {
    throw contractError('missingFragments');
  }
  return raw as unknown as LibraryScreen;
}

const query = (params: Record<string, string | undefined>): string =>
  '?' +
  Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&');

/** 도서관 진입 집계 — query 없음. */
export async function getLibraryScreen(): Promise<LibraryScreen> {
  return validateLibraryScreen(await request<unknown>('/screens/library'));
}

export interface StatisticsQuery {
  /** UTC `YYYY-MM-DD`, 양끝 날짜 포함. */
  from: string;
  to: string;
  scope: 'me' | 'island';
  /** scope=me 는 records 쪽, scope=island 는 members 쪽 다음 페이지 커서. */
  cursor?: string;
}

export async function getFocusStatistics(
  islandId: string,
  q: StatisticsQuery & { scope: 'me' },
): Promise<FocusStatsMe>;
export async function getFocusStatistics(
  islandId: string,
  q: StatisticsQuery & { scope: 'island' },
): Promise<FocusStatsIsland>;
export async function getFocusStatistics(islandId: string, q: StatisticsQuery) {
  const raw = await request<unknown>(
    `/islands/${encodeURIComponent(islandId)}/statistics/focus` +
      query({ from: q.from, to: q.to, timezone: 'UTC', scope: q.scope, cursor: q.cursor }),
  );
  const stats = validateFocusStats(raw);
  if (stats.scope !== q.scope) throw contractError('scope');
  return stats;
}

/** 스크린타임 통계 — 이 계약에는 cursor 가 없다(섬 정원 안에서 한 번에 온다). */
export async function getScreenTimeStatistics(
  islandId: string,
  q: StatisticsQuery & { scope: 'me' },
): Promise<ScreenStatsMe>;
export async function getScreenTimeStatistics(
  islandId: string,
  q: StatisticsQuery & { scope: 'island' },
): Promise<ScreenStatsIsland>;
export async function getScreenTimeStatistics(islandId: string, q: StatisticsQuery) {
  const raw = await request<unknown>(
    `/islands/${encodeURIComponent(islandId)}/statistics/screen-time` +
      query({ from: q.from, to: q.to, timezone: 'UTC', scope: q.scope }),
  );
  const stats = validateScreenStats(raw);
  if (stats.scope !== q.scope) throw contractError('scope');
  return stats;
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * 일기장 기간 필터 → 통계 GET 의 `from`·`to`(UTC 날짜, 양끝 포함).
 * `주`는 **UTC 일요일~토요일**이다 — `/screens/library` 가 싣는 이번 주 조각과 같은 축이다
 * (KST·월요일 시작인 `periodBounds` 와 섞지 않는다).
 */
export function utcPeriodRange(
  period: '일' | '주' | '월',
  offset: number,
  at = Date.now(),
): { from: string; to: string } {
  const d = new Date(at);
  const y = d.getUTCFullYear(),
    m = d.getUTCMonth(),
    day = d.getUTCDate();
  if (period === '일') {
    const t = Date.UTC(y, m, day + offset);
    return { from: utcDay(t), to: utcDay(t) };
  }
  if (period === '주') {
    const start = Date.UTC(y, m, day - new Date(Date.UTC(y, m, day)).getUTCDay() + offset * 7);
    return { from: utcDay(start), to: utcDay(start + 6 * 864e5) };
  }
  const start = Date.UTC(y, m + offset, 1);
  return { from: utcDay(start), to: utcDay(Date.UTC(y, m + offset + 1, 0)) };
}
