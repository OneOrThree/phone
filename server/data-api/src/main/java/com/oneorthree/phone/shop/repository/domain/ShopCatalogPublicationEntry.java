package com.oneorthree.phone.shop.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 발행본 항목 (GROMO-1781, island-shop LLD §3) — {@code (publicationVersion, productId)} 유일.
 * 한 발행본의 상품 집합·정렬을 복원한다. category 는 personal / island / sound.
 */
@Entity
@Table(name = "shop_catalog_publication_entries")
@IdClass(ShopCatalogPublicationEntryId.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ShopCatalogPublicationEntry {

    @Id
    @Column(name = "publication_version", nullable = false)
    private long publicationVersion;

    @Id
    @Column(name = "product_id", nullable = false, length = 80)
    private String productId;

    @Column(name = "product_revision", nullable = false)
    private int productRevision;

    @Column(nullable = false, length = 20)
    private String category;

    @Column(name = "display_order", nullable = false)
    private int displayOrder;
}
