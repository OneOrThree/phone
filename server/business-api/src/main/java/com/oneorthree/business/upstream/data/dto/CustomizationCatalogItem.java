package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.math.BigDecimal;
import java.time.Instant;

/** 꾸미기 카탈로그 한 행 (GROMO-2331) — imagePath 는 상대 경로다. retiredAt 은 퇴역하지 않았으면 null. */
public record CustomizationCatalogItem(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String productId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String kind,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String slot,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String title,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String imagePath,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int width,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int height,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) BigDecimal anchorX,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) BigDecimal anchorY,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int sortOrder,
        @JsonProperty(required = true) Instant retiredAt) {
}
