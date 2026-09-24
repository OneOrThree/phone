/**
 * 섬 도메인 모듈(GROMO-2006). 공개 business-api 의 무접두 경로만 부른다 —
 * `/internal/**`·`/api/v1/**`·data-api 직접 호출은 범위 밖이다.
 *
 * 계약(동결표):
 *  - `POST   /islands`                          섬 만들기. `Idempotency-Key`(UUID36) 필수.
 *  - `GET    /screens/explore?q=`               첫 발견(미소속: q 무시하고 discover 1건) ·
 *                                               소속 후 이름 검색 첫 페이지.
 *  - `GET    /islands/discover?cursor&limit`    첫 소속 발견의 다음 후보 페이지(기본 limit 1).
 *  - `GET    /islands?q&cursor&limit`           이름 검색 — 전망대 완공이 필요한 소속 후 기능.
 *                                               첫 소속 전 대체 경로로 쓰지 않는다.
 *  - `GET    /screens/visit/{islandId}`         방문 화면(공개 요약 + 주민 + 내 신청 상태).
 *  - `POST   /islands/{islandId}/memberships`   가입·가입 신청. `Idempotency-Key` 필수.
 *  - `GET    /me/join-requests`                 내 pending 신청 목록(재실행 복구용).
 *  - `GET    /me/join-requests/{requestId}`     신청 상태(종결된 것도 조회된다).
 *  - `DELETE /me/join-requests/{requestId}`     신청 취소. `Idempotency-Key` 필수.
 *  - `POST   /invitations/resolve`              초대 코드 해석. 조회 성격이라 멱등 키 없음.
 *  - `GET    /me/islands`                       내 섬 재조회 — 생성·가입·승인·재실행의 정본.
 *
 * 쓰기 의도마다 `Idempotency-Key` 를 한 번 만든다 — 응답 유실·retryable 재시도는 **같은 키와
 * 같은 body** 로 보낸다. 키는 호출부가 의도당 한 번 만들어 넘긴다. 어댑터가 기본값을 만들면
 * 유실 재호출 때 키가 바뀌어 멱등이 깨지므로 필수 인자다.
 */
import { request } from './client';

export type IslandSummary = {
  id: string;
  name: string;
  intro: string;
  visibility: string;
  approvalRequired: boolean;
  memberCount: number;
  maxMembers: number;
  membershipStatus: string;
  joinRequestId: string | null;
  growthStage: string | null;
  themeId: string | null;
};

export type IslandDetail = Omit<IslandSummary, 'joinRequestId'> & {
  role: string;
  version: number;
};

export type IslandPage = { items: IslandSummary[]; nextCursor: string | null };

export type MyIslands = {
  items: IslandSummary[];
  nextCursor: null;
  currentIslandId: string | null;
  lossReason: 'LEFT' | 'KICKED' | null;
};

export type IslandCreated = {
  id: string;
  membershipStatus: string;
  role: string;
  currentIslandId: string;
};

export type JoinIslandResult = {
  status: 'active' | 'pending';
  requestId: string | null;
  islandId: string;
  currentIslandId: string | null;
  version: number;
};

export type JoinRequestStatus = {
  id: string;
  islandId: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  version: number;
};

export type MyJoinRequest = JoinRequestStatus & {
  islandName: string | null;
  memberCount: number;
  maxMembers: number;
  createdAt: string;
};

export type ExploreScreen = {
  memberships: MyIslands;
  islands: IslandPage;
};

export type VisitScreen = {
  island: IslandSummary;
  members: {
    items: {
      id: string;
      name: string | null;
      catColor: string | null;
      role: string;
      appearance: unknown;
    }[];
    nextCursor: string | null;
    version: number;
  };
  joinRequestAvailability: 'available' | 'none';
  joinRequest: JoinRequestStatus | null;
};

export type CreateIslandInput = {
  /** 필수, blank 불가, 최대 50자. */
  name: string;
  /** 선택, 최대 200자. 명시적 null 은 계약 위반이라 undefined 로만 생략한다. */
  intro?: string;
  approvalRequired: boolean;
  /** 선택 정수 1~15. 생략하면 서버 기본 15. */
  maxMembers?: number;
};

/** 정의된 값만 query 로 붙인다. 값은 항상 인코딩한다. */
const query = (params: Record<string, string | number | undefined>): string => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  return entries.length
    ? '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')
    : '';
};

/** 성공 뒤 호출부는 `/me/islands` 를 재조회해 소속과 current 를 확정한다(응답만으로 로컬 섬을 만들지 않는다). */
export function createIsland(
  input: CreateIslandInput,
  idempotencyKey: string,
): Promise<IslandCreated> {
  return request<IslandCreated>('/islands', {
    method: 'POST',
    idempotencyKey,
    body: input,
  });
}

/**
 * 첫 섬 찾기 화면. 미소속이면 서버가 `q` 를 무시하고 발견 1건을 준다 — 첫 소속 전 이름 검색은
 * 계약에 없으므로 q 는 소속 후 검색에서만 넘긴다.
 */
export function explore(q?: string): Promise<ExploreScreen> {
  return request<ExploreScreen>(`/screens/explore${query({ q })}`);
}

/** 첫 소속 발견의 다음 후보. 검색어·필터가 바뀌면 cursor 를 버리고 첫 페이지부터다. */
export function discoverIslands({
  cursor,
  limit,
}: { cursor?: string; limit?: number } = {}): Promise<IslandPage> {
  return request<IslandPage>(`/islands/discover${query({ cursor, limit })}`);
}

/** 소속 후 이름 검색(전망대 필요). `FACILITY_LOCKED` 를 첫 발견으로 몰래 대체하지 않는다. */
export function searchIslands(
  q: string,
  { cursor, limit }: { cursor?: string; limit?: number } = {},
): Promise<IslandPage> {
  return request<IslandPage>(`/islands${query({ q, cursor, limit })}`);
}

export function visitIsland(islandId: string): Promise<VisitScreen> {
  return request<VisitScreen>(`/screens/visit/${encodeURIComponent(islandId)}`);
}

/**
 * 가입 또는 가입 신청. `invitationToken` 은 초대 resolve 응답을 변형·저장 없이 그대로 넘긴다.
 * `active` 면 `/me/islands` 재조회 뒤 도착으로, `pending` 이면 current 를 바꾸지 않는다.
 */
export function joinIsland(
  islandId: string,
  { idempotencyKey, invitationToken }: { idempotencyKey: string; invitationToken?: string },
): Promise<JoinIslandResult> {
  return request<JoinIslandResult>(`/islands/${encodeURIComponent(islandId)}/memberships`, {
    method: 'POST',
    idempotencyKey,
    body: invitationToken === undefined ? {} : { invitationToken },
  });
}

/** 내 pending 신청 목록 — 재실행 시 로컬에 신청 ID 가 없어도 pending 화면을 복구한다. */
export function myJoinRequests({
  cursor,
  limit,
}: { cursor?: string; limit?: number } = {}): Promise<{
  items: MyJoinRequest[];
  nextCursor: string | null;
}> {
  return request(`/me/join-requests${query({ cursor, limit })}`);
}

/** 종결된 요청도 조회된다 — approved 면 `/me/islands` 재조회로 실제 소속을 확정한다. */
export function joinRequest(requestId: string): Promise<JoinRequestStatus> {
  return request<JoinRequestStatus>(`/me/join-requests/${encodeURIComponent(requestId)}`);
}

export function cancelJoinRequest(
  requestId: string,
  idempotencyKey: string,
): Promise<{ id: string; status: 'cancelled' }> {
  return request(`/me/join-requests/${encodeURIComponent(requestId)}`, {
    method: 'DELETE',
    idempotencyKey,
  });
}

/** 초대 코드 해석. 조회 성격이라 `Idempotency-Key` 를 보내지 않는다. 성공만으로 가입하지 않는다. */
export function resolveInvitation(
  code: string,
): Promise<{ island: IslandSummary; invitationToken: string }> {
  return request('/invitations/resolve', { method: 'POST', body: { code } });
}

/** 내 섬 정본 — `currentIslandId` 가 null 이면 소속이 없을 수 있다. */
export function myIslands(): Promise<MyIslands> {
  return request<MyIslands>('/me/islands');
}

/**
 * 섬 주민 집중/휴식 스냅숏 (GROMO-2010).
 *
 * STOMP 이벤트에는 이름·고양이 색 같은 프로필이 없어 주민 전체 모습은 이 응답이 정본이다.
 * `watermarks` 는 프로젝션별 최신 버전으로 이벤트 중복·역순 방어의 기준선이 된다 —
 * 없는 key 는 프로젝션에서 버리고 정본 재조회로 복구한다.
 */
export type FocusMember = {
  userId: string;
  name: string | null;
  catColor: string | null;
  appearance: unknown;
  sessionId: string;
  subject: string;
  activeSeconds: number;
  status: 'active' | 'paused';
};

export type RestMember = {
  userId: string;
  name: string | null;
  catColor: string | null;
  restSeat: number | null;
  restStartedAt: string | null;
};

export type ProjectionWatermark = {
  projection: 'focus.member' | 'rest.member';
  islandId: string;
  aggregateId: string;
  version: number;
};

export type MembersSnapshot<T> = {
  items: T[];
  serverNow: string;
  watermarks?: ProjectionWatermark[];
};

export function focusMembers(islandId: string): Promise<MembersSnapshot<FocusMember>> {
  return request(`/islands/${encodeURIComponent(islandId)}/focus-members`);
}

export function restMembers(islandId: string): Promise<MembersSnapshot<RestMember>> {
  return request(`/islands/${encodeURIComponent(islandId)}/rest-members`);
}
