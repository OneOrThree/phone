package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

/**
 * {@code PUT /internal/islands/{islandId}/construction-target} 요청 본문 (LLD §2).
 * 목표 선택은 차감 0 — 잔액·costPolicyVersion 을 요구하지 않는다(정책 C03·C10).
 */
public record ConstructionTargetRequest(
        @NotBlank String buildingId,
        @NotNull @PositiveOrZero Long expectedVersion) {
}
