package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

import java.util.UUID;

/**
 * {@code POST /internal/users/{userId}/telescope/pins} 본문 (GROMO-2268, 섬 외부 계약 §6).
 *
 * @param islandId 망원경에 넣을 섬
 * @param source   {@code magazine}(잡지) 또는 {@code observatory}(전망대 검색·랭킹) — V115 의 CHECK 와 같다
 */
public record TelescopePinCommandRequest(
        @NotNull UUID islandId,
        @NotNull @Pattern(regexp = "magazine|observatory") String source,
        UUID promotionId) {
}
