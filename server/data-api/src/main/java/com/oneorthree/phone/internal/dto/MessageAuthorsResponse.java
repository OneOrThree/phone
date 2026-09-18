package com.oneorthree.phone.internal.dto;

import java.util.List;

/**
 * 작성자 표시 projection 목록. 계정이 없는 id 는 빠진다 — 가짜 프로필을 만들지 않는다(LLD §5).
 *
 * @param authors 요청 순서, 중복 제거
 */
public record MessageAuthorsResponse(List<MailboxViewerResponse> authors) {
}
