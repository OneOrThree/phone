package com.oneorthree.phone.construction.dto;

/**
 * {@code PUT /internal/islands/{islandId}/construction-target} 응답 (LLD §2·원본).
 * {@code spent} 는 항상 0 — 목표 선택은 돈이 들지 않는다. {@code version} 은 islandVersion 축이다.
 */
public record ConstructionTargetView(
        String buildingId,
        boolean selected,
        int spent,
        long version) {
}
