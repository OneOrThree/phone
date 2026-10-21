package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 섬 도착 결과 (GROMO-2260) — Data {@code IslandArrivalView} 와 같은 필드다.
 *
 * @param currentIslandId 도착 처리 뒤 현재 섬. 방문(비주민)이면 그대로이고 없으면 null
 */
public record IslandArrival(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID islandId,
        @JsonProperty(required = true) boolean arrivedBefore,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String membershipStatus,
        UUID currentIslandId) {
}
