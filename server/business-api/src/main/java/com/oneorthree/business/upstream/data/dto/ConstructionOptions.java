package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 건설 옵션 스냅샷 (GROMO-1767, LLD §2). 공개 GET 의 {@code data} 와 같은 필드라 그대로 내보낸다.
 *
 * <p>세 버전 축은 서로 독립이다 — {@code islandVersion} 은 목표·시설, {@code costPolicyVersion} 은
 * 가격 publication, {@code walletVersion} 은 공동 잔액의 최신성 증거다(C10·C12). {@code items} 는
 * 아직 완공하지 않은 건물만 담고, {@code blockedReason} 은 HTTP 오류 코드가 아니라 UI 사유다.
 */
public record ConstructionOptions(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long islandVersion,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long costPolicyVersion,
        @JsonProperty(required = true) String selectedBuildingId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long villagePoints,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long walletVersion,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<Item> items) {

    /** {@code blockedReason} 만 null 허용 — 통과하면 null, 아니면 FORBIDDEN 등 UI 사유다. */
    @Schema(name = "ConstructionOptionItem")
    public record Item(
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String id,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String name,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long cost,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String currency,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean selectable,
            @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean buildable,
            @JsonProperty(required = true) String blockedReason) {
    }
}
