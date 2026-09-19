package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;
import java.util.UUID;

/**
 * 계정 projection (GROMO-1801 · 계정 LLD §2.2). 공개 {@code GET /me} 의 {@code data} 와 같은 필드라 그대로 내보낸다.
 * name·catColor 는 온보딩 전 상태를 표현하는 null 을 허용하고, 나머지는 빠지면 계약 불일치(502)다.
 */
public record AccountMe(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
        @JsonProperty(required = true) String name,
        @JsonProperty(required = true) String catColor,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<String> linkedProviders,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean onboardingComplete) {
}
