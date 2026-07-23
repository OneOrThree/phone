import type { LeagueMemberResponse, LeagueRankResponse, LeagueTierResponse } from '@/types/api';

// 리그 화면 placeholder 데이터 — Claude Design 시안(Gromo_league.dc.html)의 base 데이터 그대로.
// 타입은 백엔드 DTO(@/types/api)에 맞춰 두어 API 연동 시 fetch 결과로 스왑만 하면 된다.
// ※ 친구 목록·검색·받은 요청·신청/수락/거절·끊기는 실API 연동 완료(./friendsApi·./useFriends).
//
// 리그 API 연동 완료 — 티어/랭킹/내 순위/핀 전부 실데이터(./useLeagueMeta·./useLeagueRanking 등).
// MY_TIER·MY_RANK·RANKING은 참조 0건 placeholder 잔재(삭제 대상). 살아있는 건
// RankedMember 타입(프로필 시트 확장 필드)과 TEASER_SUBJECTS(비친구 블러 티저)뿐.

export const MY_USER_ID = 'u-07';

// 랭킹 한 행 — 시안은 혼합 티어 전체 랭킹이라 행마다 티어·시험·프로필 값이 붙는다.
// tierLevel은 서버 응답 필드로 승격(GROMO-748), 나머지는 UI 확장으로 두고
// TODO: 시험별 랭킹 백엔드 협의 후 응답 필드로 교체
// ※ totalFocusSeconds는 서버 응답 그대로(초, GROMO-665) — 리그 시간은 HH:MM:SS 실초 표기.
//   bestWeekMinutes만 분 도메인(프로필 기록 카드용) 확장 필드로 둔다.
export interface RankedMember extends LeagueMemberResponse {
  exam: string; // 준비 시험 (시험 칩 필터)
  achievedRate: number; // 주간 목표 달성률 0..1 (프로필 링)
  friendCount: number; // 친구 수 (프로필 pill)
  streakDays: number; // 연속 공부 일수 — 하루 10분 스트릭, UserStreak (프로필 이름 옆 표기)
  bestRank: number; // 역대 최고 순위 (프로필 기록 카드)
  bestWeekMinutes: number; // 일주일 최대 공부량(분) (프로필 기록 카드)
}

export const MY_TIER: LeagueTierResponse = {
  assigned: true,
  tierLevel: 3,
  arenaId: 'arena-777',
  weekStartAt: '2026-06-29T00:00:00Z',
  status: 'ACTIVE',
  badgeId: null,
};

// 티어 안내 히어로 기준값 — 시안 고정 카피(이번 주 14h 20m · 다음 단계까지 7h 40m).
// 랭킹의 내 행(진수 21h 35m)과 다른 시안 자체 값이라 그대로 둔다(placeholder).
export const MY_RANK: LeagueRankResponse = {
  assigned: true,
  myRank: 7,
  totalFocusSeconds: 51600, // 14h 20m (860분 × 60)
};

// 전체 랭킹 — 시안 base 10명 그대로 (이름/티어/시간/시험/달성률/친구수). 미사용 placeholder.
// totalFocusSeconds는 서버 계약(초, GROMO-665)에 맞춰 시안 분값 × 60으로 표기.
export const RANKING: RankedMember[] = [
  // prettier-ignore
  { rank: 1, userId: 'u-01', nickname: '민지노트', totalFocusSeconds: 2300 * 60, tierLevel: 5, exam: '노무사', achievedRate: 0.92, friendCount: 128, streakDays: 21, bestRank: 1, bestWeekMinutes: 2520 },
  // prettier-ignore
  { rank: 2, userId: 'u-02', nickname: '현생사는중', totalFocusSeconds: 2102 * 60, tierLevel: 5, exam: '변리사', achievedRate: 0.88, friendCount: 94, streakDays: 14, bestRank: 1, bestWeekMinutes: 2350 },
  // prettier-ignore
  { rank: 3, userId: 'u-03', nickname: '준비된자', totalFocusSeconds: 1907 * 60, tierLevel: 4, exam: '노무사', achievedRate: 0.84, friendCount: 61, streakDays: 9, bestRank: 2, bestWeekMinutes: 2100 },
  // prettier-ignore
  { rank: 4, userId: 'u-04', nickname: '합격기원', totalFocusSeconds: 1690 * 60, tierLevel: 4, exam: '공무원', achievedRate: 0.8, friendCount: 47, streakDays: 7, bestRank: 3, bestWeekMinutes: 1900 },
  // prettier-ignore
  { rank: 5, userId: 'u-05', nickname: '서연', totalFocusSeconds: 1498 * 60, tierLevel: 4, exam: '노무사', achievedRate: 0.76, friendCount: 33, streakDays: 5, bestRank: 4, bestWeekMinutes: 1720 },
  // prettier-ignore
  { rank: 6, userId: 'u-06', nickname: '태강', totalFocusSeconds: 1360 * 60, tierLevel: 3, exam: '변리사', achievedRate: 0.7, friendCount: 52, streakDays: 4, bestRank: 3, bestWeekMinutes: 1580 },
  // prettier-ignore
  { rank: 7, userId: MY_USER_ID, nickname: '진수', totalFocusSeconds: 1295 * 60, tierLevel: 3, exam: '노무사', achievedRate: 0.67, friendCount: 18, streakDays: 3, bestRank: 5, bestWeekMinutes: 1490 },
  // prettier-ignore
  { rank: 8, userId: 'u-08', nickname: '유진', totalFocusSeconds: 1212 * 60, tierLevel: 3, exam: '세무사', achievedRate: 0.64, friendCount: 25, streakDays: 2, bestRank: 6, bestWeekMinutes: 1400 },
  // prettier-ignore
  { rank: 9, userId: 'u-09', nickname: '도윤', totalFocusSeconds: 1050 * 60, tierLevel: 2, exam: '공무원', achievedRate: 0.55, friendCount: 12, streakDays: 1, bestRank: 7, bestWeekMinutes: 1210 },
  // prettier-ignore
  { rank: 10, userId: 'u-10', nickname: '민서', totalFocusSeconds: 725 * 60, tierLevel: 1, exam: '노무사', achievedRate: 0.4, friendCount: 7, streakDays: 0, bestRank: 9, bestWeekMinutes: 980 },
];

// ── 프로필 상세(FriendProfile) 비교 타입 + 티저 표본 ──
// 실제 비교는 실데이터 연동 완료 — 과목별은 getFocusStatsByCategory(period, friends),
// 요일별은 내 getHeatmap + 상대 getUserStats().heatmap(GROMO-640) 조합. 별도 비교 API 불필요.

export interface SubjectCompare {
  name: string;
  myMinutes: number;
  theirMinutes: number;
}

export interface CompareByDay {
  mine: number[]; // 월~일(분)
  theirs: number[];
}

export interface ProfileCompare {
  subjects: SubjectCompare[];
  focusByDay: CompareByDay;
  phoneByDay: CompareByDay;
}

// 시안 "과목별 공부량 비교" 그대로 — 노무사 과목 3종
const SUBJECTS_NOMUSA: SubjectCompare[] = [
  { name: '노동법', myMinutes: 750, theirMinutes: 910 },
  { name: '행정쟁송법', myMinutes: 490, theirMinutes: 400 },
  { name: '사회보험법', myMinutes: 340, theirMinutes: 560 },
];

// 시안 요일별 이중 막대 비율 기반 분값 (집중 max 8h · 폰 사용 max 6h 스케일)
const BASE_FOCUS_BY_DAY: CompareByDay = {
  mine: [288, 360, 216, 408, 336, 144, 264],
  theirs: [384, 264, 432, 336, 288, 192, 360],
};
const BASE_PHONE_BY_DAY: CompareByDay = {
  mine: [180, 144, 234, 108, 198, 288, 162],
  theirs: [108, 198, 126, 162, 144, 216, 180],
};

// (미사용) 실데이터 배선 전에 쓰던 비교 mock — PROFILE_COMPARE·COMPARE_FALLBACK·BASE_*_BY_DAY
// 전부 참조 0건, 삭제 대상.
export const PROFILE_COMPARE: Record<string, ProfileCompare> = {
  'u-01': {
    subjects: SUBJECTS_NOMUSA,
    focusByDay: BASE_FOCUS_BY_DAY,
    phoneByDay: BASE_PHONE_BY_DAY,
  },
};

// PROFILE_COMPARE에 없는 친구(다른 시험) 기본값 — 시안 "겹치는 과목 없음"
export const COMPARE_FALLBACK: ProfileCompare = {
  subjects: [],
  focusByDay: BASE_FOCUS_BY_DAY,
  phoneByDay: BASE_PHONE_BY_DAY,
};

// 비친구 프로필의 블러 티저 아래 깔리는 고정 과목 데이터 (시안 · 비친구 — 잠금 미리보기)
export const TEASER_SUBJECTS: SubjectCompare[] = SUBJECTS_NOMUSA;
