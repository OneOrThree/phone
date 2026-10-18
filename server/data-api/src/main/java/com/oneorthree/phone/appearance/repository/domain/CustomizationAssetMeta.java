package com.oneorthree.phone.appearance.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * 개인 꾸미기 상품의 그림 부가 정보 (GROMO-2331, V128) — catalog_assets 와 1:1. 읽기 전용이다:
 * 행은 운영이 SQL 로 넣는다.
 */
@Entity
@Table(name = "customization_asset_meta")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CustomizationAssetMeta {

    @Id
    @Column(name = "product_id", length = 80)
    private String productId;

    @Column(nullable = false, length = 20)
    private String kind;

    @Column(nullable = false, length = 10)
    private String slot;

    @Column(name = "image_path", nullable = false, length = 200)
    private String imagePath;

    @Column(nullable = false)
    private int width;

    @Column(nullable = false)
    private int height;

    @Column(name = "anchor_x", nullable = false, precision = 5, scale = 4)
    private BigDecimal anchorX;

    @Column(name = "anchor_y", nullable = false, precision = 5, scale = 4)
    private BigDecimal anchorY;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Column(name = "retired_at")
    private Instant retiredAt;
}
