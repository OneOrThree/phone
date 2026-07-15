import type { InternalAxiosRequestConfig } from 'axios';
import { mockFriends, mockPin, mockPinnedFriends, mockUnpin } from './fixtures/friends';
import { mockArenaRanking, mockCategoryRanking, mockGlobalRanking } from './fixtures/league';
import {
  mockFocusAverage,
  mockFocusStatsByCategory,
  mockUserProfile,
  mockUserStats,
} from './fixtures/stats';

// 목킹할 요청의 경로 → 응답 매핑 테이블. 새 목이 필요하면 fixtures 에 데이터를 만들고 여기에 한 줄 추가.
// url 은 baseURL 제외 상대 경로이며 query 는 config.params 로 분리돼 붙지 않는다.
// '/api/v1/friends/requests'·'/search' 가 딸려 매칭되지 않도록 정확히(===) 비교한다.

export interface MockHandler {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  matches: (url: string) => boolean;
  status?: number; // 생략 시 200
  respond: (config: InternalAxiosRequestConfig) => unknown;
}

// POST/DELETE /api/v1/pins/{userId} — 핀 토글도 목 상태에 반영해 재조회 시 정렬·isPinned 가 바뀌게 한다
const PIN_PATH = /^\/api\/v1\/pins\/([0-9a-fA-F-]+)$/;

function pinPathId(url: string | undefined): string | undefined {
  return PIN_PATH.exec(url ?? '')?.[1];
}

// 목 친구 전용 프로필·통계 경로(692) — 목 친구 ID 대역(00000000-…-00000000000x)만 매칭해
// 실제 유저 조회는 실서버로 나간다.
const MOCK_USER_PROFILE =
  /^\/api\/v1\/users\/(00000000-0000-0000-0000-0000000000[0-9a-f]{2})\/profile$/;
const MOCK_USER_STATS =
  /^\/api\/v1\/users\/(00000000-0000-0000-0000-0000000000[0-9a-f]{2})\/stats$/;

export const handlers: MockHandler[] = [
  { method: 'get', matches: (url) => url === '/api/v1/pins', respond: () => mockPinnedFriends() },
  { method: 'get', matches: (url) => url === '/api/v1/friends', respond: () => mockFriends() },
  // 리그 랭킹 — GROMO-824 스펙(구현 예정) 선반영. 824 는 /league/me/ranking 만 확장:
  // category 미지정=아레나 멤버(811), 지정=같은 occupation 상위 100(812) — 서로 다른 데이터.
  {
    method: 'get',
    matches: (url) => url === '/api/v1/league/me/ranking',
    respond: (config) =>
      config.params?.category != null ? mockCategoryRanking(config) : mockArenaRanking(config),
  },
  // 전체 리그 — 824 범위 밖. 서버와 동일하게 라이브 필드 없이 응답(폴백 표기 검증용)
  {
    method: 'get',
    matches: (url) => url === '/api/v1/league/ranking',
    respond: (config) => mockGlobalRanking(config),
  },
  // 과목별 집중 통계 — 692 기간 탭 확인용(내 통계 화면도 목 모드에선 이 데이터를 본다)
  {
    method: 'get',
    matches: (url) => url === '/api/v1/stats/by-category',
    respond: (config) => mockFocusStatsByCategory(config),
  },
  {
    method: 'get',
    matches: (url) => MOCK_USER_PROFILE.test(url),
    respond: (config) => mockUserProfile(MOCK_USER_PROFILE.exec(config.url ?? '')?.[1] ?? ''),
  },
  {
    method: 'get',
    matches: (url) => MOCK_USER_STATS.test(url),
    respond: () => mockUserStats(),
  },
  // 평균 집계(753) — 755 오늘 비교 3축 확인용
  {
    method: 'get',
    matches: (url) => url === '/api/v1/stats/focus/average',
    respond: (config) => mockFocusAverage(config),
  },
  {
    method: 'post',
    matches: (url) => PIN_PATH.test(url),
    status: 204,
    respond: (config) => {
      const id = pinPathId(config.url);
      if (id) mockPin(id);
      return undefined;
    },
  },
  {
    method: 'delete',
    matches: (url) => PIN_PATH.test(url),
    status: 204,
    respond: (config) => {
      const id = pinPathId(config.url);
      if (id) mockUnpin(id);
      return undefined;
    },
  },
];

export function findHandler(method: string, url: string): MockHandler | undefined {
  return handlers.find((h) => h.method === method.toLowerCase() && h.matches(url));
}
