package com.oneorthree.phone.magazine.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

/**
 * 홍보 칸 신고 한 건 (GROMO-2289, V121) — 한 사람은 한 칸을 한 번만 신고한다. 행은 리포지토리의 {@code insertIfAbsent} 로만
 * 생긴다.
 */
@Entity
@Table(name = "island_promotion_reports")
@IdClass(IslandPromotionReport.Key.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IslandPromotionReport {

    @Id
    @Column(name = "promotion_id")
    private UUID promotionId;

    @Id
    @Column(name = "reporter_id")
    private UUID reporterId;

    /** 유저 신고 창과 같은 8종(V121 CHECK). */
    @Column(nullable = false, length = 30)
    private String reason;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** 복합 키 — {@code (promotion_id, reporter_id)}. */
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode
    public static class Key implements Serializable {

        private UUID promotionId;
        private UUID reporterId;
    }
}
