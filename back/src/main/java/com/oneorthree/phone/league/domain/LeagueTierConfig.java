package com.oneorthree.phone.league.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

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

    @Column(name = "arena_size", nullable = false)
    @Builder.Default
    private int arenaSize = 30;

    @Column(nullable = false)
    private int promoteCount;

    @Column(nullable = false)
    private int relegateCount;

    @Column(nullable = false)
    private int relegateWarningCount;
}
