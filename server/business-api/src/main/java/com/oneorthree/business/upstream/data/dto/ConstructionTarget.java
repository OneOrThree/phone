package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * 목표 선택 결과 (GROMO-1767, LLD §2). 공개 PUT 의 {@code data} 와 같은 필드라 그대로 내보낸다.
 *
 * <p>목표 변경에는 차감이 없으므로 {@code spent} 는 항상 0 이다(C03). 같은 목표·현재 version 은
 * 무변경 200 이라 새 사건도 없다(C11).
 */
public record ConstructionTarget(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String buildingId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean selected,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long spent,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long version) {
}
