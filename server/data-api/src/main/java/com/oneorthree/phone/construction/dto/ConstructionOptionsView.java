package com.oneorthree.phone.construction.dto;

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
        List<ConstructionOptionItem> items) {
}
