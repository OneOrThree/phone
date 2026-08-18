import type { LeagueMemberResponse } from '@/types/api';

// 리그 화면 공용 타입 + 시안 유래 잔존 데이터.
// ※ 친구 목록·검색·받은 요청·신청/수락/거절·끊기는 실API 연동 완료(./friendsApi·./useFriends).
// 리그 API 연동 완료 — 티어/랭킹/내 순위/핀 전부 실데이터(./useLeagueMeta·./useLeagueRanking 등).
// 남은 건 MY_USER_ID(내 행 센티널)·RankedMember 타입(프로필 시트 확장 필드)·
// 비교 타입(SubjectCompare·CompareByDay)·TEASER_SUBJECTS(비친구 블러 티저).

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

// 시안 "과목별 공부량 비교" 그대로 — 노무사 과목 3종
const SUBJECTS_NOMUSA: SubjectCompare[] = [
  { name: '노동법', myMinutes: 750, theirMinutes: 910 },
  { name: '행정쟁송법', myMinutes: 490, theirMinutes: 400 },
  { name: '사회보험법', myMinutes: 340, theirMinutes: 560 },
];

// 비친구 프로필의 블러 티저 아래 깔리는 고정 과목 데이터 (시안 · 비친구 — 잠금 미리보기)
export const TEASER_SUBJECTS: SubjectCompare[] = SUBJECTS_NOMUSA;
