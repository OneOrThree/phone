package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import tools.jackson.databind.JsonNode;

/**
 * 공용 음악 PATCH 내부 결과 (GROMO-1779) — {@code data} 가 공개 응답 본문이고 {@code events} 는
 * Data 가 같은 TX 에 outbox 에 적은 전송용 봉투다(생산 게이트가 꺼져 있으면 빈 배열).
 */
public record PlaybackPatchResult(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) PlaybackState data,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) JsonNode events) {
}
