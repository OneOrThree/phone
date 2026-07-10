// 서버 focus 도메인 DTO 미러 (com.oneorthree.phone.focus.dto).
// 값 단위·의미는 백엔드 기준. 시각(Instant)은 ISO 문자열.
// ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.
import type { Occupation } from '@/types/dto/user';

// GET /tag — 유저별 집중 태그.
export interface FocusTagResponse {
  tagId: string; // UUID
  name: string;
}

// GET /tag/defaults 응답 항목 — occupation별 기본(추천) 태그(과목). tagId 없음(유저 소유 아님).
export interface OccupationDefaultTag {
  name: string;
  sortOrder: number;
}

// GET /tag/defaults 응답 — 조회 기준 occupation + 추천 태그 목록.
export interface OccupationDefaultTagsResponse {
  occupation: Occupation;
  tags: OccupationDefaultTag[];
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
// ⚠️ 서버는 이 4개 필드만 직렬화한다(FocusSessionResponse.java) — subject·distractionCount 없음(리뷰 반영).
export interface FocusSessionResponse {
  focusTagId: string | null; // UUID, 태그 미지정 시 null (user_focus_tags.id — GROMO-673)
  startedAt: string; // Instant, ISO 문자열
  endedAt: string; // Instant, ISO 문자열
  totalDistractionSeconds: number;
}

// GET /focus-session — 커서(keyset) 페이지네이션 응답. 정렬은 UUID v7 id 내림차순(최신순).
export interface FocusSessionSliceResponse {
  content: FocusSessionResponse[];
  size: number;
  hasNext: boolean;
  nextCursor: string | null; // UUID, 마지막 항목 id. hasNext=false 면 null
}
