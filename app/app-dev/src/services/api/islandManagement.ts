/**
 * 섬 관리·주민 도메인 모듈(GROMO-2008). 방장 관리 표면 — 공개 business-api 의 무접두 경로만 부른다.
 *
 * 계약(섬 관리 LLD §3 + 공개 controller 정본):
 *  - `GET    /islands/{islandId}`                            섬 재조회 — 주민이면 상세. 저장·승인·
 *                                                            위임 성공 뒤 화면을 확정하는 정본이다.
 *  - `PATCH  /islands/{islandId}`                            정보 수정. `Idempotency-Key` 필수.
 *                                                            부분 수정 — 키 누락은 미변경, 명시 null 은
 *                                                            400. 허용 키는 name/intro/approvalRequired/
 *                                                            maxMembers(정수 1~15, GROMO-1993)뿐이다.
 *  - `GET    /islands/{islandId}/members?cursor&limit`       주민 목록 — 기본 30, 1~100.
 *  - `GET    /islands/{islandId}/join-requests?cursor&limit` 방장 전용 pending 신청 목록.
 *  - `PATCH  /islands/{islandId}/join-requests/{requestId}`  승인·거절. 키 필수, 본문 정확히 {decision}.
 *  - `DELETE /islands/{islandId}/members/{userId}`           강퇴. 키 필수, 본문 없음.
 *  - `POST   /islands/{islandId}/host-transfer`              방장 위임. 키 필수, 본문 정확히
 *                                                            {targetUserId}, query 없음.
 *
 * 쓰기 의도마다 `Idempotency-Key` 를 한 번 만든다 — 응답 유실·retryable 재시도는 같은 키와 같은 body
 * 로 보낸다. 어댑터가 기본값을 만들면 유실 재호출 때 키가 바뀌어 멱등이 깨지므로 필수 인자다.
 * `expectedVersion` 은 공개 계약에 없다 — 이 7종에 만들지 않는다. 403/409 는 호출부가 재조회로
 * 풀며 어댑터가 성공으로 바꾸지 않는다.
 */
import { request } from './client';
import type { IslandDetail } from './islands';

/** `GET /islands/{islandId}` 의 주민 상세 — islands.ts 의 같은 계약 타입을 재사용한다. */
export type ManagedIsland = IslandDetail;

/** `PATCH /islands/{islandId}` 결과 — 공개 `IslandManaged` 와 같은 모양이다. */
export type IslandManaged = {
  id: string;
  name: string;
  intro: string;
  approvalRequired: boolean;
  maxMembers: number;
  version: number;
};

/** 부분 수정 입력 — 허용 키만. `expectedVersion`·`password` 등 계약 밖 키는 타입이 막는다. */
export type ManageIslandPatch = {
  /** 최대 50자, blank 불가. */
  name?: string;
  /** 최대 200자. 빈 문자열로 지운다 — 명시 null 은 계약 위반이라 undefined 로만 생략한다. */
  intro?: string;
  approvalRequired?: boolean;
  /** 주민 정원 1~15. 현재 주민 수 아래로는 서버가 거절한다(field=maxMembers). */
  maxMembers?: number;
};

/** 개인 외양 스냅샷 — 공개 `PersonalAppearanceState` 와 같은 모양(GROMO-1783). */
export type PersonalAppearanceState = {
  clothes: string | null;
  decor: string | null;
  hull: string;
  position: string;
  version: number;
};

export type IslandMember = {
  /** 사용자 ID. */
  id: string;
  /** 미설정 null. */
  name: string | null;
  /** 고양이 색(계정 Q03) — 미선택 null. */
  catColor: string | null;
  role: string;
  appearance: PersonalAppearanceState;
};

/** 주민 목록 한 페이지 — `version` 은 주민/역할 목록 축이고 같은 snapshot 읽기다. */
export type IslandMembersPage = {
  items: IslandMember[];
  nextCursor: string | null;
  version: number;
};

/** 방장의 pending 신청 한 건 — `version` 은 그 요청 자원 축이다. */
export type IslandJoinRequestItem = {
  id: string;
  applicantId: string;
  name: string | null;
  status: 'pending';
  version: number;
};

export type IslandJoinRequestsPage = {
  items: IslandJoinRequestItem[];
  nextCursor: string | null;
};

/** 승인·거절 결과 — 거절의 `memberId` 는 계약상 명시 null 이라 키가 항상 있다. */
export type JoinRequestAnswer = {
  status: 'approved' | 'rejected';
  memberId: string | null;
  version: number;
};

/** 정의된 값만 query 로 붙인다. 값은 항상 인코딩한다. */
const query = (params: Record<string, string | number | undefined>): string => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  return entries.length
    ? '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')
    : '';
};

/**
 * 관리 화면용 섬 재조회 — PATCH·승인·위임의 응답만으로 로컬 상태를 확정하지 않고 이 호출로 읽는다.
 * 비소속·방문자에게는 상세가 아니라 공개 요약이 오므로 방장 관리 경로에서만 부른다.
 */
export function getManagedIsland(islandId: string): Promise<ManagedIsland> {
  return request<ManagedIsland>(`/islands/${encodeURIComponent(islandId)}`);
}

export function manageIsland(
  islandId: string,
  patch: ManageIslandPatch,
  idempotencyKey: string,
): Promise<IslandManaged> {
  return request<IslandManaged>(`/islands/${encodeURIComponent(islandId)}`, {
    method: 'PATCH',
    idempotencyKey,
    body: patch,
  });
}

export function islandMembers(
  islandId: string,
  { cursor, limit }: { cursor?: string; limit?: number } = {},
): Promise<IslandMembersPage> {
  return request<IslandMembersPage>(
    `/islands/${encodeURIComponent(islandId)}/members${query({ cursor, limit })}`,
  );
}

export function islandJoinRequests(
  islandId: string,
  { cursor, limit }: { cursor?: string; limit?: number } = {},
): Promise<IslandJoinRequestsPage> {
  return request<IslandJoinRequestsPage>(
    `/islands/${encodeURIComponent(islandId)}/join-requests${query({ cursor, limit })}`,
  );
}

/** 승인은 membership 생성까지 서버가 한 TX로 묶는다 — 성공 뒤 호출부는 신청·주민 목록을 재조회한다. */
export function answerIslandJoinRequest(
  islandId: string,
  requestId: string,
  decision: 'approve' | 'reject',
  idempotencyKey: string,
): Promise<JoinRequestAnswer> {
  return request<JoinRequestAnswer>(
    `/islands/${encodeURIComponent(islandId)}/join-requests/${encodeURIComponent(requestId)}`,
    { method: 'PATCH', idempotencyKey, body: { decision } },
  );
}

export function kickIslandMember(
  islandId: string,
  userId: string,
  idempotencyKey: string,
): Promise<{ removed: true }> {
  return request(`/islands/${encodeURIComponent(islandId)}/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    idempotencyKey,
  });
}

/** 현재 host 가 본인 아닌 동일 섬 active 주민에게만 위임한다 — 성공 뒤 역할은 재조회로 확정한다. */
export function transferIslandHost(
  islandId: string,
  targetUserId: string,
  idempotencyKey: string,
): Promise<{ hostUserId: string; version: number }> {
  return request(`/islands/${encodeURIComponent(islandId)}/host-transfer`, {
    method: 'POST',
    idempotencyKey,
    body: { targetUserId },
  });
}
