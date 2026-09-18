package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * {@code POST /internal/islands/{islandId}/constructions} 요청 본문 (LLD §2).
 * {@code expectedVersion} 은 섬 상태 축, {@code expectedCostPolicyVersion} 은 가격
 * publication 축 — 둘 다 필수다(사용자가 본 가격으로 동의했는지 확인, C10).
 */
public record ConstructionStartRequest(
        @NotBlank String buildingId,
        @NotNull @PositiveOrZero Long expectedVersion,
        @NotNull @PositiveOrZero Long expectedCostPolicyVersion) {
}
