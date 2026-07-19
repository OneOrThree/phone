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
  focusType?: FocusType; // GROMO-733 additive — 미지정 시 서버가 INFINITE 기본(고아 정산 등 모드 미상 경로)
}

// POST /focus-session — 집중 세션 저장 응답(GROMO-806). 세션 반영 후 그날 누적·스트릭 인정 여부.
// 구버전 백엔드는 빈 바디(201)를 주므로 필드가 없을 수 있다 — 사용처에서 유효성 검증 후 반영.
export interface FocusSessionSaveResponse {
  dayTotalFocusSeconds: number; // 이 세션 반영 후 그날 누적 집중 초
  streakQualifiedToday: boolean; // 그날 누적이 스트릭 기준(하루 10분) 이상인지 — 서버 확정 판정
}

// GET /focus-session content 항목 — 집중 세션 단건.
// ⚠️ 서버는 이 4개 필드만 직렬화한다(FocusSessionResponse.java) — subject·distractionCount 없음(리뷰 반영).
export interface FocusSessionResponse {
  focusTagId: string | null; // UUID, 태그 미지정 시 null (user_focus_tags.id — GROMO-673)
  startedAt: string; // Instant, ISO 문자열
  endedAt: string; // Instant, ISO 문자열. ⚠️ 진행 중 세션은 null로 오지만 getAllFocusSessions가 걸러낸다
  totalDistractionSeconds: number;
}

// GET /focus-session — 커서(keyset) 페이지네이션 응답. 정렬은 UUID v7 id 내림차순(최신순).
export interface FocusSessionSliceResponse {
  content: FocusSessionResponse[];
  size: number;
  hasNext: boolean;
  nextCursor: string | null; // UUID, 마지막 항목 id. hasNext=false 면 null
}

// ── 라이브 세션 마커(GROMO-873, 서버 API는 GROMO-610·733) ────────────────
// 시작 시 진행 중(endedAt NULL) 세션을 만든다 — 이 레코드가 친구/리그 isFocusing·
// focusStartedAt·focusTagName 라이브 표시의 원천. 클라 설계상 이 레코드는 '표시용 마커'다:
// 시간 저장·통계는 기존 완주 저장(POST /focus-session)이 담당하고, 마커는 세션 종료 시
// 취소(cancel, 통계 미귀속)로 닫아 이중 집계를 막는다. CANCELED 세션은 목록 조회(GET)에서
// 서버가 제외한다(GROMO-872).

// 서버 FocusType 미러 — 타이머 모드 매핑: countup=INFINITE, countdown=RANGE, pomodoro=POMODORO.
export type FocusType = 'INFINITE' | 'RANGE' | 'POMODORO';

// POST /focus-session/start — 라이브 세션 시작 요청.
export interface FocusSessionStartRequest {
  focusTagId: string | null; // UUID, 태그 미지정 시 null
  startedAt: string; // Instant, ISO 문자열
  focusType: FocusType;
}

// POST /focus-session/start — 시작 응답. sessionId로 이후 취소를 참조한다.
export interface FocusSessionStartResponse {
  sessionId: string; // UUID
  startedAt: string; // 서버가 확정한 시작 시각
}

// PATCH /focus-session/cancel — 진행 중 세션 취소 요청(통계 미귀속, 성공은 204 빈 바디).
export interface FocusSessionCancelRequest {
  sessionId: string; // UUID
}
