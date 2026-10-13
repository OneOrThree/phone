package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * 섬의 오늘(KST) 집중 분 (GROMO-2258) — Data {@code GET /internal/islands/{islandId}/focus-today}.
 * 방문 화면의 {@code focusToday} 조각 재료이고, 공개 응답은 유스케이스가 {@code minutes} 만 투영한다.
 */
public record IslandFocusToday(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String islandId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String date,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long minutes) {
}
