package com.oneorthree.phone.quest.repository.domain;

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
import java.util.UUID;

/**
 * 회차 시작 cohort 한 행 (GROMO-1773, 결정 Q-3) — 읽기·쓰기는 {@code IslandQuestOccurrenceRepository} 의
 * 네이티브 쿼리가 한다. 이 매핑은 스키마 선언용이다 — 계정 탈퇴 파기(GROMO-1950)가 모든 탈퇴 경로에서
 * 이 테이블을 지우므로, Flyway 없이 엔티티로 스키마를 만드는 CI 프로필에도 테이블이 있어야 한다.
 */
@Entity
@Table(name = "island_quest_cohort_members")
@IdClass(IslandQuestCohortMember.Key.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IslandQuestCohortMember {

    @Id
    @Column(name = "occurrence_id", nullable = false)
    private UUID occurrenceId;

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /** 복합 PK — (occurrenceId, userId). */
    @Getter
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode
    public static class Key implements Serializable {

        private UUID occurrenceId;
        private UUID userId;
    }
}
