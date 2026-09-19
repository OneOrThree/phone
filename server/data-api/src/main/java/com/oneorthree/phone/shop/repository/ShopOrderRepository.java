package com.oneorthree.phone.shop.repository;

import com.oneorthree.phone.shop.repository.domain.ShopOrder;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 주문 내역 — 섬 귀속(BG18). personal 은 그 섬 안의 본인 주문, shared 는 그 섬의 공동(ownerType=island) 주문이다.
 * 정렬은 {@code (createdAt DESC, id DESC)} keyset.
 */
public interface ShopOrderRepository extends JpaRepository<ShopOrder, UUID> {

    @Query("SELECT o FROM ShopOrder o WHERE o.islandId = :islandId AND o.requesterId = :userId"
            + " ORDER BY o.createdAt DESC, o.id DESC")
    List<ShopOrder> findPersonalFirstPage(@Param("islandId") UUID islandId, @Param("userId") UUID userId,
            Pageable pageable);

    @Query("SELECT o FROM ShopOrder o WHERE o.islandId = :islandId AND o.requesterId = :userId"
            + " AND (o.createdAt < :afterCreatedAt OR (o.createdAt = :afterCreatedAt AND o.id < :afterId))"
            + " ORDER BY o.createdAt DESC, o.id DESC")
    List<ShopOrder> findPersonalPageAfter(@Param("islandId") UUID islandId, @Param("userId") UUID userId,
            @Param("afterCreatedAt") Instant afterCreatedAt, @Param("afterId") UUID afterId, Pageable pageable);

    @Query("SELECT o FROM ShopOrder o WHERE o.islandId = :islandId AND o.ownerType = 'island'"
            + " ORDER BY o.createdAt DESC, o.id DESC")
    List<ShopOrder> findSharedFirstPage(@Param("islandId") UUID islandId, Pageable pageable);

    @Query("SELECT o FROM ShopOrder o WHERE o.islandId = :islandId AND o.ownerType = 'island'"
            + " AND (o.createdAt < :afterCreatedAt OR (o.createdAt = :afterCreatedAt AND o.id < :afterId))"
            + " ORDER BY o.createdAt DESC, o.id DESC")
    List<ShopOrder> findSharedPageAfter(@Param("islandId") UUID islandId,
            @Param("afterCreatedAt") Instant afterCreatedAt, @Param("afterId") UUID afterId, Pageable pageable);
}
