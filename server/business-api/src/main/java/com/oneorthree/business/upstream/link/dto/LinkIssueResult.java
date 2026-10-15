package com.oneorthree.business.upstream.link.dto;

/**
 * 발급 결과 — 기존 앱 계약({@code IssueInviteLinkResponse})의 두 필드를 그대로 채운다.
 *
 * <p><b>slug 와 URL 형태를 새로 만들지 않는다</b>(계약 §4 · §7 변경 금지). 기존 공개 URL 은
 * {@code {base}/l/{slug}?g={groupId}} 이고, 이미 공유된 링크가 살아 있어야 한다.
 *
 * @param slug 링크 식별자 — 기존 생성 규칙·길이를 보존한다
 * @param url  공유용 Universal Link
 */
public record LinkIssueResult(String slug, String url) {
}
