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
  totalDistractionSeconds: number; // ⚠️ 서버 검증 0 이상 24시간 이하 — 음수는 400(GROMO-1214 코드리뷰)
  focusType?: FocusType; // GROMO-733 additive — 미지정 시 서버가 INFINITE 기본(고아 정산 등 모드 미상 경로)
  // GROMO-1252 additive — 이 세션의 날짜별 집중초("YYYY-MM-DD" → 초).
  // 업로드 구간엔 일시정지 공백이 섞여 있어 서버가 벽시계 자정으로 쪼개면 자정을 걸친 세션의
  // 날짜별 몫이 어긋난다(23:50~23:55 집중 → 일시정지 → 00:10~00:15 집중 = 300/300, 벽시계 600/900).
  // ⚠️ 날짜 축은 **KST**다(서버 귀속 축 — country_code 파생 존, 미지정·미지원은 Asia/Seoul 폴백).
  // 기기 로컬 축으로 보내면 기기 존 ≠ 서버 존일 때 서버가 못 알아보는 키가 나가 그 몫이 버려진다.
  // 미지정·빈 맵이면 서버가 종전대로 벽시계 분할로 폴백한다. 서버는 값을 무검증 수용하지 않는다 —
  // 날짜별 벽시계 몫을 상한으로 클램프하고 세션 구간과 겹치지 않는 날짜는 버린다.
  focusSecondsByDate?: Record<string, number>;
  // 이 POST가 라이브 마커의 폴백일 때 그 마커 id(GROMO-1214 코드리뷰, additive). 서버가 '이미 완료된
  // 마커'를 id로 걸러 이중 계상을 막는다 — 기기 시계 스큐로 서버 클램프 값과 앱 타임스탬프가 어긋나면
  // (startedAt, endedAt) 완전일치 중복 검사가 못 잡기 때문. 구버전 서버는 이 필드를 무시한다.
  sessionId?: string; // UUID
}

// POST /focus-session — 집중 세션 저장 응답(GROMO-806). 세션 반영 후 그날 누적·스트릭 인정 여부.
// 구버전 백엔드는 빈 바디(201)를 주므로 필드가 없을 수 있다 — 사용처에서 유효성 검증 후 반영.
export interface FocusSessionSaveResponse {
  dayTotalFocusSeconds: number; // 이 세션 반영 후 그날 누적 집중 초
  streakQualifiedToday: boolean; // 그날 누적이 스트릭 기준(하루 10분) 이상인지 — 서버 확정 판정
  // 이 세션 저장으로 서버가 지급한 코인 수(집중 60초당 1코인 — FocusService.sessionRewardCoins,
  // B5a 서버 지급 전환) — 잔액 정본.
  // ⚠️ optional인 이유: 구버전 서버는 이 필드가 없다 — 소비처(CoinContext.reconcileSessionAward)는
  // 숫자일 때만 낙관 가산을 정정하고, 없으면 기존 낙관 계산을 유지한다.
  awardedCoins?: number;
  // 이 세션으로 집중 목표를 처음 달성했을 때의 보너스 지급액(전이 없으면 0, GROMO-1039) —
  // 같은 저장 트랜잭션의 서버 지급이라 잔액 정정 시 awardedCoins와 합산해 반영한다.
  goalRewardCoins?: number;
  // 이 저장 반영 후 잔액. 현재 앱은 읽지 않는다 — 잔액은 GET /currency 재조회로 통일했다(GROMO-1049).
  // 서버가 롤링 호환용으로 계속 실어 주므로 계약만 명시한다.
  balanceAfter?: number;
}

// GET /focus-session content 항목 — 집중 세션 단건.
// ⚠️ 서버는 이 4개 필드만 직렬화한다(FocusSessionResponse.java) — subject·distractionCount 없음(리뷰 반영).
export interface FocusSessionResponse {
  focusTagId: string | null; // UUID, 태그 미지정 시 null (user_focus_tags.id — GROMO-673)
  startedAt: string; // Instant, ISO 문자열
  endedAt: string; // Instant, ISO 문자열. ⚠️ 진행 중 세션은 null로 오지만 getAllFocusSessions가 걸러낸다
  totalDistractionSeconds: number;
  // GROMO-1252 additive — 서버가 완료 시점에 확정한 날짜별 집중초(서버 존 로컬 날짜 → 초).
  // 사전집계(DailyFocusStat)에 가산한 값과 동일하다. 복원 경로가 구간을 다시 벽시계로 자르지 않고
  // 이 분포를 쓰면 일시정지가 자정을 걸친 세션도 서버와 같은 몫이 된다.
  // 분포 미기록(레거시) 세션·구버전 서버는 undefined → 호출측이 todayOverlapSeconds로 폴백한다.
  focusSecondsByDate?: Record<string, number>;
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
// 시간 저장·통계는 기존 완주 저장(POST /focus-session)이 담당하고, 마커는 블록 정산·세션 종료
// 시 취소(cancel, 통계 미귀속)로 닫아 이중 집계를 막는다. CANCELED 세션은 목록 조회(GET)에서
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
  // null = 서버가 이 요청으로 마커를 만들지 않았다 (GROMO-1287). 이미 열린 마커가 이 요청보다
  // 논리적으로 나중에 시작한 경우다 — 백그라운드 복귀 리플레이의 과거 블록, 요청 도착 역전, 재전송.
  // 그 블록은 마커 없이 POST /focus-session으로 올린다(uploadFocusBlock의 sessionId: null 경로).
  // **다른 마커의 id를 대신 쓰면 안 된다**: 서로 다른 블록이 같은 마커를 PATCH하면 첫 요청만 적립되고
  // 나머지는 SESSION_ALREADY_ENDED(폴백 금지 코드)를 받아 그 블록의 시간·코인이 영구 유실된다.
  sessionId: string | null; // UUID
  startedAt: string; // 서버가 확정한 시작 시각
}

// PATCH /focus-session/cancel — 진행 중 세션 취소 요청(통계 미귀속, 성공은 204 빈 바디).
export interface FocusSessionCancelRequest {
  sessionId: string; // UUID
}

// PATCH /focus-session — 라이브 마커 '종료' 요청(GROMO-1214). 마커를 취소로 버리고 별개의
// POST로 시간을 새로 만들던 종전 경로 대신, **서버가 발급한 마커 id를 거쳐야만** 시간·코인이
// 귀속되게 한다. 이미 종료/취소/자동마감(AUTO_CLOSED)된 세션 재요청은 409.
export interface FocusSessionEndRequest {
  sessionId: string; // UUID — POST /focus-session/start 응답의 마커 id
  // 종료 시각(생략 시 서버 수신 시각).
  // ⚠️ 서버가 [now−5분, now] 창으로 클램프한다(FocusService.clampToServerNow) — 창 밖 값은
  //    서버 수신 시각으로 올라가 구간이 부풀려지므로, 앱은 '방금 끝난' 블록만 이 경로로 보낸다.
  endedAt?: string; // Instant, ISO 문자열
  totalDistractionSeconds?: number; // 미지정 시 0
  focusTagId?: string | null; // 시작 시 미지정한 태그 보정용. null이면 마커의 기존 태그 유지
  // GROMO-1252 additive — 이 블록의 날짜별 집중초("YYYY-MM-DD" → 초). 의미·축(KST)·서버 검증은
  // FocusSessionRequest.focusSecondsByDate와 완전히 동일하다. PATCH에도 실어야 자정을 걸친 블록의
  // 날짜별 귀속이 POST 폴백과 같아진다(안 실으면 서버가 벽시계 분할로 폴백, 3차 ②).
  focusSecondsByDate?: Record<string, number>;
}

// PATCH /focus-session — 종료 응답(200). 지급 필드(awardedCoins·goalRewardCoins·balanceAfter)는
// POST 응답과 **필드명·타입·의미가 완전히 동일**해서 두 경로의 소비처(스트릭 판정 발행 등)를
// 그대로 공유한다. POST 쪽과 달리 전 필드 non-null 확정 계약이라 optional을 걷어낸다.
export interface FocusSessionEndResponse extends FocusSessionSaveResponse {
  sessionId: string; // UUID
  startedAt: string; // 마커의 시작 시각 — 서버가 클램프한 값
  endedAt: string; // 종료 시각 — 서버가 클램프한 값
  durationSeconds: number; // endedAt − startedAt
  totalDistractionSeconds: number;
  awardedCoins: number;
  goalRewardCoins: number;
  balanceAfter: number;
}
