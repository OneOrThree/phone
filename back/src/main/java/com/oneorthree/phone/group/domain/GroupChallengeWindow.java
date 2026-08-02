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

import java.time.Instant;
import java.util.UUID;

// type=TIME_WINDOW 챌린지 전용 상세(CTI). group_challenges 와 1:1 — challenge_id 를 PK 로 공유(@MapsId).
@Entity
@Table(name = "group_challenge_windows")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class GroupChallengeWindow {

    @Id
    @Column(name = "challenge_id")
    private UUID challengeId;

    @MapsId
    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "challenge_id", nullable = false)
    private GroupChallenge challenge;

    // 수행 지정 시간대 시작 (UTC)
    @Column(name = "window_start_at", nullable = false)
    private Instant windowStartAt;

    // 수행 지정 시간대 종료 (UTC)
    @Column(name = "window_end_at", nullable = false)
    private Instant windowEndAt;

    // 창 내 목표 시간(분, V20). nullable — 목표 없는 기존 창 챌린지는 종전대로 진행률·판정 대상이 아니다.
    @Column(name = "duration_minutes")
    private Integer durationMinutes;
}
