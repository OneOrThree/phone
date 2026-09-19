package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.Map;

/**
 * 공동 외양 전체 맵 스냅샷 (GROMO-1783) — GET inventory 의 appearance 와 PATCH 의 data 가
 * 공유한다. buildingThemes 는 「완공 건물 → ThemeId|default」의 전체 맵이다.
 */
public record IslandAppearanceState(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String islandThemeId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Map<String, String> buildingThemes,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long version) {
}
