package com.oneorthree.phone.league.domain;

import com.oneorthree.phone.user.domain.User;

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
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(
        name = "league_arena_users",
        uniqueConstraints = @UniqueConstraint(columnNames = {"league_arena_id", "user_id"})
)
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class LeagueArenaUser {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "league_arena_id", nullable = false)
    private LeagueArena leagueArena;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "tier_level", nullable = false)
    private int tierLevel;

    @Builder.Default
    private int totalFocusMinutes = 0;

    private Integer rank;

    @Enumerated(EnumType.STRING)
    private LeagueMemberResult result;

    /** 세션 완료 시 주간 누적 집중 시간(분)을 더한다 (GROMO-646). 더티 체킹으로 반영. */
    public void addFocusMinutes(int minutes) {
        this.totalFocusMinutes += minutes;
    }
}
