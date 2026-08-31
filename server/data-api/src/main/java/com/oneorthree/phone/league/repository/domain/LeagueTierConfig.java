package com.oneorthree.phone.league.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(name = "league_tier_configs")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class LeagueTierConfig {

    @Id
    @Column(name = "tier_level")
    private Integer tierLevel;

    @Column(name = "badge_id", nullable = false)
    private String badgeId;

    /** 주간 집중 시간 기준 승격 임계값(초). */
    @Column(name = "promotion_time", nullable = false)
    private int promotionTime;

    /** 주간 집중 시간 기준 강등 임계값(초). T1은 하위 티어가 없어 0이다. */
    @Column(name = "relegation_time", nullable = false)
    private int relegationTime;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @PrePersist
    @PreUpdate
    void validateTimeThresholds() {
        if (tierLevel == null || tierLevel < 1 || tierLevel > 5) {
            throw new IllegalStateException("리그 티어는 1부터 5 사이여야 합니다.");
        }
        if (relegationTime < 0 || (tierLevel > 1 && relegationTime == 0)) {
            throw new IllegalStateException("강등 임계값은 T1만 0일 수 있고 나머지는 양수여야 합니다.");
        }
        if (promotionTime <= relegationTime) {
            throw new IllegalStateException("승격 임계값은 강등 임계값보다 커야 합니다.");
        }
    }
}
