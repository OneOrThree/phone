/**
 * 마을회관 화면 집계와 공동 가계부 조회 (GROMO-2011 — business-api 의 GROMO-1786 공개 계약).
 *
 *  - `GET /screens/town-hall`                       회관 진입 집계. `ledger` 조각은 이번 KST 달·무필터
 *                                                   첫 쪽(서버 고정 30개)이고 필수 조각이라 ledger 실패는
 *                                                   화면 전체 실패로 온다 — 앱이 빈 장부로 접지 않는다.
 *  - `GET /islands/{islandId}/resources/ledger`     다음 쪽·다른 달·방향 필터. 공개 query 는
 *                                                   `month`(필수, KST `YYYY-MM`)·`direction`(`earn|spend`)·
 *                                                   `cursor` 셋뿐이다 — `limit`·`timezone` 등 그 밖의 키는
 *                                                   서버가 400 `INVALID_PARAMETER` 로 거절하므로 보내지 않는다.
 *
 * 커서는 사용자·섬·월·방향에 묶인 서명 커서다 — 월이나 방향이 바뀌면 커서를 버리고 첫 쪽부터 다시
 * 받아야 한다(다른 scope 의 커서는 400). 다음 쪽은 응답의 `nextCursor` 를 그대로 넘긴다.
 *
 * 오류는 변환하지 않고 `ApiError` 그대로 던진다 — `items:[]` 는 「그 달에 거래가 없다」는 뜻이고
 * 「못 읽었다」(401/403/네트워크)와 다른 상태라 섞으면 안 된다.
 */
import { request } from './client';

export type IslandDetail = {
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

export type Appearance = {
  clothes: string | null;
  decor: string | null;
  hull: string;
  position: string;
  version: number;
};

export type MembersPage = {
  items: {
    id: string;
    name: string | null;
    catColor: string | null;
    role: string;
    appearance: Appearance;
  }[];
  nextCursor: string | null;
  version: number;
};

export type ConstructionOptions = {
  islandVersion: number;
  costPolicyVersion: number;
  selectedBuildingId: string | null;
  villagePoints: number;
  walletVersion: number;
  items: {
    id: string;
    name: string;
    cost: number;
    currency: string;
    selectable: boolean;
    buildable: boolean;
    blockedReason: string | null;
  }[];
};

export type JoinRequestsPage = {
  items: {
    id: string;
    applicantId: string;
    name: string | null;
    status: string;
    version: number;
  }[];
  nextCursor: string | null;
};

export type Wallets = {
  fish: number;
  villagePoints: number;
  fishVersion: number | null;
  villagePointsVersion: number;
};

/**
 * 가계부 한 줄. `amount` 는 항상 양수이고 방향은 `direction` 이 말한다.
 * 집중 적립(`contribution`)만 KST 하루로 접힌 줄이다 — `entryCount>1` 이면 묶음이고
 * `groupedUntil` 은 그 하루의 마지막 기입 시각이다(접히지 않은 줄도 `entryCount=1`,
 * `groupedUntil=createdAt` 으로 널이 아니다). 거래 주체·줄별 잔액은 계약에 없다.
 */
export type LedgerEntry = {
  id: string;
  direction: 'earn' | 'spend';
  reason: string;
  amount: number;
  createdAt: string;
  groupedUntil: string;
  entryCount: number;
};

/** `earnedTotal`·`spentTotal` 은 그 달 전체의 합 — 방향 필터·페이지와 무관하다. */
export type LedgerPage = {
  month: string;
  earnedTotal: number;
  spentTotal: number;
  items: LedgerEntry[];
  nextCursor: string | null;
};

export type TownHallScreen = {
  island: IslandDetail;
  members: MembersPage;
  constructionOptions: ConstructionOptions;
  /** 일반 주민은 null 이고 `joinRequestsAvailability` 가 `host_only` 다. */
  joinRequests: JoinRequestsPage | null;
  joinRequestsAvailability: 'available' | 'host_only';
  wallets: Wallets;
  ledger: LedgerPage;
};

/** 회관 진입 집계 — query 없음. */
export function getTownHall(): Promise<TownHallScreen> {
  return request<TownHallScreen>('/screens/town-hall');
}

export interface LedgerQuery {
  /** KST 달력 월 `YYYY-MM` — 필수. */
  month: string;
  direction?: 'earn' | 'spend';
  /** 직전 응답의 `nextCursor`. 월·방향이 바뀌면 버린다(scope 가 달라 400). */
  cursor?: string;
}

export function getLedger(islandId: string, query: LedgerQuery): Promise<LedgerPage> {
  const params = [`month=${encodeURIComponent(query.month)}`];
  if (query.direction) params.push(`direction=${encodeURIComponent(query.direction)}`);
  if (query.cursor) params.push(`cursor=${encodeURIComponent(query.cursor)}`);
  return request<LedgerPage>(
    `/islands/${encodeURIComponent(islandId)}/resources/ledger?${params.join('&')}`,
  );
}
