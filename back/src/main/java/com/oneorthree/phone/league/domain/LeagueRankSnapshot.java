package com.oneorthree.phone.league.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
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

/**
 * 아레나별 일간 순위 스냅샷 (GROMO-579 — 순위 추월 푸시).
 *
 * <p>매일 배치가 ACTIVE 아레나 멤버의 그날 순위(findRankedByArena index+1)를 captured_on 날짜로 저장한다.
 * 다음 날 배치가 "어제 스냅샷"과 "오늘 실시간 순위"를 비교해 나를 제친 라이벌을 감지한다.
 * (arena_id, user_id, captured_on) UNIQUE 로 하루 1행/멤버 보장 — 재실행 시 upsert(save 로 갱신).
 */
@Entity
@Table(
        name = "league_rank_snapshots",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_league_rank_snapshots_arena_user_day",
                columnNames = {"arena_id", "user_id", "captured_on"}),
        indexes = @Index(name = "idx_league_rank_snapshots_user_day", columnList = "user_id, captured_on")
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

    // 순위 비교는 아레나 단위 — league_arenas.id 사본을 UUID 로 직접 보관(엔티티 조인 불필요, 배치가 값만 씀)
    @Column(name = "arena_id", nullable = false)
    private UUID arenaId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false)
    private int rank;

    // 스냅샷을 찍은 KST 캘린더 날짜 — 어제(captured_on = 어제)와 오늘 비교의 키
    @Column(name = "captured_on", nullable = false)
    private LocalDate capturedOn;
}
