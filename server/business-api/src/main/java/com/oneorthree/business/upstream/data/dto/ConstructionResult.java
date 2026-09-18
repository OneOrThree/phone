package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * 건설 명령 결과 (GROMO-1767). 공개 POST 의 {@code data} 와 같은 필드라 그대로 내보낸다.
 *
 * <p>승인 정책상 {@code status} 는 {@code "BUILDING"} 이다 — 공사 시간이 있는 동안 시설은 완공이
 * 아니라 건설 중이며 {@code startedAt}/{@code completesAt} 이 그 구간이다. 시각은 계산하지 않고
 * 문자열로 전달한다(FocusSessionState 와 같은 취급). {@code walletVersion} 은 반환 잔액의
 * 최신성 증거다(C12).
 */
public record ConstructionResult(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String buildingId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String status,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Spent spent,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long version,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long villagePoints,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long walletVersion,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String startedAt,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String completesAt) {

    /** 실제 차감 — 통화는 섬 통장 {@code village_points} 다(C05). */
    public record Spent(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String currency,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long amount) {
    }
}
