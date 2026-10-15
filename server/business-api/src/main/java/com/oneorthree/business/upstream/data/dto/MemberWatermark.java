package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * 주민 투영 한 key 의 스냅샷 버전 (GROMO-1765, realtime-events LLD §5.1). Data 가 목록과 같은 DB 스냅샷에서
 * 읽은 값을 그대로 전달한다 — Business 가 version 을 새로 발급하지 않는다.
 *
 * @param projection  {@code "focus.member"} 또는 {@code "rest.member"}
 * @param islandId    섬
 * @param aggregateId 주민 userId
 * @param version     그 key 의 마지막 발급 version(사건이 없었으면 0)
 */
public record MemberWatermark(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String projection,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String islandId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String aggregateId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long version) {
}
