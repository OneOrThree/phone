import type { InternalAxiosRequestConfig } from 'axios';
import { mockFriends, mockPin, mockPinnedFriends, mockUnpin } from './fixtures/friends';

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

export const handlers: MockHandler[] = [
  { method: 'get', matches: (url) => url === '/api/v1/pins', respond: () => mockPinnedFriends() },
  { method: 'get', matches: (url) => url === '/api/v1/friends', respond: () => mockFriends() },
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
