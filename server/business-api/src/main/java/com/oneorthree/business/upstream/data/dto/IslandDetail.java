package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 활성 주민용 섬 상세 (GROMO-1759, LLD §2 {@code MemberIslandDetail}).
 *
 * <p>건설·외양 필드({@code buildings}·{@code assetVersion}·{@code initialConstruction}·
 * {@code constructionTarget}·{@code buildingThemes})는 <b>아직 없다</b> — 그 정본을 소유하는 도메인이
 * data-api 에 구현돼 있지 않다. LLD §2 가 "건설·테마 재료 계약 확정 전 해당 신규 상세 응답은 완성된
 * 것으로 계산하지 않는다"고 한 자리이며, 빈 배열을 지어내 «구현된 것처럼» 보이게 하지 않는다.
 */
public record IslandDetail(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String name,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String intro,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String visibility,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean approvalRequired,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int memberCount,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) int maxMembers,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String membershipStatus,
        String growthStage,
        String themeId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String role,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long version) {
}
