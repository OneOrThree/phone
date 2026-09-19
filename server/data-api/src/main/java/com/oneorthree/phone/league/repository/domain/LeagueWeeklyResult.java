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

    // 아래 넷은 탈퇴 파기로 null 이 된다(V65, GROMO-1801 · 계정 LLD §4). 그 행은 (user, weekStartAt)
    // 완료 마커로만 남아 재정산을 막는다 — 결과 발표·모달 조회는 활성 유저·result 조건으로 이미 빠진다.
    @Column(name = "previous_tier_level")
    private Integer previousTierLevel;

    @Column(name = "new_tier_level")
    private Integer newTierLevel;

    @Enumerated(EnumType.STRING)
    @Column(length = 16)
    private LeagueWeeklyResultType result;

    @Column(name = "focus_seconds")
    private Integer focusSeconds;

    @Column(name = "acknowledged_at")
    private Instant acknowledgedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
}
