package com.oneorthree.phone.appearance.repository;

import com.oneorthree.phone.appearance.repository.domain.OwnedProduct;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 보유 여부·목록 조회 — 지급 writer 는 상점(1781)이며 이 도메인은 계정 탈퇴 파기 외엔 읽기만 한다. */
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

    /**
     * 적용 경로 전용 보유 행 공유 잠금 — <b>반드시 트랜잭션 안에서, 외양 행 잠금 전에</b>.
     * 회수 writer 가 이 행을 배타로 지우므로, 적용과 회수가 보유 행에서 직렬화된다: 적용이 먼저면
     * 회수는 방금 커밋된 장착까지 보고 해제하고, 회수가 먼저면 이 조회가 빈 결과(403)다.
     * 잠금 순서: caller → (섬: groups → 멤버십) → 카탈로그 정의 → 보유 → 외양.
     */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("SELECT o FROM OwnedProduct o "
            + "WHERE o.ownerType = 'user' AND o.userId = :userId AND o.productId = :productId")
    Optional<OwnedProduct> findUserProductForShare(@Param("userId") UUID userId,
            @Param("productId") String productId);

    /** {@link #findUserProductForShare} 의 섬 소유판 — 같은 잠금 순서를 따른다. */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("SELECT o FROM OwnedProduct o "
            + "WHERE o.ownerType = 'island' AND o.groupId = :islandId AND o.productId = :productId")
    Optional<OwnedProduct> findIslandProductForShare(@Param("islandId") UUID islandId,
            @Param("productId") String productId);

    /**
     * 계정 탈퇴 파기 (GROMO-1950) — 개인 소유 행만 지운다. 섬 소유 행은 user_id 가 비어 있어(CHECK) 애초에
     * 걸리지 않지만 ownerType 을 명시해 의도를 드러낸다. 호출측이 users 배타 잠금을 쥔 탈퇴 TX 에서만 부른다.
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM OwnedProduct o WHERE o.ownerType = 'user' AND o.userId = :userId")
    int deleteUserOwnedOf(@Param("userId") UUID userId);
}
