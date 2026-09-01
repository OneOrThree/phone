package com.oneorthree.phone.stats.support;

import com.oneorthree.phone.stats.dto.StatsPeriod;
import org.springframework.stereotype.Component;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;

/**
 * 기간(period)·기준일(today)로부터 현재 구간과 직전 동일 길이 구간의 경계를 계산한다.
 *
 * <ul>
 *   <li>DAY  : 오늘 / 어제</li>
 *   <li>WEEK : 이번 주 월요일~오늘 / 전주 동일 구간</li>
 *   <li>MONTH: 이번 달 1일~오늘 / 전월 1일~전월 동일 날짜</li>
 * </ul>
 *
 * <p>GROMO-523·522·524·525 공통 재사용 로직을 {@link StatsService} 에서 분리한 무상태 컴포넌트
 * (GROMO-779 리팩토링). 평균 집중 API(ticket 753) 등에서 재사용한다.
 */
@Component
public class StatsPeriodResolver {

    /**
     * 현재 구간·직전 동일 길이 구간 경계를 계산한다.
     *
     * @param period 집계 기간(DAY/WEEK/MONTH)
     * @param today  기준일(서버 판정 축 KST 고정 기준 오늘)
     * @return 현재 구간과 직전 구간 경계 묶음
     */
    public PeriodRange resolve(StatsPeriod period, LocalDate today) {
        LocalDate currentFrom = switch (period) {
            case DAY -> today;
            case WEEK -> today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            case MONTH -> today.withDayOfMonth(1);
        };
        // 직전 동일 길이 구간: currentFrom~today 와 동일한 날수를 직전에 배치
        LocalDate previousFrom = switch (period) {
            case DAY -> today.minusDays(1);
            case WEEK -> currentFrom.minusWeeks(1);
            case MONTH -> today.minusMonths(1).withDayOfMonth(1);
        };
        LocalDate previousTo = switch (period) {
            case DAY -> today.minusDays(1);
            case WEEK -> today.minusWeeks(1);
            // 전월 같은 날(말일 초과 시 Java가 자동으로 전월 말일로 조정)
            case MONTH -> today.minusMonths(1);
        };
        return new PeriodRange(currentFrom, today, previousFrom, previousTo);
    }

    /** 현재 구간(currentFrom~currentTo)과 직전 동일 길이 구간(previousFrom~previousTo) 경계 묶음. */
    public record PeriodRange(LocalDate currentFrom, LocalDate currentTo,
                              LocalDate previousFrom, LocalDate previousTo) {
    }
}
