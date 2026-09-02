package com.oneorthree.phone.league.support;

import org.springframework.stereotype.Component;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;

/**
 * 리그에서 공통으로 사용하는 KST 주차 경계 계산기.
 *
 * <p>기준 존은 <b>KST 고정</b>이다 — 유저 타임존이나 서버 기본 존을 타지 않는다
 * ({@link com.oneorthree.phone.common.util.ZonePolicy} 와 같은 축). 주차는 <b>월요일 00:00 KST 에
 * 시작</b>하고, 정산·랭킹·마감 카운트다운이 전부 여기서 나온 값을 쓴다.
 *
 * <p>모든 메서드가 인자로 받은 {@code now} 만 보고 계산하므로 부수효과도 내부 시계도 없다 — 한 요청·한
 * 배치 안에서 같은 {@code now} 를 넘기면 경계가 갈리지 않는다.
 */
@Component
public class LeagueWeek {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /**
     * @param now 기준 시각
     * @return 이 시각이 속한 주차의 시작(직전 또는 당일 월요일의 KST 자정)
     */
    public Instant currentWeekStart(Instant now) {
        return currentWeekStartDate(now).atStartOfDay(KST).toInstant();
    }

    /**
     * @param now 기준 시각
     * @return 같은 주차 시작을 날짜로 — 집계 쿼리의 기간 하한(포함)에 그대로 넣는 값이다
     */
    public LocalDate currentWeekStartDate(Instant now) {
        return currentDate(now).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    }

    /**
     * @param now 기준 시각
     * @return 직전 주차의 시작. 주간 배치가 정산하는 대상 주차의 키가 이 값이다
     */
    public Instant previousWeekStart(Instant now) {
        return previousWeekStartDate(now).atStartOfDay(KST).toInstant();
    }

    /**
     * {@code now}가 속한 KST 주차의 <b>다음</b> 주차 시작 (GROMO-1239) — 정산 대상 주차의 가드
     * anchor(startedAt)·가입 컷오프 경계가 이 시각이다. KST 는 DST 가 없지만 +7일 산술 대신
     * 달력 산법으로 계산해 경계 규칙을 한 곳에 못박는다.
     *
     * @param now 기준 시각
     * @return 다음 주차 시작 = 이번 주차의 <b>종료 경계</b>. 이 시각 자신은 다음 주차에 속하므로,
     *         가입 컷오프·아레나 마감 조회는 이 값을 배타 경계로 쓴다
     */
    public Instant nextWeekStart(Instant now) {
        return currentWeekStartDate(now).plusWeeks(1).atStartOfDay(KST).toInstant();
    }

    /**
     * @param now 기준 시각
     * @return 직전 주차 시작을 날짜로
     */
    public LocalDate previousWeekStartDate(Instant now) {
        return currentWeekStartDate(now).minusWeeks(1);
    }

    /**
     * @param now 기준 시각
     * @return KST 기준 오늘. 기기 로컬 날짜도 서버 기본 존의 날짜도 아니며, 집계 쿼리의 기간 상한(포함)으로 쓴다
     */
    public LocalDate currentDate(Instant now) {
        return now.atZone(KST).toLocalDate();
    }
}
