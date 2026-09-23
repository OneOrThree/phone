/**
 * 주간 섬 랭킹 조회 (GROMO-2018 — island-rankings 공개 계약, 서버 GROMO-1997).
 *
 *  - `GET /rankings/islands?week=YYYY-MM-DD&limit=` — `week` 는 필수이고 **UTC 일요일 주 시작일**
 *    이다(ISO `YYYY-Www` 가 아니다 — ISO 주차는 월요일 시작이라 다른 7일을 가리킨다).
 *    일요일이 아니거나 아직 오지 않은 주는 422 `OUT_OF_RANGE`(field=week).
 *  - 응답 `items[{rank,islandId,name,averageFocusSeconds}]` — `rank` 는 서버 `RANK()` 값 그대로다.
 *    동점은 공동 순위(1,1,3)라 앱이 순번을 다시 매기지 않는다. 표시 순서도 서버가 정한다
 *    (평균 DESC, islandId ASC) — 재정렬하지 않는다.
 *  - `myRank` 는 전체 모집단 기준 순위다 — 목록 상위 `limit` 에 우리 섬이 없어도 온다.
 *    참가하지 않는 섬(그 주 집중 0·분모 결손)은 `null` 이고, 앱이 0위를 지어내지 않는다.
 *  - 이 계약에는 페이지가 없다 — `nextCursor` 는 언제나 `null` 이고 cursor 를 보내지 않는다.
 */
import { ApiError, request } from './client';
import { CLIENT_CONTRACT_ERROR } from './home';

export type IslandRankItem = {
  rank: number;
  islandId: string;
  name: string;
  averageFocusSeconds: number;
};

export type IslandRankings = {
  items: IslandRankItem[];
  myRank: number | null;
  nextCursor: string | null;
  /** 집계를 고정한 UTC instant — items·myRank·분모가 모두 이 한 관측에서 나온다. */
  asOf: string;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => Number.isInteger(v);

const contractError = (field: string) =>
  new ApiError(CLIENT_CONTRACT_ERROR, `계약과 다른 응답입니다 (${field}).`, 0, { field });

function validateRankings(raw: unknown): IslandRankings {
  if (!isRecord(raw) || !Array.isArray(raw.items)) throw contractError('items');
  for (const item of raw.items) {
    if (
      !isRecord(item) ||
      !isInt(item.rank) ||
      item.rank < 1 ||
      typeof item.islandId !== 'string' ||
      typeof item.name !== 'string' ||
      !isInt(item.averageFocusSeconds) ||
      item.averageFocusSeconds < 0
    ) {
      throw contractError('items');
    }
  }
  if (raw.myRank !== null && !isInt(raw.myRank)) throw contractError('myRank');
  if (typeof raw.asOf !== 'string') throw contractError('asOf');
  return raw as unknown as IslandRankings;
}

/**
 * `at` 이 속한 주의 시작일 `YYYY-MM-DD` — **가장 최근 UTC 일요일**(일요일 당일은 그 날).
 * 랭킹 창은 `[weekStart 00:00Z, weekStart+7d 00:00Z)` 다.
 */
export function utcWeekStart(at = Date.now()): string {
  const d = new Date(at);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay());
  return new Date(start).toISOString().slice(0, 10);
}

/** `week` 는 {@link utcWeekStart} 의 UTC 일요일 — 요일·미래 주 판정은 서버(422)가 한다. */
export async function getIslandRankings(query: {
  week: string;
  limit?: number;
}): Promise<IslandRankings> {
  const params = [`week=${encodeURIComponent(query.week)}`];
  if (query.limit !== undefined) params.push(`limit=${encodeURIComponent(query.limit)}`);
  return validateRankings(await request<unknown>(`/rankings/islands?${params.join('&')}`));
}
