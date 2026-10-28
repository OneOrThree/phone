package com.oneorthree.phone.shop.repository;

import com.oneorthree.phone.shop.repository.domain.ShopCatalogPublicationEntry;
import com.oneorthree.phone.shop.repository.domain.ShopCatalogPublicationEntryId;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface ShopCatalogPublicationEntryRepository
        extends JpaRepository<ShopCatalogPublicationEntry, ShopCatalogPublicationEntryId> {

    /** 카탈로그 첫 페이지 — 발행본·카테고리 안에서 {@code (displayOrder ASC, productId ASC)}. */
    @Query("SELECT e FROM ShopCatalogPublicationEntry e WHERE e.publicationVersion = :version"
            + " AND e.category = :category ORDER BY e.displayOrder, e.productId")
    List<ShopCatalogPublicationEntry> findFirstPage(@Param("version") long version,
            @Param("category") String category, Pageable pageable);

    /** 카탈로그 다음 페이지 — 직전 페이지 마지막 항목의 정렬키 뒤. 발행본이 불변이라 중복·누락이 없다. */
    @Query("SELECT e FROM ShopCatalogPublicationEntry e WHERE e.publicationVersion = :version"
            + " AND e.category = :category AND (e.displayOrder > :afterOrder"
            + " OR (e.displayOrder = :afterOrder AND e.productId > :afterProductId))"
            + " ORDER BY e.displayOrder, e.productId")
    List<ShopCatalogPublicationEntry> findPageAfter(@Param("version") long version,
            @Param("category") String category, @Param("afterOrder") int afterOrder,
            @Param("afterProductId") String afterProductId, Pageable pageable);
}
