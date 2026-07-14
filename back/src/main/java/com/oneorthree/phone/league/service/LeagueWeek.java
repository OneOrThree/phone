package com.oneorthree.phone.league.service;

import org.springframework.stereotype.Component;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;

/** 리그에서 공통으로 사용하는 KST 주차 경계 계산기. */
@Component
public class LeagueWeek {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    public Instant currentWeekStart(Instant now) {
        return currentWeekStartDate(now).atStartOfDay(KST).toInstant();
    }

    public LocalDate currentWeekStartDate(Instant now) {
        return currentDate(now).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    }

    public LocalDate currentDate(Instant now) {
        return now.atZone(KST).toLocalDate();
    }
}
