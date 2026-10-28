package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * {@code POST /internal/islands/{islandId}/notices/{noticeId}/comments} 요청 본문 (GROMO-1771).
 * 작성자는 본문이 아니라 검증된 {@code X-User-Id} 다 — 대리 userId 입력이 없다(LLD §2).
 */
public record NoticeCommentRequest(@NotBlank String text) {
}
