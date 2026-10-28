// 초대 링크 도메인 API 래퍼 — 계약 정본은 초대 링크 스펙 §4-2 ①·④.
// 인증이 필요한 두 엔드포인트만 여기 둔다. 무인증 매치(POST /l/match)는 로그인 전에도 나가야 해
// api 인스턴스(JWT 주입·401 리프레시)를 태울 수 없어 services/deferredInvite.ts 가 bare axios로 부른다.
import { api } from '@/services/api';

// ① POST /api/v1/groups/{groupId}/invite-link (JWT)
// 응답 200 { slug, url } — url 은 https://link.oneorthree.world/l/{slug}?g={groupId}.
// **멱등**: (그룹, 로그인 유저)에 링크가 이미 있으면 서버가 같은 slug 를 되돌려준다.
// 실패: 403 NOT_MEMBER(그룹 미가입) · 404 GROUP_NOT_FOUND. axios 는 non-2xx 에 throw 한다.
//
// ⚠️ 공유 링크를 앱에서 조립하지 않는 이유: slug 는 서버 DB의 어트리뷰션 원장(누가 누굴 데려왔나)
//    이라 서버만 발급할 수 있다. 발급이 실패하면 공유할 링크 자체가 없다(폴백 없음 — 구
//    github.io 링크는 실제로 404라 폴백 가치가 없다).
export interface IssueInviteLinkResponse {
  slug: string;
  url: string;
}

export async function issueInviteLink(groupId: string): Promise<IssueInviteLinkResponse> {
  const { data } = await api.post<IssueInviteLinkResponse>(
    `/api/v1/groups/${groupId}/invite-link`,
    {},
  );
  return data;
}

// ④ POST /api/v1/invite-links/claim (JWT)
// 설치 후 매치로 복원한 slug 를 **가입/로그인 직후** 우리 user_id 에 붙인다(스펙 §2-3 ③).
// 200 no-op 멱등(이미 claim 됐거나 초대자 본인이면 서버가 조용히 무시) · 404 SLUG_NOT_FOUND.
export async function claimInviteLink(slug: string): Promise<void> {
  await api.post<void>('/api/v1/invite-links/claim', { slug });
}
