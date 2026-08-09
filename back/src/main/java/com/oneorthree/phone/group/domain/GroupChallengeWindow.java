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

import java.time.LocalTime;
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

    // 수행 지정 시간대 시작 — KST 벽시계 시각(time-of-day). V32 이전에는 "날짜부는 무의미"라는 규약을
    // 얹은 timestamptz 였고, 그 규약을 타입이 표현하지 못해 UTC 로 읽는 순간 9시간 어긋났다(GROMO-1100).
    @Column(name = "window_start", nullable = false)
    private LocalTime windowStart;

    // 수행 지정 시간대 종료 — 해석 기준은 windowStart 와 동일. 시작 > 종료면 자정 걸침 창(D 시작 ~ D+1 종료).
    @Column(name = "window_end", nullable = false)
    private LocalTime windowEnd;

    // 창 내 목표 시간(분, V20). nullable — 목표 없는 기존 창 챌린지는 종전대로 진행률·판정 대상이 아니다.
    @Column(name = "duration_minutes")
    private Integer durationMinutes;
}
