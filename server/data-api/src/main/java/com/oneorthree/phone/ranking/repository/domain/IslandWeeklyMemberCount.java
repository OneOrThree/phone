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
 * 주간 섬 랭킹의 <b>동결된 분모</b> 한 행 (GROMO-1997, migration V85) — 주 마감(UTC 일요일 00:00Z) 시점의
 * 그 섬 활성 주민 수.
 *
 * <p>쓰기는 {@code IslandWeeklyMemberCountRepository.freeze} 한 문장이 전부다. 이 매핑은 스키마 선언용이다 —
 * Flyway 없이 엔티티로 스키마를 만드는 CI 프로필에도 표가 있어야 한다({@code IslandQuestCohortMember} 와 같은 이유).
 *
 * <p>왜 동결하는가: {@code group_members} 는 (user_id, group_id) 한 행이고 {@code left_at} 이 없어
 * 「그 주에 몇 명이었나」를 사후에 복원할 방법이 없다. 동결하지 않고 «지금» 인원으로 나누면 주민을 내보내는
 * 것만으로 지난 주 평균이 올라간다 — 강퇴로 순위를 올리는 조작이 성립한다.
 */
@Entity
@Table(name = "island_weekly_member_counts")
@IdClass(IslandWeeklyMemberCount.Key.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IslandWeeklyMemberCount {

    /** 주 시작일 — UTC 일요일이다({@code RankingWeek}). DB CHECK 가 요일까지 지킨다. */
    @Id
    @Column(name = "week_start", nullable = false)
    private LocalDate weekStart;

    @Id
    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    /** 주 마감 시점의 활성·미탈퇴 주민 수. 0 인 섬은 아예 적지 않는다(분모 0 을 참가로 바꾸지 않는다). */
    @Column(name = "member_count", nullable = false)
    private int memberCount;

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
