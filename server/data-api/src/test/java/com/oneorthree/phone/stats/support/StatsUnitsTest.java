package com.oneorthree.phone.stats.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class StatsUnitsTest {

    // ── secondsToMinutes (내림 /60) ───────────────────────────────────────

    @Test
    @DisplayName("초→분 — 정확히 나누어떨어지는 경우")
    void secondsToMinutesExact() {
        assertThat(StatsUnits.secondsToMinutes(0)).isZero();
        assertThat(StatsUnits.secondsToMinutes(60)).isEqualTo(1);
        assertThat(StatsUnits.secondsToMinutes(7200)).isEqualTo(120);
    }

    @Test
    @DisplayName("초→분 — 1분 미만 자투리는 버림(floor)")
    void secondsToMinutesFloor() {
        assertThat(StatsUnits.secondsToMinutes(59)).isZero();          // 1분 미만 → 0
        assertThat(StatsUnits.secondsToMinutes(90)).isEqualTo(1);      // 1분 30초 → 1
        assertThat(StatsUnits.secondsToMinutes(119)).isEqualTo(1);     // 1분 59초 → 1
    }

    // ── progressPercent (round, 클램프 없음) ──────────────────────────────

    @Test
    @DisplayName("진행도 — 목표 미설정(0)이면 0%")
    void progressPercentNoGoal() {
        assertThat(StatsUnits.progressPercent(50, 0)).isZero();
        assertThat(StatsUnits.progressPercent(0, 0)).isZero();
    }

    @Test
    @DisplayName("진행도 — 반올림(round) 적용")
    void progressPercentRounds() {
        assertThat(StatsUnits.progressPercent(45, 60)).isEqualTo(75);   // 75.0
        assertThat(StatsUnits.progressPercent(80, 120)).isEqualTo(67);  // 66.66… → 67
        assertThat(StatsUnits.progressPercent(1, 3)).isEqualTo(33);     // 33.33… → 33
    }

    @Test
    @DisplayName("진행도 — 목표 초과 시 100 초과 그대로(클램프 없음)")
    void progressPercentNoClamp() {
        assertThat(StatsUnits.progressPercent(150, 120)).isEqualTo(125);
        assertThat(StatsUnits.progressPercent(240, 60)).isEqualTo(400);
    }
}
