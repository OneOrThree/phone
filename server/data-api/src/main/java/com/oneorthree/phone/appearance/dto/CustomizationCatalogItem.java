package com.oneorthree.phone.appearance.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;

/**
 * GET /internal/customization/catalog 의 한 행 (GROMO-2331) — imagePath 는 상대 경로다(절대 URL 은 Business 가 붙인다).
 * retiredAt 이 있으면 서랍에서 내린 상품이다 — 가진 사람은 계속 그린다.
 *
 * <p>집중 보상 머리·목(GROMO-2382)은 정적 오버레이가 아니라 {@code renderData}(customization_reward_items.render_data
 * 원문)로 그린다 — 이 행은 width·height·anchorX·anchorY 가 null 이고 imagePath 는 render_data.source.path 다.
 * 정적 오버레이 행은 renderData 를 싣지 않아 이전 응답과 같다.
 */
public record CustomizationCatalogItem(
        String productId,
        String kind,
        String slot,
        String title,
        String imagePath,
        Integer width,
        Integer height,
        BigDecimal anchorX,
        BigDecimal anchorY,
        int sortOrder,
        Instant retiredAt,
        @JsonInclude(JsonInclude.Include.NON_NULL) Map<String, Object> renderData) {
}
