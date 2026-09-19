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
 * 현재 활성 발행본 포인터 (GROMO-1781, island-shop LLD §3) — 싱글톤. 상품별 현재 정의도 이
 * 발행본의 항목으로 정한다. 행이 없으면 활성 카탈로그가 없다 — 가격 확정(S03) 전 상태다.
 */
@Entity
@Table(name = "shop_catalog_active_publication")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ShopCatalogActivePublication {

    @Id
    @Column(nullable = false)
    private boolean singleton;

    @Column(name = "publication_version", nullable = false)
    private long publicationVersion;

    @Column(name = "activated_at", nullable = false)
    private Instant activatedAt;
}
