package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.Map;

/**
 * 섬 배치 정본 (GROMO-2232, map-assets §6) — Data {@code GET /internal/islands/{islandId}/layout}.
 *
 * <p>{@code layout} 은 Data 가 저장한 JSON 을 그대로 옮긴다 — 스키마({@code schemaVersion})의 해석은 앱 몫이다.
 */
public record IslandLayout(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long layoutRevision,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Map<String, Object> layout) {
}
