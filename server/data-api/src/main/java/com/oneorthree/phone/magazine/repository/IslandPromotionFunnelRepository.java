package com.oneorthree.phone.magazine.repository;

import com.oneorthree.phone.magazine.repository.domain.IslandPromotionFunnel;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/** 잡지 경유 행동 (GROMO-2289, V122). */
public interface IslandPromotionFunnelRepository
        extends JpaRepository<IslandPromotionFunnel, IslandPromotionFunnel.Key> {

    /** 한 단계를 남긴다 — 같은 사람의 같은 단계가 이미 있으면 아무것도 하지 않는다(처음 시각이 남는다). */
    @Modifying
    @Query(value = "INSERT INTO island_promotion_funnel (promotion_id, user_id, step, occurred_at) "
            + "VALUES (:promotionId, :userId, :step, :occurredAt) "
            + "ON CONFLICT (promotion_id, user_id, step) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("promotionId") UUID promotionId, @Param("userId") UUID userId,
                       @Param("step") String step, @Param("occurredAt") Instant occurredAt);

    boolean existsByPromotionIdAndUserIdAndStep(UUID promotionId, UUID userId, String step);

    /** 홍보마다 단계별 사람 수 — 기록판이 읽을 때마다 센다(「실시간」). */
    @Query("SELECT f.promotionId AS promotionId, f.step AS step, COUNT(f) AS people FROM IslandPromotionFunnel f "
            + "WHERE f.promotionId IN :promotionIds GROUP BY f.promotionId, f.step")
    List<StepCount> countByPromotionIdIn(@Param("promotionIds") Collection<UUID> promotionIds);

    /** {@link #countByPromotionIdIn} 결과 한 행. */
    interface StepCount {

        UUID getPromotionId();

        String getStep();

        long getPeople();
    }
}
