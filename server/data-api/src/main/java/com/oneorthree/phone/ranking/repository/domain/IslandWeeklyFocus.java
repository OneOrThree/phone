package com.oneorthree.phone.ranking.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * 주간 섬 랭킹 <b>분자</b>의 read model 한 행 (GROMO-2343, migration V130) — (UTC 일요일 주, 섬)의 끝난 섬 집중
 * ACTIVE 마이크로초 합.
 *
 * <p>쓰기·읽기는 {@code IslandWeeklyFocusRepository} 의 네이티브 SQL 이 전부다. 이 매핑은 스키마 선언용이다 —
 * Flyway 없이 엔티티로 스키마를 만드는 CI 프로필에도 표가 있어야 완료 전이가 가산할 수 있다
 * ({@link IslandWeeklyMemberCount} 와 같은 이유).
 */
@Entity
@Table(name = "island_weekly_focus")
@IdClass(IslandWeeklyFocus.Key.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IslandWeeklyFocus {

    @Id
    @Column(name = "week_start", nullable = false)
    private LocalDate weekStart;

    @Id
    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    /** 초가 아니라 μs 다 — 섬마다 «마지막에 한 번만» 내려야 원본 집계와 같다(V130 주석). */
    @Column(name = "active_micros", nullable = false)
    private long activeMicros;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** 복합 PK — (weekStart, islandId). */
    @Getter
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode
    public static class Key implements Serializable {

        private LocalDate weekStart;
        private UUID islandId;
    }
}
