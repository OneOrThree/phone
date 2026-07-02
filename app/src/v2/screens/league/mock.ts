import type {
  FriendRequestResponse,
  FriendResponse,
  FriendSearchResultResponse,
  LeagueMemberResponse,
  LeagueRankResponse,
  LeagueTierResponse,
} from '@/types/api';

// 리그 화면 placeholder 데이터 — UI-first 구현용. 타입은 백엔드 DTO(@/types/api)에
// 맞춰 두어 API 연동 시 fetch 결과로 스왑만 하면 된다.
//
// TODO(API 연동): 화면 데이터 ↔ 엔드포인트 매핑
//   내 티어/뱃지        → GET /api/v1/league/me/tier      (MY_TIER)
//   아레나 랭킹 목록     → GET /api/v1/league/me/ranking   (ARENA_RANKING)
//   내 순위·승격/강등    → GET /api/v1/league/me/rank      (MY_RANK, result → 연출 트리거)
//   친구 목록(핀 포함)   → GET /api/v1/friends             (FRIENDS)
//   나만의 랭킹(핀)      → GET /api/v1/friends/pinned
//   친구 검색           → GET /api/v1/friends/search?type=NICKNAME&q=
//   받은 요청           → GET /api/v1/friends/requests?type=received (+ accept/reject)

export const MY_USER_ID = 'me-0000';

// 내 티어 — 3단계(초집중 모드), 이번 주 14h20m 기준
export const MY_TIER: LeagueTierResponse = {
  assigned: true,
  tierLevel: 3,
  arenaId: 'arena-777',
  weekStartAt: '2026-06-29T00:00:00Z',
  status: 'ACTIVE',
  badgeId: null,
};

export const MY_RANK: LeagueRankResponse = {
  assigned: true,
  myRank: 4,
  totalFocusMinutes: 860, // 14h 20m — 티어 안내 히어로와 동일 값
  result: null,
};

// 같은 아레나(3단계) 랭킹 — result는 주간 정산 전이라 null
export const ARENA_RANKING: LeagueMemberResponse[] = [
  { rank: 1, userId: 'u-01', nickname: '미라클모닝', totalFocusMinutes: 1265, result: null },
  { rank: 2, userId: 'u-02', nickname: '카페인수혈', totalFocusMinutes: 1180, result: null },
  { rank: 3, userId: 'u-03', nickname: '새벽두시', totalFocusMinutes: 990, result: null },
  { rank: 4, userId: MY_USER_ID, nickname: '수빈', totalFocusMinutes: 860, result: null },
  { rank: 5, userId: 'u-05', nickname: '열공하는펭귄', totalFocusMinutes: 812, result: null },
  { rank: 6, userId: 'u-06', nickname: '몰입러버', totalFocusMinutes: 745, result: null },
  { rank: 7, userId: 'u-07', nickname: '갓생살기', totalFocusMinutes: 640, result: null },
  { rank: 8, userId: 'u-08', nickname: '집중하는곰', totalFocusMinutes: 555, result: null },
  { rank: 9, userId: 'u-09', nickname: '도서관지박령', totalFocusMinutes: 430, result: null },
  { rank: 10, userId: 'u-10', nickname: '한장만더', totalFocusMinutes: 315, result: null },
];

// 친구 목록 — isPinned가 "나만의 랭킹"에 노출되는 핀 상태 초기값
export const FRIENDS: FriendResponse[] = [
  { userId: 'u-02', nickname: '카페인수혈', tierLevel: 3, isPinned: true },
  { userId: 'u-07', nickname: '갓생살기', tierLevel: 3, isPinned: true },
  { userId: 'f-01', nickname: '노무사되기', tierLevel: 4, isPinned: false },
  { userId: 'f-02', nickname: '아침형인간', tierLevel: 2, isPinned: false },
  { userId: 'f-03', nickname: '오늘도한걸음', tierLevel: 1, isPinned: false },
];

// 받은 친구 요청
export const RECEIVED_REQUESTS: FriendRequestResponse[] = [
  {
    requestId: 'req-01',
    userId: 'r-01',
    nickname: '변리사가자',
    tierLevel: 3,
    createdAt: '2026-07-01T09:12:00Z',
  },
  {
    requestId: 'req-02',
    userId: 'r-02',
    nickname: '9급공시생',
    tierLevel: 2,
    createdAt: '2026-07-02T01:40:00Z',
  },
];

// 검색 풀 — FriendAddScreen에서 닉네임 includes로 필터해 사용
export const SEARCH_POOL: FriendSearchResultResponse[] = [
  { userId: 's-01', nickname: '수능만점가즈아', tierLevel: 2, relation: 'NONE' },
  { userId: 's-02', nickname: '수면부족', tierLevel: 4, relation: 'NONE' },
  { userId: 's-03', nickname: '수요일의열공', tierLevel: 3, relation: 'PENDING' },
  { userId: 'u-02', nickname: '카페인수혈', tierLevel: 3, relation: 'FRIEND' },
  { userId: 's-04', nickname: '민법정복', tierLevel: 1, relation: 'NONE' },
];

// 친구별 주간 집중 분 — 아레나 밖 친구의 시간 표시용 (TODO: 친구 랭킹 API 협의 후 교체)
export const FRIEND_WEEKLY_MINUTES: Record<string, number> = {
  'f-01': 1560,
  'f-02': 420,
  'f-03': 130,
};

// 유저별 준비 시험 라벨 — 받은 요청의 "티어·시험" 표기용 정적 UI (백엔드 미지원)
export const EXAM_BY_USER: Record<string, string> = {
  'r-01': '변리사',
  'r-02': '공무원',
};

// 시험 칩 — 시안의 카테고리 필터. 백엔드 미지원이라 정적 UI (TODO: 시험별 리그 지원 시 실동작화)
export const EXAM_CHIPS = ['전체 랭킹', '노무사', '변리사', '공인중개사', '수능'];

// 주간 정산 마감 카운트다운 — TODO: MY_TIER.weekStartAt 기준 실계산으로 교체
export const DEADLINE_LABEL = '마감 3일 12:40';

// ─────────────────────────────────────────────────────────────
// 프로필 오버레이 전용 확장 정보 — 대응 엔드포인트가 아직 없어(후속 TODO: 백엔드 협의)
// 화면 로컬 타입으로만 정의하고 seed 기반으로 결정적으로 만들어 쓴다.
// ─────────────────────────────────────────────────────────────
export interface LeagueProfileExtra {
  overallRank: number; // 전체(서비스) 순위
  leagueRank: number; // 아레나 내 순위
  friendCount: number;
  goalRate: number; // 주간 목표 달성률 0..1
  weeklyFocusMinutes: number[]; // 월~일 집중 분
}

export function mockProfileExtra(seed: number): LeagueProfileExtra {
  const base = ((seed * 37) % 90) + 10;
  return {
    overallRank: seed * 41 + 8,
    leagueRank: ((seed * 7) % 10) + 1,
    friendCount: (seed % 9) + 3,
    goalRate: Math.min(0.35 + ((seed * 13) % 60) / 100, 1),
    weeklyFocusMinutes: [0, 1, 2, 3, 4, 5, 6].map((d) => ((base + d * 53) % 180) + 40),
  };
}
