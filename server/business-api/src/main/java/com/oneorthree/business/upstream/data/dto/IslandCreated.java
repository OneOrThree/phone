package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/** 섬 생성 결과 (GROMO-1759, LLD §3.1). 생성자는 그 자리에서 방장이 되고 현재 섬이 새 섬이 된다. */
public record IslandCreated(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String membershipStatus,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String role,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID currentIslandId) {
}
