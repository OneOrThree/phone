package com.oneorthree.phone.appearance.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * 카탈로그 불변 자산 정의 (GROMO-1783, island-appearance LLD §2 · island-shop LLD 모델표).
 *
 * <p>kind·ownerType·targetBuilding 은 productId 수명 동안 불변이다 — 외양 적용과 보유품 해석은
 * 활성 판매 publication 이 아니라 이 정의로 한다. 퇴역한 상품도 행이 남는다.
 */
@Entity
@Table(name = "catalog_assets")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CatalogAsset {

    /** 개인 착용 슬롯 — {@code clothes}/{@code decor}. */
    public static final String KIND_CLOTHES = "clothes";
    public static final String KIND_DECOR = "decor";
    /** 섬 공동 상품 — 테마와 음원. */
    public static final String KIND_ISLAND_THEME = "island_theme";
    public static final String KIND_BUILDING_THEME = "building_theme";
    public static final String KIND_AUDIO = "audio";

    public static final String OWNER_USER = "user";
    public static final String OWNER_ISLAND = "island";

    @Id
    @Column(name = "product_id", length = 80)
    private String productId;

    @Column(nullable = false, length = 120)
    private String title;

    @Column(nullable = false, length = 20)
    private String kind;

    @Column(name = "owner_type", nullable = false, length = 10)
    private String ownerType;

    /** {@link #KIND_BUILDING_THEME} 의 실제 대상 건물 ID. 그 외 kind 는 null. */
    @Column(name = "target_building", length = 30)
    private String targetBuilding;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /**
     * 불변 자산 정의 한 행 — 카탈로그 등록(운영 데이터 투입)의 유일한 생성 경로다. 조합 규칙(kind↔ownerType,
     * building_theme↔targetBuilding)은 DB CHECK 가 상주 감시한다.
     */
    public static CatalogAsset define(String productId, String title, String kind, String ownerType,
                                      String targetBuilding, Instant createdAt) {
        CatalogAsset asset = new CatalogAsset();
        asset.productId = productId;
        asset.title = title;
        asset.kind = kind;
        asset.ownerType = ownerType;
        asset.targetBuilding = targetBuilding;
        asset.createdAt = createdAt;
        return asset;
    }
}
