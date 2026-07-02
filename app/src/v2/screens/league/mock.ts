import type {
  FriendRequestResponse,
  FriendResponse,
  FriendSearchResultResponse,
  LeagueMemberResponse,
  LeagueRankResponse,
  LeagueTierResponse,
} from '@/types/api';

// 리그 화면 placeholder 데이터 — Claude Design 시안(Gromo_league.dc.html)의 base 데이터 그대로.
// 타입은 백엔드 DTO(@/types/api)에 맞춰 두어 API 연동 시 fetch 결과로 스왑만 하면 된다.
//
// TODO(API 연동): 화면 데이터 ↔ 엔드포인트 매핑
//   내 티어/뱃지        → GET /api/v1/league/me/tier      (MY_TIER)
//   전체 랭킹 목록       → GET /api/v1/league/me/ranking   (RANKING) ※ 시안은 혼합 티어 전체 랭킹
//   내 순위·승격/강등    → GET /api/v1/league/me/rank      (MY_RANK, result → 연출 트리거)
//   친구 목록(핀 포함)   → GET /api/v1/friends             (FRIENDS)
//   나만의 랭킹(핀)      → GET /api/v1/friends/pinned
//   친구 검색           → GET /api/v1/friends/search?type=NICKNAME&q=
//   받은 요청           → GET /api/v1/friends/requests?type=received (+ accept/reject)

export const MY_USER_ID = 'u-07';

// 랭킹 한 행 — 시안은 혼합 티어 전체 랭킹이라 행마다 티어·시험·프로필 값이 붙는다.
// LeagueMemberResponse(단일 아레나 전제)에는 없는 필드 → UI 확장으로 두고,
// TODO: 전체(티어 혼합)·시험별 랭킹 백엔드 협의 후 응답 필드로 교체
export interface RankedMember extends LeagueMemberResponse {
  tierLevel: number;
  exam: string; // 준비 시험 (시험 칩 필터)
  achievedRate: number; // 주간 목표 달성률 0..1 (프로필 링)
  friendCount: number; // 친구 수 (프로필 pill)
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
  totalFocusMinutes: 860, // 14h 20m
  result: null,
};

// 전체 랭킹 — 시안 base 10명 그대로 (이름/티어/시간/시험/달성률/친구수)
export const RANKING: RankedMember[] = [
  // prettier-ignore
  { rank: 1, userId: 'u-01', nickname: '민지노트', totalFocusMinutes: 2300, result: null, tierLevel: 5, exam: '노무사', achievedRate: 0.92, friendCount: 128 },
  // prettier-ignore
  { rank: 2, userId: 'u-02', nickname: '현생사는중', totalFocusMinutes: 2102, result: null, tierLevel: 5, exam: '변리사', achievedRate: 0.88, friendCount: 94 },
  // prettier-ignore
  { rank: 3, userId: 'u-03', nickname: '준비된자', totalFocusMinutes: 1907, result: null, tierLevel: 4, exam: '노무사', achievedRate: 0.84, friendCount: 61 },
  // prettier-ignore
  { rank: 4, userId: 'u-04', nickname: '합격기원', totalFocusMinutes: 1690, result: null, tierLevel: 4, exam: '공무원', achievedRate: 0.8, friendCount: 47 },
  // prettier-ignore
  { rank: 5, userId: 'u-05', nickname: '서연', totalFocusMinutes: 1498, result: null, tierLevel: 4, exam: '노무사', achievedRate: 0.76, friendCount: 33 },
  // prettier-ignore
  { rank: 6, userId: 'u-06', nickname: '태강', totalFocusMinutes: 1360, result: null, tierLevel: 3, exam: '변리사', achievedRate: 0.7, friendCount: 52 },
  // prettier-ignore
  { rank: 7, userId: MY_USER_ID, nickname: '진수', totalFocusMinutes: 1295, result: null, tierLevel: 3, exam: '노무사', achievedRate: 0.67, friendCount: 18 },
  // prettier-ignore
  { rank: 8, userId: 'u-08', nickname: '유진', totalFocusMinutes: 1212, result: null, tierLevel: 3, exam: '세무사', achievedRate: 0.64, friendCount: 25 },
  // prettier-ignore
  { rank: 9, userId: 'u-09', nickname: '도윤', totalFocusMinutes: 1050, result: null, tierLevel: 2, exam: '공무원', achievedRate: 0.55, friendCount: 12 },
  // prettier-ignore
  { rank: 10, userId: 'u-10', nickname: '민서', totalFocusMinutes: 725, result: null, tierLevel: 1, exam: '노무사', achievedRate: 0.4, friendCount: 7 },
];

// 시안 초기 핀 — 민지노트·준비된자·서연 (친구 여부와 무관하게 핀 가능)
export const INITIAL_PINS = ['u-01', 'u-03', 'u-05'];

// 친구 목록 — 시안 초기 friends: 현생사는중·태강·도윤
export const FRIENDS: FriendResponse[] = [
  { userId: 'u-02', nickname: '현생사는중', tierLevel: 5, isPinned: false },
  { userId: 'u-06', nickname: '태강', tierLevel: 3, isPinned: false },
  { userId: 'u-09', nickname: '도윤', tierLevel: 2, isPinned: false },
];

// 받은 친구 요청 — exam은 응답에 없는 표기용 확장 (시안 "티어 · 시험")
export interface ReceivedRequest extends FriendRequestResponse {
  exam: string;
}

export const RECEIVED_REQUESTS: ReceivedRequest[] = [
  // prettier-ignore
  { requestId: 'req-01', userId: 'r-01', nickname: '열공러', tierLevel: 2, createdAt: '2026-07-01T09:12:00Z', exam: '노무사' },
  // prettier-ignore
  { requestId: 'req-02', userId: 'r-02', nickname: '갓생도전', tierLevel: 4, createdAt: '2026-07-02T01:40:00Z', exam: '노무사' },
];

// 검색 풀 — 시안 검색어 '합격' 기준 3건. exam은 표기용 확장
export interface SearchResult extends FriendSearchResultResponse {
  exam: string;
}

export const SEARCH_POOL: SearchResult[] = [
  { userId: 's-01', nickname: '합격기원생', tierLevel: 3, relation: 'NONE', exam: '노무사' },
  { userId: 's-02', nickname: '합격가자', tierLevel: 2, relation: 'PENDING', exam: '노무사' },
  { userId: 's-03', nickname: '합격의신', tierLevel: 4, relation: 'NONE', exam: '노무사' },
];

// 시험 칩 — 시안 exams. 필터는 mock 로컬 동작 (TODO: 시험별 리그 백엔드 지원 시 API 연동)
export const EXAM_CHIPS = ['전체', '노무사', '변리사', '공무원', '세무사'];

// 주간 정산 마감 카운트다운 — TODO: MY_TIER.weekStartAt 기준 실계산으로 교체
export const DEADLINE_LABEL = '마감 3일 12:40';
