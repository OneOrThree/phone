package com.oneorthree.phone.group.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapsId;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

/**
 * type=DURATION 챌린지 전용 상세(CTI). group_challenges 와 1:1 — challenge_id 를 PK 로 공유(@MapsId).
 */
@Entity
@Table(name = "group_challenge_durations")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class GroupChallengeDuration {

    @Id
    @Column(name = "challenge_id")
    private UUID challengeId;

    @MapsId
    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "challenge_id", nullable = false)
    private GroupChallenge challenge;

    /**
     * 부모 카테고리의 비정규화 복사(V36 · GROMO-1405) — 카테고리별 목표 상한 CHECK
     * (FOCUS ≤ 1080 · SCREEN_TIME ≤ 720, N51)를 <b>DB 가</b> 걸기 위한 컬럼이다.
     * 복합 FK (challenge_id, category) → group_challenges (id, category) 가 부모와의 일치를 보증하므로
     * 서비스는 생성 시 부모와 같은 값을 넣기만 하면 된다(불변 — 챌린지는 수정이 없다 §A7).
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private MissionCategory category;

    /**
     * 하루 목표 시간(분) — 상한은 카테고리별(N51): FOCUS 1~1080 · SCREEN_TIME 1~720.
     */
    @Column(nullable = false)
    private int durationMinutes;
}
