package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/**
 * 현재 섬 (GROMO-1759, LLD §3.6).
 *
 * <p>{@code required = true} 이되 {@code Nulls.FAIL} 은 아니다 — 값이 null 인 것과 키가 없는 것을
 * 가른다. 한 칸짜리 record 라 응답이 빈 본문이 되는 일도 없다.
 */
public record CurrentIsland(@JsonProperty(required = true) UUID currentIslandId) {
}
