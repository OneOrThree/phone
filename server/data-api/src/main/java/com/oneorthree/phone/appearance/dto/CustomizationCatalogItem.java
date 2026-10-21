package com.oneorthree.phone.appearance.dto;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * GET /internal/customization/catalog 의 한 행 (GROMO-2331) — imagePath 는 상대 경로다(절대 URL 은 Business 가 붙인다).
 * retiredAt 이 있으면 서랍에서 내린 상품이다 — 가진 사람은 계속 그린다.
 */
public record CustomizationCatalogItem(
        String productId,
        String kind,
        String slot,
        String title,
        String imagePath,
        int width,
        int height,
        BigDecimal anchorX,
        BigDecimal anchorY,
        int sortOrder,
        Instant retiredAt) {
}
