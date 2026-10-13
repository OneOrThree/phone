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
 * 잡지 경유 행동 한 건 (GROMO-2289, V122) — 넣음·도착·가입. 같은 사람의 같은 단계는 한 번만 센다. 행은 리포지토리의
 * {@code insertIfAbsent} 로만 생긴다.
 */
@Entity
@Table(name = "island_promotion_funnel")
@IdClass(IslandPromotionFunnel.Key.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IslandPromotionFunnel {

    public static final String PIN = "PIN";
    public static final String ARRIVE = "ARRIVE";
    public static final String JOIN = "JOIN";

    @Id
    @Column(name = "promotion_id")
    private UUID promotionId;

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Id
    @Column(length = 8)
    private String step;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    /** 복합 키 — {@code (promotion_id, user_id, step)}. */
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode
    public static class Key implements Serializable {

        private UUID promotionId;
        private UUID userId;
        private String step;
    }
}
