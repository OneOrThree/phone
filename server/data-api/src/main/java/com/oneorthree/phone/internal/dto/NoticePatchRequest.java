package com.oneorthree.phone.internal.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * {@code PATCH /internal/islands/{islandId}/notices/{noticeId}} 요청 본문 (GROMO-1771, 정책 B06).
 *
 * <p>{@code null} 은 «생략 = 유지»다. 공개 경계(Business)가 명시 null·빈 값을 이미 거절하고 생략만 null 로
 * 넘긴다 — 여기서는 값이 있으면 공백만이 아니어야 하고 둘 중 하나는 있어야 한다는 것만 다시 본다.
 */
public record NoticePatchRequest(
        @Size(max = 100) @Pattern(regexp = "(?s).*\\S.*") String title,
        @Pattern(regexp = "(?s).*\\S.*") String body) {

    /** 둘 다 생략한 PATCH 는 명령이 아니다. */
    @JsonIgnore
    @AssertTrue
    public boolean isAnyField() {
        return title != null || body != null;
    }
}
