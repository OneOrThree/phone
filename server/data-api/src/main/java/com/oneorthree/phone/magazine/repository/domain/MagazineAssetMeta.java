package com.oneorthree.phone.magazine.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * 잡지 꾸미기 재료(틀·스티커·테이프)의 부가 정보 (GROMO-2289, V113) — {@code catalog_assets} 행과 1:1 이다. 카탈로그 행은
 * 불변이라 종류 사본·서랍 탭·묶음·정렬·퇴역을 이 옆 표에 둔다. 행은 마이그레이션 시드와 운영 SQL 로만 생긴다 — 이 도메인은 읽기만
 * 한다.
 */
@Entity
@Table(name = "magazine_asset_meta")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MagazineAssetMeta {

    /** 모든 계정이 가진 것으로 보는 묶음 — 소유 행을 만들지 않는다(10/14 확정, 지금 에셋 전부). */
    public static final String BUNDLE_FREE = "free";

    @Id
    @Column(name = "product_id", length = 80)
    private String productId;

    /**
     * 카탈로그 종류의 사본 — {@code ad_frame} · {@code ad_sticker} · {@code ad_tape}. {@code (product_id, kind)} 복합 FK 가
     * 카탈로그와 어긋나지 못하게 한다.
     */
    @Column(nullable = false, length = 20)
    private String kind;

    /** {@code free} · {@code season}(바다 시즌 보상으로 owned_products 행이 생겨야 가진 것). */
    @Column(nullable = false, length = 10)
    private String bundle;

    /** 스티커 서랍 탭 — {@code cat} · {@code sea} · {@code friends} · {@code deco}. 스티커는 늘 있고 틀·테이프는 null(CHECK). */
    @Column(name = "drawer_tab", length = 10)
    private String drawerTab;

    /** 종류 안의 정렬 순서. */
    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    /** 서랍에서 내린 시각 — 이미 붙인 칸은 그대로 그린다. */
    @Column(name = "retired_at")
    private Instant retiredAt;

    /** 퇴역하지 않은 무료 재료 — 소유 행 없이 누구나 쓸 수 있다. */
    public boolean isFreeForAll() {
        return BUNDLE_FREE.equals(bundle) && retiredAt == null;
    }
}
