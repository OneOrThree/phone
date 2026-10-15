package com.oneorthree.phone.shop.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * 카탈로그 발행본 (GROMO-1781, island-shop LLD §3) — {@code version} 이 catalogPublicationVersion 이다.
 * 컬렉션 전체의 불변 발행본이며 퇴역·폐기 시각만 나중에 채운다.
 */
@Entity
@Table(name = "shop_catalog_publications")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ShopCatalogPublication {

    @Id
    @Column(nullable = false)
    private long version;

    @Column(name = "published_at", nullable = false)
    private Instant publishedAt;

    @Column(name = "retired_at")
    private Instant retiredAt;

    @Column(name = "invalidated_at")
    private Instant invalidatedAt;

    /** 새 발행본 — 활성화는 {@link ShopCatalogActivePublication#pointTo} 가 따로 한다. */
    public static ShopCatalogPublication published(long version, Instant publishedAt) {
        ShopCatalogPublication p = new ShopCatalogPublication();
        p.version = version;
        p.publishedAt = publishedAt;
        return p;
    }
}
