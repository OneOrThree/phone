package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * Data 내부 프로필 변경 결과 (GROMO-1801·1971 · 계정 LLD §2.3).
 * 공개 {@code PATCH /me} 응답에는 AccountUseCase가 선택한 필드만 싣는다.
 */
public record AccountProfile(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
        @JsonProperty(required = true) String name,
        @JsonProperty(required = true) String catColor,
        @JsonProperty(required = true) UUID mainIslandId) {
}
