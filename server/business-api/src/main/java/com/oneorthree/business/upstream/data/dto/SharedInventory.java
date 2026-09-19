package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;

/**
 * 공동 인벤토리 (GROMO-1783, LLD §3 GET /islands/{islandId}/inventory). 공개 GET 의
 * {@code data} 와 같은 필드라 그대로 내보낸다.
 */
public record SharedInventory(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<String> audio,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<String> islandThemes,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<BuildingTheme> buildingThemes,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long inventoryVersion,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) IslandAppearanceState appearance) {

    /** 건물 전용 테마 1건 — 어떤 건물의 테마인지 계약에 포함된다. */
    public record BuildingTheme(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String buildingId,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String themeId) {
    }
}
