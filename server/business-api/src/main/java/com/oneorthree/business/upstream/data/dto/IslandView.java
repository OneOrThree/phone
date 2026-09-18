package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * {@code GET /internal/islands/{islandId}} 의 두 갈래 응답 (GROMO-1759, LLD §3.4).
 *
 * <p>{@code scope} 가 판별자다. Business 는 이 봉투를 <b>벗겨</b> 공개 응답으로 주민 상세 또는 공개
 * 요약 <b>하나만</b> 내려보낸다 — 공개 계약에는 판별자 키가 없다.
 *
 * <p>범위를 «상류가 정한다» 는 것이 요점이다. Business 는 {@code scope} 를 읽기만 하고 스스로
 * 판단하지 않는다 — 요청의 헤더/쿼리로 범위가 흔들릴 여지를 아예 만들지 않기 위해서다.
 */
public record IslandView(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String scope,
        IslandSummary visitor,
        IslandDetail member) {
}
