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
import java.time.LocalDate;
import java.util.UUID;

/**
 * 섬별 «최근 7일 주민 1명당 하루 평균 집중(분)» 일 스냅샷 한 행 (GROMO-2257, migration V109).
 *
 * <p>쓰기는 {@code IslandFocusAverageRepository.insertIfAbsent} 한 문장이 전부다. 이 매핑은 스키마 선언용이자
 * 읽기 결과의 모양이다 — {@code IslandWeeklyMemberCount} 와 같이 {@code island_id} 를 그냥 UUID 열로 들고
 * {@code group} 엔티티를 매핑하지 않는다(그래서 {@code ranking} 이 {@code group} 위로 올라가지 않는다).
 * {@code computed_at}(배치가 적은 시각)은 운영 관측용이라 매핑하지 않는다 — DB 기본값이 채운다.
 */
@Entity
@Table(name = "island_focus_averages")
@IdClass(IslandFocusAverage.Key.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IslandFocusAverage {

    /** 배치가 도는 날의 KST 날짜 — 창은 이 날 07:00 KST 에서 7일 전 07:00 KST 까지다. */
    @Id
    @Column(name = "snapshot_date", nullable = false)
    private LocalDate snapshotDate;

    @Id
    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    /** 계산 시점의 현재 주민 수. 0 이면 {@link #avgMinutesPerMemberDay} 는 null 이다. */
    @Column(name = "member_count", nullable = false)
    private int memberCount;

    /** 주민 1명당 하루 평균 집중(분, 반올림). null = 주민 0명. 주민이 있고 집중이 없으면 0 이다. */
    @Column(name = "avg_minutes_per_member_day")
    private Integer avgMinutesPerMemberDay;

    /** 복합 PK — (snapshotDate, islandId). */
    @Getter
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode
    public static class Key implements Serializable {

        private LocalDate snapshotDate;
        private UUID islandId;
    }
}
