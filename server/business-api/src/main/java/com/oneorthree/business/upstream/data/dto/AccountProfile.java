package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 이름 변경 결과 (GROMO-1801 · 계정 LLD §2.3). 공개 {@code PATCH /me} 의 {@code data} 3필드 그대로다 —
 * {@code onboardingComplete} 는 싣지 않는다.
 */
public record AccountProfile(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
        @JsonProperty(required = true) String name,
        @JsonProperty(required = true) String catColor) {
}
