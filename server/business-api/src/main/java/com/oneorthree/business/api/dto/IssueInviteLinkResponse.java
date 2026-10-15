package com.oneorthree.business.api.dto;

/**
 * 링크 발급 응답 — 기존 Data API 응답과 필드가 같다.
 *
 * @param slug 링크 식별자
 * @param url  공유용 Universal Link — {@code {base}/l/{slug}?g={groupId}}
 */
public record IssueInviteLinkResponse(String slug, String url) {
}
