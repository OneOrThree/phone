package com.oneorthree.phone.league.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
    @Enumerated(EnumType.STRING)
    private LeagueTier tier;

    @Column(nullable = false)
    @Builder.Default
    private int groupSize = 30;

    @Column(nullable = false)
    private int promoteCount;

    @Column(nullable = false)
    private int relegateCount;

    @Column(nullable = false)
    private int relegateWarningCount;
}
