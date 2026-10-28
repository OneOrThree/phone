package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.List;
import java.util.UUID;

/**
 * Data 내부 계정 projection (GROMO-1801 · 계정 LLD §2.2). 공개 응답은 AccountUseCase에서 별도 DTO로 조립한다.
 * name·catColor·mainIslandId 는 온보딩 전·무소속 상태를 표현하는 null 을 허용하고, 나머지는 빠지면 계약 불일치(502)다.
 */
public record AccountMe(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID id,
        @JsonProperty(required = true) String name,
        @JsonProperty(required = true) String catColor,
        // 메인 섬(GROMO-1971) — 소속이 하나도 없으면 null 이다. «지금 접속한 섬»과 다른 축이라 섞지 않는다.
        @JsonProperty(required = true) UUID mainIslandId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) List<String> linkedProviders,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean onboardingComplete) {
}
