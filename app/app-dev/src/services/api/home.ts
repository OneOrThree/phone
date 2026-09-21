/**
 * 홈 화면 도메인 모듈(GROMO-2007). 공개 business-api 의 무접두 경로만 부른다.
 *
 * 계약(동결표):
 *  - `GET    /screens/home?date&timezone`              홈 원자 조회 — 조각이 모두 필수다.
 *  - `GET    /islands/{islandId}/construction-options` 미완공 건물만 `items` 에 온다.
 *  - `GET    /islands/{islandId}/members?cursor&limit` 주민 한 페이지 — `nextCursor` 가 오면
 *                                                      호출부가 같은 API 로 끝까지 잇는다.
 *  - `PUT    /me/current-island`                       현재 섬 이동. `Idempotency-Key` 필수.
 *  - `DELETE /islands/{islandId}/memberships/me`       나가기. `Idempotency-Key` 필수, 본문 없음.
 *
 * 지갑 두 축을 섞지 않는다 — `home.wallets.fish` 는 개인 물고기, `wallets.villagePoints` 와
 * options 의 `villagePoints` 는 같은 **섬 공동 통장**이지만 별도 HTTP 스냅샷이라 서로 덮어쓰거나
 * 합산하지 않는다.
 */
import { ApiError, request, RequestOptions } from './client';

/** 서버 응답이 공개 계약과 다르다 — 모르는 건물·빠진 필드를 지어내지 않고 이 코드로 실패한다. */
export const CLIENT_CONTRACT_ERROR = 'CLIENT_CONTRACT_ERROR';

/** 서버가 고정한 건물 ID 7개 — options.items 의 허용 집합이자 완공 complement 의 모집합이다. */
export const CANONICAL_BUILDINGS = [
  'hall',
  'board',
  'gram',
  'library',
  'mail',
  'tower',
  'shop',
] as const;
export type BuildingId = (typeof CANONICAL_BUILDINGS)[number];

export type HomeIsland = {
  id: string;
  name: string;
  intro: string;
  visibility: string;
  approvalRequired: boolean;
  memberCount: number;
  maxMembers: number;
  membershipStatus: string;
  growthStage: string | null;
  themeId: string | null;
  role: 'host' | 'member';
  version: number;
};

export type FocusSummary = {
  date: string;
  completedSeconds: number;
  currentSessionSecondsToday: number;
  totalSeconds: number;
  serverNow: string;
};

export type FocusSession = {
  id: string;
  islandId: string;
  subject: string;
  targetMinutes: number | null;
  status: 'active' | 'paused';
  activeSeconds: number;
  serverNow: string;
  startedAt: string;
  restStartedAt: string | null;
  version: number;
};

export type MemberWatermark = {
  projection: string;
  islandId: string;
  aggregateId: string;
  version: number;
};

export type RestMembers = {
  items: {
    userId: string;
    name: string | null;
    restSeat: number;
    restStartedAt: string;
  }[];
  serverNow: string;
  watermarks: MemberWatermark[];
};

export type HomeWallets = {
  /** 개인 물고기 — 공동 통장과 다른 축이다. */
  fish: number;
  /** 섬 공동 통장 잔액 — 개인 fish·local contribution 과 합산하지 않는다. */
  villagePoints: number;
  fishVersion: number | null;
  villagePointsVersion: number;
};

export type Playback = {
  trackId: string | null;
  playing: boolean;
  positionSeconds: number;
  effectiveAt: string;
  changedBy: string | null;
  version: number;
  serverNow: string;
  durationSeconds: number | null;
};

export type HomeScreen = {
  island: HomeIsland;
  focusSummary: FocusSummary;
  session: FocusSession | null;
  restMembers: RestMembers;
  wallets: HomeWallets;
  playback: Playback | null;
  playbackAvailability: 'available' | 'facility_locked';
};

export type ConstructionItem = {
  id: BuildingId;
  name: string;
  cost: number;
  currency: string;
  selectable: boolean;
  buildable: boolean;
  blockedReason: string | null;
};

export type ConstructionOptions = {
  islandVersion: number;
  costPolicyVersion: number;
  /** 진행 목표일 뿐 완공 판정에 쓰지 않는다. */
  selectedBuildingId: string | null;
  /** 섬 공동 통장 잔액(별도 스냅샷) — home.wallets.villagePoints 를 이 값으로 덮어쓰지 않는다. */
  villagePoints: number;
  walletVersion: number;
  /** **미완공** 건물만 온다(공사 중 포함) — 완공 목록은 {@link completedBuildings} 가 뺀다. */
  items: ConstructionItem[];
};

export type IslandMember = {
  id: string;
  name: string | null;
  /** null 은 미선택이다 — 임의 색으로 대체하지 않는다. */
  catColor: string | null;
  role: string;
  appearance: unknown;
};

export type MembersPage = {
  items: IslandMember[];
  nextCursor: string | null;
  version: number;
};

const CANONICAL = new Set<string>(CANONICAL_BUILDINGS);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const contractError = (field: string) =>
  new ApiError(CLIENT_CONTRACT_ERROR, `계약과 다른 응답입니다 (${field}).`, 0, { field });

/**
 * 공개 `ConstructionOptions` 는 item ID 의 집합·중복을 스스로 검증하지 않으므로 앱이 건다.
 * 모르는 ID·중복·빠진 필수 필드를 기본 건물로 보완하면 완공 complement 가 오염된다 — 실패가 답이다.
 */
function validateOptions(raw: unknown): ConstructionOptions {
  if (!isRecord(raw)) throw contractError('constructionOptions');
  const {
    islandVersion,
    costPolicyVersion,
    selectedBuildingId,
    villagePoints,
    walletVersion,
    items,
  } = raw;
  if (!isNumber(islandVersion)) throw contractError('islandVersion');
  if (!isNumber(costPolicyVersion)) throw contractError('costPolicyVersion');
  if (selectedBuildingId !== null && typeof selectedBuildingId !== 'string') {
    throw contractError('selectedBuildingId');
  }
  if (!isNumber(villagePoints)) throw contractError('villagePoints');
  if (!isNumber(walletVersion)) throw contractError('walletVersion');
  if (!Array.isArray(items)) throw contractError('items');
  const seen = new Set<string>();
  for (const item of items) {
    if (!isRecord(item)) throw contractError('items');
    const { id, name, cost, currency, selectable, buildable, blockedReason } = item;
    if (typeof id !== 'string' || !CANONICAL.has(id) || seen.has(id)) {
      throw contractError('items.id');
    }
    seen.add(id);
    if (typeof name !== 'string') throw contractError('items.name');
    if (!isNumber(cost)) throw contractError('items.cost');
    if (typeof currency !== 'string') throw contractError('items.currency');
    if (typeof selectable !== 'boolean' || typeof buildable !== 'boolean') {
      throw contractError('items.selectable');
    }
    if (blockedReason !== null && typeof blockedReason !== 'string') {
      throw contractError('items.blockedReason');
    }
  }
  return raw as unknown as ConstructionOptions;
}

/** `canonical7 − items[].id` = 정확한 완공 건물. items 가 비면 7개 모두 완공이다. */
export function completedBuildings(options: ConstructionOptions): BuildingId[] {
  const pending = new Set(options.items.map((item) => item.id));
  return CANONICAL_BUILDINGS.filter((id) => !pending.has(id));
}

/** 정의된 값만 query 로 붙인다. 값은 항상 인코딩한다. */
const query = (params: Record<string, string | number | undefined>): string => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  return entries.length
    ? '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')
    : '';
};

/** 홈 원자 조회 — `date` 는 `YYYY-MM-DD`, `timezone` 은 IANA(예 `Asia/Seoul`). */
export function getHome(date: string, timezone: string): Promise<HomeScreen> {
  return request<HomeScreen>(`/screens/home${query({ date, timezone })}`);
}

export async function getConstructionOptions(islandId: string): Promise<ConstructionOptions> {
  const raw = await request<unknown>(
    `/islands/${encodeURIComponent(islandId)}/construction-options`,
  );
  return validateOptions(raw);
}

/**
 * 주민 한 페이지. 섬 정원(15)보다 큰 limit 이라 현재 계약에서는 한 쪽이 전체 주민이지만,
 * `nextCursor` 가 오면 그대로 다시 불러 끝까지 잇는다 — 일부 쪽을 전체로 표시하지 않는다.
 */
export function getMembers(islandId: string, cursor?: string): Promise<MembersPage> {
  return request<MembersPage>(
    `/islands/${encodeURIComponent(islandId)}/members${query({ cursor, limit: 100 })}`,
  );
}

/**
 * 현재 섬 이동. 응답 유실·재시도는 **같은 `idempotencyKey` 와 같은 body** 로 보낸다 —
 * 키는 호출부가 의도당 한 번 만든다. 성공 뒤 `/me/islands`·홈 조합을 재조회하기 전에는
 * 화면 current 를 확정하지 않는다.
 */
export function switchCurrentIsland(
  islandId: string,
  idempotencyKey: string,
): Promise<{ currentIslandId: string }> {
  return request('/me/current-island', {
    // 공개 계약은 PUT 이지만 공통 client 의 method union 에 아직 없다 — write set 밖이라 여기서 넓힌다.
    method: 'PUT' as string as RequestOptions['method'],
    idempotencyKey,
    body: { islandId },
  });
}

/** 본인 나가기 — 본문 없음. 성공 뒤 `/me/islands` 를 재조회한다. */
export function leaveIsland(islandId: string, idempotencyKey: string): Promise<{ left: boolean }> {
  return request(`/islands/${encodeURIComponent(islandId)}/memberships/me`, {
    method: 'DELETE',
    idempotencyKey,
  });
}
