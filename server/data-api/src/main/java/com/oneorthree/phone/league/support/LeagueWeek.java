package com.oneorthree.phone.league.support;

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

    public Instant previousWeekStart(Instant now) {
        return previousWeekStartDate(now).atStartOfDay(KST).toInstant();
    }

    /**
     * {@code now}가 속한 KST 주차의 <b>다음</b> 주차 시작 (GROMO-1239) — 정산 대상 주차의 가드
     * anchor(startedAt)·가입 컷오프 경계가 이 시각이다. KST 는 DST 가 없지만 +7일 산술 대신
     * 달력 산법으로 계산해 경계 규칙을 한 곳에 못박는다.
     */
    public Instant nextWeekStart(Instant now) {
        return currentWeekStartDate(now).plusWeeks(1).atStartOfDay(KST).toInstant();
    }

    public LocalDate previousWeekStartDate(Instant now) {
        return currentWeekStartDate(now).minusWeeks(1);
    }

    public LocalDate currentDate(Instant now) {
        return now.atZone(KST).toLocalDate();
    }
}
