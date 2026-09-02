package com.oneorthree.phone.user.repository.domain;

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
import lombok.Setter;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * 연속 집중 일수(스트릭). PK 가 곧 유저 id 인 1:1 행이다.
 *
 * <p>끊긴 스트릭은 <b>즉시 0이 되지 않는다</b> — 다음 집중 세션이 들어올 때 lazy 하게 리셋된다.
 * 그래서 일수만 보면 이미 끝난 스트릭이 살아 있는 것처럼 보이고, 살아 있는지 판정하려면 마지막
 * 세션 날짜를 함께 봐야 한다.
 */
@Entity
@Table(name = "user_streaks")
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class UserStreak {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @MapsId
    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Builder.Default
    @Column(nullable = false)
    private int streakCount = 0;

    @Builder.Default
    @Column(name = "longest_streak_count", nullable = false)
    private int longestStreakCount = 0;

    private LocalDate lastSessionDate;

    @UpdateTimestamp
    private Instant updatedAt;

    /**
     * 소프트 딜리트 컬럼(탈퇴 시각) — 스키마 정합용(GROMO-561). 현재 withdraw()는 하드 삭제.
     * 세팅/필터 배선은 후속 티켓.
     */
    private Instant deletedAt;

    /**
     * 조회 시점("오늘")을 기준으로 현재 유효한 연속일을 계산한다 (GROMO-847).
     *
     * <p>read-time lazy 만료: 마지막 집중일이 어제 이전(공백)이면 스트릭이 끊긴 것으로 보아 0 을 반환한다.
     * 저장값({@link #streakCount})은 히스토리로 보존하고 조회 시에만 만료를 반영한다 — 쓰기 경로가
     * 다음 세션 저장 때만 리셋하므로, 조회만 하는 유저에게도 공백이 즉시 반영되도록 판정을 도메인에 둔다.
     * lastSessionDate 가 오늘·어제면 유지, 미래(시계 오차 등)면 저장값을 그대로 신뢰한다.
     *
     * @param today 서버 판정 축(KST 고정, GROMO-1259) 기준 오늘
     * @return 만료 반영된 현재 연속일 (끊겼으면 0)
     */
    public int currentStreakAsOf(LocalDate today) {
        boolean broken = lastSessionDate == null || lastSessionDate.isBefore(today.minusDays(1));
        return broken ? 0 : streakCount;
    }
}
