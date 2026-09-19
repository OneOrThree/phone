package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.time.Instant;
import java.util.UUID;

/**
 * 공용 음악 재생 상태 (GROMO-1779, island-playback LLD §2) — GET 응답과 PATCH data 가 공유한다.
 * 원본 7필드 + 확장 {@code durationSeconds}. {@code trackId}·{@code changedBy}·{@code durationSeconds}
 * 는 초기 미선택 상태에서만 null 이다 — 그 조합의 정합은 {@code PlaybackUseCase} 가 fail closed 로 본다.
 */
public record PlaybackState(
        @JsonProperty(required = true) String trackId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean playing,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long positionSeconds,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant effectiveAt,
        @JsonProperty(required = true) UUID changedBy,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long version,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) Instant serverNow,
        @JsonProperty(required = true) Double durationSeconds) {
}
