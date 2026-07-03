// 서버 league 도메인 DTO 미러 (com.oneorthree.phone.league.dto).
// 값 단위·의미는 백엔드 기준. 시각(Instant)은 ISO 문자열.
// status/result 문자열은 서버 enum 이름을 그대로 직렬화한 값이라 유니온으로 표기한다.
// ⚠️ 백엔드 DTO가 바뀌면 이 파일도 함께 갱신한다.

// LeagueArena 상태 (Java enum LeagueArenaStatus). LeagueTierResponse.status 로 직렬화.
export type LeagueArenaStatus = 'ACTIVE' | 'ENDED';

// 승격/강등 결과 (Java enum LeagueMemberResult). 진행 중이면 null.
export type LeagueMemberResult = 'PROMOTED' | 'STAY' | 'RELEGATE_WARNING' | 'RELEGATED';

// GET /league/me/tier — 내 현재 리그·티어. 미배정이면 assigned=false, 이하 필드 null.
export interface LeagueTierResponse {
  assigned: boolean;
  tierLevel: number | null; // Integer, 미배정 시 null
  arenaId: string | null; // UUID, 미배정 시 null
  weekStartAt: string | null; // Instant, 미배정 시 null
  status: LeagueArenaStatus | null; // 미배정 시 null
  badgeId: string | null; // 티어 배지 식별자, 누락 시 null
}

// GET /league/me/ranking — 티어 멤버 랭킹 항목(totalFocusMinutes 내림차순).
export interface LeagueMemberResponse {
  rank: number;
  userId: string; // UUID
  nickname: string;
  totalFocusMinutes: number;
  result: LeagueMemberResult | null; // 확정 전이면 null
}

// GET /league/me/rank — 내 순위·승격/강등 상태. 미배정이면 assigned=false, 이하 필드 null.
export interface LeagueRankResponse {
  assigned: boolean;
  myRank: number | null; // Integer, 미배정 시 null
  totalFocusMinutes: number | null; // Integer, 미배정 시 null
  result: LeagueMemberResult | null; // 진행 중이면 null, 확정 시 값
}

// GET /league/me/schedule — 다음 리그 마감(다음 월요일 00:00 KST) 스케줄.
export interface LeagueScheduleResponse {
  nextResetAt: string; // Instant, 다음 리셋 시각
  remainingSeconds: number; // 지금부터 nextResetAt까지 남은 초(항상 ≥ 0)
}

// POST /league/batch/run — 주간 리그 배치 실행 요약.
export interface LeagueBatchSummaryResponse {
  weekStartAt: string; // Instant
  endedArenaCount: number;
  settledMemberCount: number;
  createdArenaCount: number;
  elapsedMillis: number; // long
}
