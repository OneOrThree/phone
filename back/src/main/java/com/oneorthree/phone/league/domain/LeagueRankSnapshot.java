package com.oneorthree.phone.league.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDate;
import java.util.UUID;

/** 전역 일간 순위 스냅샷. 어제 순위와 오늘 순위를 비교해 나를 제친 사용자를 감지한다. */
@Entity
@Table(
        name = "league_rank_snapshots",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_league_rank_snapshots_user_day",
                columnNames = {"user_id", "created_at"})
)
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class LeagueRankSnapshot {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false)
    private int rank;

    /**
     * 스냅샷을 찍은 KST 캘린더 날짜 — 어제(created_at = 어제)와 오늘 비교의 키 (구 captured_on, 날짜 타입 유지)
     */
    @Column(name = "created_at", nullable = false)
    private LocalDate createdAt;
}
