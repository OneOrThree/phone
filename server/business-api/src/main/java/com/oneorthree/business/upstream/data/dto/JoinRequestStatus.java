package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 가입 요청 상태 (GROMO-1760, 섬 소속 LLD §3.8).
 *
 * <p>남의 요청은 Data 가 404 로 접는다 — 여기 도달한 응답은 본인 소유가 확인된 것이다.
 * 종결된 요청(approved·rejected·cancelled)도 같은 형태로 계속 조회된다.
 */
public record JoinRequestStatus(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID islandId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String status,
        @JsonProperty(required = true) long version) {
}
