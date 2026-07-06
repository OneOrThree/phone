// 서버 focus 도메인 DTO 미러 (com.oneorthree.phone.focus.dto).
// 값 단위·의미는 백엔드 기준. 시각(Instant)은 ISO 문자열.
// ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.

// GET /tag — 유저별 집중 태그.
export interface FocusTagResponse {
  tagId: string; // UUID
  name: string;
}

// POST /tag — 태그 초기 등록 요청.
export interface FocusTagSetupRequest {
  name: string;
}

// PATCH /tag — 태그 수정 요청.
export interface FocusTagUpdateRequest {
  tagId: string; // UUID
  name: string;
}

// POST /focus-session — 집중 세션 저장 요청.
export interface FocusSessionRequest {
  focusTagId: string | null; // UUID, 태그 미지정 시 null
  subject: string;
  startedAt: string; // Instant, ISO 문자열
  endedAt: string; // Instant, ISO 문자열
  distractionCount: number;
  totalDistractionSeconds: number;
}

// GET /focus-session content 항목 — 집중 세션 단건.
export interface FocusSessionResponse {
  focusTagId: string | null; // UUID, 태그 미지정 시 null
  subject: string;
  startedAt: string; // Instant, ISO 문자열
  endedAt: string; // Instant, ISO 문자열
  distractionCount: number;
  totalDistractionSeconds: number;
}

// GET /focus-session — 커서(keyset) 페이지네이션 응답. 정렬은 UUID v7 id 내림차순(최신순).
export interface FocusSessionSliceResponse {
  content: FocusSessionResponse[];
  size: number;
  hasNext: boolean;
  nextCursor: string | null; // UUID, 마지막 항목 id. hasNext=false 면 null
}

// GET /tag/defaults — 직군(occupation)별 기본(추천) 태그. 유저 소유 태그가 아니라 tagId 없음 —
// 선택 시 name을 POST /tag 로 넘겨 실제 태그를 생성한다.
export interface OccupationDefaultTagResponse {
  name: string;
  sortOrder: number; // 노출 순서(오름차순, 응답은 이미 정렬됨)
}
export interface OccupationDefaultTagsResponse {
  occupation: string; // Occupation enum 이름
  tags: OccupationDefaultTagResponse[];
}

// POST /focus-session/start — 라이브 세션 시작(startedAt만 기록, endedAt NULL) 요청/응답.
// 통계·스트릭은 종료(PATCH) 시점에 귀속된다.
export interface FocusSessionStartRequest {
  focusTagId: string | null; // UUID, 태그 미지정 시 null
  subject: string | null;
  startedAt: string | null; // Instant, 생략 시 서버 수신 시각
}
export interface FocusSessionStartResponse {
  sessionId: string; // UUID — PATCH /focus-session 종료 시 참조
  startedAt: string; // Instant
}

// PATCH /focus-session — 진행 중 세션에 종료 시각을 채워 완료 처리. 이미 종료된 세션 재요청은 409.
export interface FocusSessionEndRequest {
  sessionId: string; // UUID, 필수
  endedAt: string | null; // Instant, 생략(null) 시 서버 수신 시각
  distractionCount: number;
  totalDistractionSeconds: number;
  focusTagId: string | null; // 시작 시 미지정분 보정용(선택)
}
export interface FocusSessionEndResponse {
  sessionId: string; // UUID
  startedAt: string; // Instant
  endedAt: string; // Instant
  durationSeconds: number;
  distractionCount: number;
  totalDistractionSeconds: number;
}
