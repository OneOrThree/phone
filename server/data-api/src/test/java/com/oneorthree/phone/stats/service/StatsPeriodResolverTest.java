package com.oneorthree.phone.stats.service;

import com.oneorthree.phone.stats.dto.StatsPeriod;
import com.oneorthree.phone.stats.service.StatsPeriodResolver.PeriodRange;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

class StatsPeriodResolverTest {

    private final StatsPeriodResolver resolver = new StatsPeriodResolver();

    // 고정 기준일: 2026-07-03 (금요일, 이번 주 월요일 = 2026-06-29)
    private static final LocalDate FIXED_TODAY = LocalDate.of(2026, 7, 3);

    // ── DAY ───────────────────────────────────────────────────────────────

    @Test
    @DisplayName("DAY — current=오늘/오늘, previous=어제/어제")
    void resolveDay() {
        PeriodRange range = resolver.resolve(StatsPeriod.DAY, FIXED_TODAY);

        assertThat(range.currentFrom()).isEqualTo(FIXED_TODAY);
        assertThat(range.currentTo()).isEqualTo(FIXED_TODAY);
        assertThat(range.previousFrom()).isEqualTo(FIXED_TODAY.minusDays(1));
        assertThat(range.previousTo()).isEqualTo(FIXED_TODAY.minusDays(1));
    }

    // ── WEEK ──────────────────────────────────────────────────────────────

    @Test
    @DisplayName("WEEK — current=이번 주 월요일~오늘, previous=전주 월요일~전주 동일 요일")
    void resolveWeek() {
        PeriodRange range = resolver.resolve(StatsPeriod.WEEK, FIXED_TODAY);

        // 2026-07-03(금) → 이번 주 월요일=2026-06-29, 전주 구간=2026-06-22~2026-06-26
        assertThat(range.currentFrom()).isEqualTo(LocalDate.of(2026, 6, 29));
        assertThat(range.currentTo()).isEqualTo(FIXED_TODAY);
        assertThat(range.previousFrom()).isEqualTo(LocalDate.of(2026, 6, 22));
        assertThat(range.previousTo()).isEqualTo(LocalDate.of(2026, 6, 26));
    }

    @Test
    @DisplayName("WEEK — 기준일이 월요일이면 current=오늘 단일일, previous=지난주 월요일 단일일")
    void resolveWeekOnMonday() {
        LocalDate monday = LocalDate.of(2026, 6, 29);
        PeriodRange range = resolver.resolve(StatsPeriod.WEEK, monday);

        assertThat(range.currentFrom()).isEqualTo(monday);
        assertThat(range.currentTo()).isEqualTo(monday);
        assertThat(range.previousFrom()).isEqualTo(LocalDate.of(2026, 6, 22));
        assertThat(range.previousTo()).isEqualTo(LocalDate.of(2026, 6, 22));
    }

    // ── MONTH ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("MONTH — current=이번 달 1일~오늘, previous=전월 1일~전월 같은 날짜")
    void resolveMonth() {
        PeriodRange range = resolver.resolve(StatsPeriod.MONTH, FIXED_TODAY);

        assertThat(range.currentFrom()).isEqualTo(LocalDate.of(2026, 7, 1));
        assertThat(range.currentTo()).isEqualTo(FIXED_TODAY);
        assertThat(range.previousFrom()).isEqualTo(LocalDate.of(2026, 6, 1));
        assertThat(range.previousTo()).isEqualTo(LocalDate.of(2026, 6, 3));
    }

    @Test
    @DisplayName("MONTH — 전월 말일 처리: 3월 31일 → previousTo=2월 28일(평년 자동 조정)")
    void resolveMonthEndOfMonthClamp() {
        LocalDate march31 = LocalDate.of(2026, 3, 31);
        PeriodRange range = resolver.resolve(StatsPeriod.MONTH, march31);

        assertThat(range.currentFrom()).isEqualTo(LocalDate.of(2026, 3, 1));
        assertThat(range.currentTo()).isEqualTo(march31);
        assertThat(range.previousFrom()).isEqualTo(LocalDate.of(2026, 2, 1));
        assertThat(range.previousTo()).isEqualTo(LocalDate.of(2026, 2, 28)); // 2026은 평년
    }
}
