package com.oneorthree.phone.magazine.repository;

import com.oneorthree.phone.magazine.repository.domain.IslandPromotionReport;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.UUID;

/** 홍보 칸 신고 (GROMO-2289, V121). */
public interface IslandPromotionReportRepository
        extends JpaRepository<IslandPromotionReport, IslandPromotionReport.Key> {

    /** 신고를 남긴다 — 같은 사람이 이미 신고했으면 아무것도 하지 않는다(처음 사유가 남는다). @return 새로 남겼으면 1 */
    @Modifying
    @Query(value = "INSERT INTO island_promotion_reports (promotion_id, reporter_id, reason, created_at) "
            + "VALUES (:promotionId, :reporterId, :reason, :createdAt) "
            + "ON CONFLICT (promotion_id, reporter_id) DO NOTHING", nativeQuery = true)
    int insertIfAbsent(@Param("promotionId") UUID promotionId, @Param("reporterId") UUID reporterId,
                       @Param("reason") String reason, @Param("createdAt") Instant createdAt);

    long countByPromotionId(UUID promotionId);
}
