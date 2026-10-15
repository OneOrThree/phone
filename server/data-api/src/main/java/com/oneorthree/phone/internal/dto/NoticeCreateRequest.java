package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * {@code POST /internal/islands/{islandId}/notices} 요청 본문 (GROMO-1771, island-board LLD §2).
 * 제목 100 UTF-16 단위·공백 거절은 legacy {@code CreateAnnouncementRequest} 와 같은 규칙이다(정책 B05).
 * 본문 상한은 BQ03 임시값이라 설정에서 읽어 서비스가 판정한다.
 */
public record NoticeCreateRequest(
        @NotBlank @Size(max = 100) String title,
        @NotBlank String body) {
}
