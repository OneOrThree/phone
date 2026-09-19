package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/**
 * 섬 가입 명령 결과 (GROMO-1760, 섬 소속 LLD §3.7).
 *
 * <p>{@code status} 가 두 형태를 가른다 — {@code "active"}(즉시 가입, {@code currentIslandId} 는
 * 그때의 확정 context) 또는 {@code "pending"}(승인 대기, {@code requestId} 만 채워진다).
 * 재생 응답도 같은 형태다 — Data 의 receipt 가 처음 확정한 결과를 그대로 돌려준다.
 */
public record JoinIslandResult(
        @JsonProperty(required = true) String status,
        @JsonProperty(required = true) UUID requestId,
        @JsonProperty(required = true) UUID islandId,
        @JsonProperty(required = true) UUID currentIslandId,
        @JsonProperty(required = true) long version) {
}
