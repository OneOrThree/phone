package com.oneorthree.phone.stats.dto;

import java.time.LocalDate;

/**
 * 기간별 스크린타임 통계 응답. (형태는 GROMO-523 FocusPeriodStatsResponse와 통일)
 * - day:        goalAchieved 유효, achievedDays/totalDays = null
 * - week/month: achievedDays/totalDays 유효, goalAchieved = null
 */
public record ScreenTimePeriodStatsResponse(
        /** 조회한 기간 종류 (DAY | WEEK | MONTH). */
        StatsPeriod period,
        /** 현재 구간 시작일 (UTC). */
        LocalDate from,
        /** 현재 구간 종료일 (UTC, = 오늘). */
        LocalDate to,
        /** 현재 기간 스크린타임 합계(분). */
        int currentMinutes,
        /** 직전 동일 길이 기간 스크린타임 합계(분). */
        int previousMinutes,
        /** currentMinutes - previousMinutes (음수 = 개선). */
        int deltaMinutes,
        /** 일일 목표(분), 0 = 미설정. */
        int goalMinutes,
        /**
         * day: 달성 여부(목표 미설정 시 false), week/month: null.
         * 사용 기록이 없으면(0분) 목표 설정 시 달성으로 간주(0 ≤ goalMinutes).
         */
        Boolean goalAchieved,
        /** week/month: 달성일수, day: null. */
        Integer achievedDays,
        /** week/month: 집계 기간 총일수, day: null. */
        Integer totalDays
) {
}
