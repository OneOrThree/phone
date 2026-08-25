import type { FriendResponse, PinnedFriendResponse } from '@/types/api';

// GROMO-658 친구 탭 라이브 표시(집중 여부 + 과목 + 경과 시간) 검증용 목데이터.
// 핀 토글(POST/DELETE /pins/{id})이 실제처럼 반영되도록 핀 상태를 인메모리로 관리한다(리로드 시 초기화).
// 집중 시작 시각은 모듈 로드 시점 기준으로 고정 — 재조회(폴링)해도 경과 시간이 리셋되지 않고 이어서 올라간다.

const LOADED_AT = Date.now();
const minutesBeforeLoad = (m: number): string => new Date(LOADED_AT - m * 60_000).toISOString();

interface MockFriendBase {
  userId: string;
  nickname: string;
  tierLevel: number | null;
  focusTimeMinutes: number;
  isFocusing: boolean;
  focusStartedAt: string | null;
  focusTagName: string | null;
}

// 케이스: 집중중(태그有) / 미집중 / 집중중(무태그) / 미집중 — 정렬·분기 모두 커버
const FRIENDS: MockFriendBase[] = [
  {
    userId: '00000000-0000-0000-0000-000000000001',
    nickname: '재영',
    tierLevel: 3,
    focusTimeMinutes: 42,
    isFocusing: true,
    focusStartedAt: minutesBeforeLoad(5),
    focusTagName: '수학',
  },
  {
    userId: '00000000-0000-0000-0000-000000000002',
    nickname: '수빈',
    tierLevel: 2,
    focusTimeMinutes: 0,
    isFocusing: false,
    focusStartedAt: null,
    focusTagName: null,
  },
  {
    userId: '00000000-0000-0000-0000-000000000003',
    nickname: '무태그집중러',
    tierLevel: null,
    focusTimeMinutes: 90,
    isFocusing: true,
    focusStartedAt: minutesBeforeLoad(87),
    focusTagName: null,
  },
  {
    userId: '00000000-0000-0000-0000-000000000004',
    nickname: '핀만한친구',
    tierLevel: 1,
    focusTimeMinutes: 15,
    isFocusing: false,
    focusStartedAt: null,
    focusTagName: null,
  },
  // GROMO-1630 — 리그 랭킹 목(league.ts)에서 isFriend: true 로 표기한 유저들.
  // 랭킹에서 친구 배지를 단 유저의 프로필을 열면 /friends 재동기화(구서버 폴백)가 이 목록을
  // 훑으므로, 여기 없으면 곧바로 비친구로 덮여 목 모드 검증이 깨진다(코덱스 리뷰 #703).
  // 두 픽스처의 친구 관계는 항상 함께 갱신할 것.
  {
    userId: '00000000-0000-0000-0000-000000000101',
    nickname: '아레나1등',
    tierLevel: 1,
    focusTimeMinutes: 180,
    isFocusing: true,
    focusStartedAt: minutesBeforeLoad(23),
    focusTagName: '민법',
  },
  {
    userId: '00000000-0000-0000-0000-000000000104',
    nickname: '수학러',
    tierLevel: 4,
    focusTimeMinutes: 200,
    isFocusing: true,
    focusStartedAt: minutesBeforeLoad(8),
    focusTagName: '수학',
  },
  {
    userId: '00000000-0000-0000-0000-000000000202',
    nickname: '새벽공부러',
    tierLevel: 2,
    focusTimeMinutes: 310,
    isFocusing: true,
    focusStartedAt: minutesBeforeLoad(95),
    focusTagName: '영어',
  },
  {
    userId: '00000000-0000-0000-0000-000000000206',
    nickname: '노동법러',
    tierLevel: 2,
    focusTimeMinutes: 110,
    isFocusing: true,
    focusStartedAt: minutesBeforeLoad(40),
    focusTagName: '노동법',
  },
  {
    userId: '00000000-0000-0000-0000-000000000301',
    nickname: '전체1등',
    tierLevel: 1,
    focusTimeMinutes: 0,
    isFocusing: false,
    focusStartedAt: null,
    focusTagName: null,
  },
];

// 초기 핀: 재영·핀만한친구 — 핀+집중중 / 핀+미집중 케이스
const pinnedIds = new Set<string>([
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004',
]);

// 프로필·통계 목(692)에서 닉네임·티어를 재사용하기 위한 조회 헬퍼
export function mockFriendById(userId: string): MockFriendBase | undefined {
  return FRIENDS.find((f) => f.userId === userId);
}

export function mockFriends(): FriendResponse[] {
  return FRIENDS.map((f) => ({
    userId: f.userId,
    nickname: f.nickname,
    tierLevel: f.tierLevel,
    isPinned: pinnedIds.has(f.userId),
    occupation: null, // 준비 시험 미설정 (GROMO-747)
    focusTimeMinutes: f.focusTimeMinutes,
    isFocusing: f.isFocusing,
    focusStartedAt: f.focusStartedAt,
    focusTagName: f.focusTagName,
  }));
}

export function mockPinnedFriends(): PinnedFriendResponse[] {
  return FRIENDS.filter((f) => pinnedIds.has(f.userId)).map((f) => ({
    userId: f.userId,
    nickname: f.nickname,
    character: [],
    focusTimeMinutes: f.focusTimeMinutes,
    isFocusing: f.isFocusing,
    focusStartedAt: f.focusStartedAt,
    focusTagName: f.focusTagName,
  }));
}

// 서버와 동일하게 멱등 — 이미 핀/핀 없음이어도 조용히 성공
export function mockPin(userId: string): void {
  pinnedIds.add(userId);
}

export function mockUnpin(userId: string): void {
  pinnedIds.delete(userId);
}
