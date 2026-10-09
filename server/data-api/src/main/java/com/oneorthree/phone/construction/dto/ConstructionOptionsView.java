package com.oneorthree.phone.construction.dto;

import java.time.Instant;
import java.util.List;

/**
 * {@code GET /internal/islands/{islandId}/construction-options} 응답 (LLD §2).
 *
 * <p>세 version 축은 <b>같은 스냅샷</b>에서 읽은 값이다 — {@code islandVersion}(섬 상태),
 * {@code costPolicyVersion}(가격 publication), {@code walletVersion}(공동 지갑). 셋은 서로
 * 독립인 각 projection 의 시계라 비교하지 않는다(C10·C12).
 */
public record ConstructionOptionsView(
        long islandVersion,
        int costPolicyVersion,
        String selectedBuildingId,
        int villagePoints,
        long walletVersion,
        List<ConstructionOptionItem> items,
        ConstructionResidentProgress residentProgress,
        ActiveConstruction activeConstruction) {

    /** 다른 기기에서도 진행 중인 공사를 식별하고 완공 여부를 재조회할 수 있는 구간. */
    public record ActiveConstruction(String buildingId, Instant startedAt, Instant completesAt) {
    }
}
