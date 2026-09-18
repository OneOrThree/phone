package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.OwnedProduct;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

/** 보유 여부·목록 조회 — 지급 writer 는 상점(1781)이며 이 도메인은 읽기만 한다. */
public interface OwnedProductRepository extends JpaRepository<OwnedProduct, UUID> {

    @Query("SELECT o FROM OwnedProduct o WHERE o.ownerType = 'user' AND o.userId = :userId "
            + "ORDER BY o.productId")
    List<OwnedProduct> findByUserId(@Param("userId") UUID userId);

    @Query("SELECT o FROM OwnedProduct o WHERE o.ownerType = 'island' AND o.groupId = :islandId "
            + "ORDER BY o.productId")
    List<OwnedProduct> findByIslandId(@Param("islandId") UUID islandId);

    @Query("SELECT COUNT(o) > 0 FROM OwnedProduct o "
            + "WHERE o.ownerType = 'user' AND o.userId = :userId AND o.productId = :productId")
    boolean existsByUserIdAndProductId(@Param("userId") UUID userId, @Param("productId") String productId);

    @Query("SELECT COUNT(o) > 0 FROM OwnedProduct o "
            + "WHERE o.ownerType = 'island' AND o.groupId = :islandId AND o.productId = :productId")
    boolean existsByIslandIdAndProductId(@Param("islandId") UUID islandId,
            @Param("productId") String productId);
}
