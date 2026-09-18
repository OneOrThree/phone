package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;
import java.util.UUID;

/**
 * 내 섬 목록 (GROMO-1759, LLD §3.5).
 *
 * <p>{@code currentIslandId} 는 {@code required = true} 지만 {@link Nulls#FAIL} 이 <b>아니다</b> —
 * 현재 섬이 없는 것은 정상이라 {@code {"currentIslandId":null}} 은 통과시키고, 키가 아예 빠진 응답만
 * 계약 위반으로 잡는다(GROMO-1764 의 {@code CurrentFocusSession} 과 같은 관례).
 */
public record MyIslands(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.AS_EMPTY) List<IslandSummary> items,
        @JsonProperty(required = true) UUID currentIslandId) {
}
