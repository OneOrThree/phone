// focus 도메인 API 래퍼 (FocusController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
import { api } from '@/services/api';
import type {
  FocusTagResponse,
  FocusTagSetupRequest,
  FocusTagUpdateRequest,
  FocusSessionRequest,
  FocusSessionSliceResponse,
  OccupationDefaultTagsResponse,
  FocusSessionStartRequest,
  FocusSessionStartResponse,
  FocusSessionEndRequest,
  FocusSessionEndResponse,
} from '@/types/dto/focus';
import type { Occupation } from '@/types/dto/user';

// GET /api/v1/tag — 유저별 집중 태그 목록 조회.
export async function getFocusTags(): Promise<FocusTagResponse[]> {
  const { data } = await api.get<FocusTagResponse[]>('/api/v1/tag');
  return data;
}

// POST /api/v1/tag — 태그 초기 등록.
export async function setupFocusTag(body: FocusTagSetupRequest): Promise<void> {
  await api.post('/api/v1/tag', body);
}

// PATCH /api/v1/tag — 태그 수정.
export async function updateFocusTag(body: FocusTagUpdateRequest): Promise<void> {
  await api.patch('/api/v1/tag', body);
}

// DELETE /api/v1/tag/{tagId} — 태그 삭제.
export async function deleteFocusTag(tagId: string): Promise<void> {
  await api.delete(`/api/v1/tag/${tagId}`);
}

// GET /api/v1/tag/defaults?occupation — 직군별 기본(추천) 태그 조회 (GROMO-607).
// occupation 생략 시 서버가 유저 저장 occupation 사용(미설정이면 400).
export async function getDefaultTags(
  occupation?: Occupation,
): Promise<OccupationDefaultTagsResponse> {
  const { data } = await api.get<OccupationDefaultTagsResponse>('/api/v1/tag/defaults', {
    params: { occupation },
  });
  return data;
}

// POST /api/v1/focus-session — 완료된 집중 세션 통저장.
export async function saveFocusSession(body: FocusSessionRequest): Promise<void> {
  await api.post('/api/v1/focus-session', body);
}

// POST /api/v1/focus-session/start — 라이브 세션 시작 (GROMO-610).
// startedAt만 기록된 진행 중 세션을 만들고 sessionId를 돌려받는다 — 친구 화면 isFocusing의 근거.
export async function startFocusSession(
  body: FocusSessionStartRequest,
): Promise<FocusSessionStartResponse> {
  const { data } = await api.post<FocusSessionStartResponse>('/api/v1/focus-session/start', body);
  return data;
}

// PATCH /api/v1/focus-session — 라이브 세션 종료 (GROMO-610).
// 통계·스트릭은 이 시점에 귀속. 이미 종료된 세션 재요청은 409 — 재시도 시 멱등 처리용으로 분기.
export async function endFocusSession(
  body: FocusSessionEndRequest,
): Promise<FocusSessionEndResponse> {
  const { data } = await api.patch<FocusSessionEndResponse>('/api/v1/focus-session', body);
  return data;
}

// GET /api/v1/focus-session?from&to&cursor?&size — 기간 필터 + 커서(keyset) 페이지네이션 조회.
// from/to는 UTC Instant(ISO 문자열, 필수), cursor 생략 시 첫 페이지, size 필수.
export async function getFocusSessions(
  from: string,
  to: string,
  size: number,
  cursor?: string,
): Promise<FocusSessionSliceResponse> {
  const { data } = await api.get<FocusSessionSliceResponse>('/api/v1/focus-session', {
    params: { from, to, cursor, size },
  });
  return data;
}
