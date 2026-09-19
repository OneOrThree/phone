package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 섬 정보 수정 결과 (GROMO-1802, 섬 관리 LLD §3.1) — 공개 응답과 같은 모양이다. {@code version} 은 공개 섬
 * 상태 축이고, 바뀐 것이 없는 수정은 새 사건 없이 현재 값을 준다.
 */
public record IslandManaged(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String name,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String intro,
        @JsonProperty(required = true) boolean approvalRequired,
        @JsonProperty(required = true) long version) {
}
