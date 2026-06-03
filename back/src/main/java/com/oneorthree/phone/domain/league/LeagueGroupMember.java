package com.oneorthree.phone.domain.league;

import com.oneorthree.phone.domain.user.User;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
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

@Entity
@Table(
        name = "league_group_members",
        uniqueConstraints = @UniqueConstraint(columnNames = {"league_group_id", "user_id"})
)
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class LeagueGroupMember {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "league_group_id", nullable = false)
    private LeagueGroup leagueGroup;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Builder.Default
    private int totalFocusMinutes = 0;

    private Integer rank;

    @Builder.Default
    @Column(nullable = false)
    private boolean promoted = false;

    @Builder.Default
    @Column(nullable = false)
    private boolean relegated = false;

    @Builder.Default
    @Column(nullable = false)
    private boolean relegateWarning = false;
}
