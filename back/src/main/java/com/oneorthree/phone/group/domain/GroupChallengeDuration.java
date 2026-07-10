package com.oneorthree.phone.group.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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

// type=DURATION 챌린지 전용 상세(CTI). group_challenges 와 1:1 — challenge_id 를 PK 로 공유(@MapsId).
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

    // 누적 달성 목표 시간(분)
    @Column(nullable = false)
    private int durationMinutes;
}
