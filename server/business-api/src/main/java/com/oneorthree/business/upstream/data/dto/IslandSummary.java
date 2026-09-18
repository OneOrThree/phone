package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 섬 공개 요약 (GROMO-1759, 섬 소속 LLD §2 {@code PublicIslandSummary}).
 *
 * <p>Data 가 whitelist 로 조립해 준 값을 그대로 공개한다 — Business 가 주민 상세를 받아 필드를 지워
 * 만드는 일은 없다.
 *
 * <p>{@code growthStage}·{@code themeId} 에 {@code required} 를 걸지 <b>않았다</b>. 두 값의 정본을
 * 소유하는 건설·외양 도메인이 아직 없어 Data 가 null 로 내려보내기 때문이다. 건설 도메인이 합류하면
 * 그때 다른 필드와 같이 필수로 올린다 — 지금 필수로 걸면 정상 응답이 502 로 뒤집힌다.
 */
public record IslandSummary(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String name,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String intro,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String visibility,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean approvalRequired,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int memberCount,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String membershipStatus,
        String growthStage,
        String themeId) {
}
