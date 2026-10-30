/** 백오피스에서 게시한 개발자 공지. 로그인한 게스트도 같은 읽기 API를 사용한다. */
import { request } from './client';

export type DeveloperNotice = {
  publicationId: string;
  title: string;
  body: string;
  startsAt: string;
  endsAt: string | null;
  publishedAt: string;
  // 서버 GROMO-2616 이 내려 준다. 없으면(아직 안 나감) 일반 패치노트다
  forcesUpdate?: boolean;
};

export function listDeveloperNotices(): Promise<{ items: DeveloperNotice[] }> {
  return request('/me/developer-notices');
}

export function getDeveloperNotice(id: string): Promise<DeveloperNotice> {
  return request(`/me/developer-notices/${encodeURIComponent(id)}`);
}
