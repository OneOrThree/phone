// focus 도메인 API 래퍼 (FocusController, base /api/v1).
// 모든 호출은 axios 인스턴스 api(JWT 자동 주입, 401 refresh) 경유. axios는 non-2xx 시 throw.
import { api } from '@/services/api';
import type {
  FocusTagResponse,
  FocusTagSetupRequest,
  FocusTagUpdateRequest,
  FocusSessionRequest,
  FocusSessionResponse,
  FocusSessionSliceResponse,
  OccupationDefaultTagsResponse,
} from '@/types/dto/focus';
import type { Occupation } from '@/types/dto/user';

// GET /api/v1/tag — 유저별 집중 태그 목록 조회.
export async function getFocusTags(): Promise<FocusTagResponse[]> {
  const { data } = await api.get<FocusTagResponse[]>('/api/v1/tag');
  return data;
}

// GET /api/v1/tag/defaults?occupation= — occupation별 기본(추천) 태그(과목) 조회.
// occupation 생략 시 서버가 로그인 유저의 저장 occupation을 사용(미설정이면 400).
export async function getDefaultTags(
  occupation?: Occupation,
): Promise<OccupationDefaultTagsResponse> {
  const { data } = await api.get<OccupationDefaultTagsResponse>('/api/v1/tag/defaults', {
    params: occupation ? { occupation } : undefined,
  });
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

// POST /api/v1/focus-session — 집중 세션 저장.
export async function saveFocusSession(body: FocusSessionRequest): Promise<void> {
  await api.post('/api/v1/focus-session', body);
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

// 기간 내 세션 전량 조회 — 커서를 끝까지 따라간다(서버 필터는 startedAt 기준).
// 페이지 상한은 무한 루프 방지용 — 한 달치 세션이 1,000건을 넘을 일은 없다(재로그인 복원·통계 공용).
export async function getAllFocusSessions(
  from: string,
  to: string,
): Promise<FocusSessionResponse[]> {
  const all: FocusSessionResponse[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const slice = await getFocusSessions(from, to, 100, cursor);
    all.push(...slice.content);
    if (!slice.hasNext || !slice.nextCursor) break;
    cursor = slice.nextCursor;
  }
  return all;
}
