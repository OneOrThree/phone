package com.oneorthree.phone.league.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "league_arenas")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class LeagueArena {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tier_level", nullable = false)
    private LeagueTierConfig tierConfig;

    @Column(name = "week_start_at", nullable = false)
    private Instant weekStartAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private LeagueArenaStatus status = LeagueArenaStatus.ACTIVE;

    @Column(name = "ended_at")
    private Instant endedAt;

    // 주간 마감 — 아레나를 ENDED 로 전환하고 마감 시각을 기록한다
    public void end(Instant endedAt) {
        // 이미 ENDED 상태이면 배치 멱등성 재실행 경로를 위해 조용히 무시한다
        if (this.status == LeagueArenaStatus.ENDED) {
            return;
        }
        this.status = LeagueArenaStatus.ENDED;
        this.endedAt = endedAt;
    }
}
