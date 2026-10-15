package com.oneorthree.phone.invitelink.dto;

/**
 * 링크 발급 응답 (스펙 §4-2 ①).
 *
 * @param slug 링크 식별자
 * @param url  공유용 Universal Link — {@code {base}/l/{slug}?g={groupId}}.
 *             groupId 를 동봉해 설치 유저는 서버 왕복 0회로 초대 시트를 띄운다.
 */
public record IssueInviteLinkResponse(String slug, String url) {
}
