package com.oneorthree.phone.league.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

/** 사용자별 주간 리그 정산 결과 로그 (GROMO-814). */
@Entity
@Table(
        name = "league_weekly_results",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_league_weekly_results_user_week",
                columnNames = {"user_id", "week_start_at"})
)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class LeagueWeeklyResult {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "week_start_at", nullable = false)
    private Instant weekStartAt;

    @Column(name = "previous_tier_level", nullable = false)
    private int previousTierLevel;

    @Column(name = "new_tier_level", nullable = false)
    private int newTierLevel;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private LeagueWeeklyResultType result;

    @Column(name = "focus_seconds", nullable = false)
    private int focusSeconds;

    @Column(name = "acknowledged_at")
    private Instant acknowledgedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}
