package com.oneorthree.phone.ranking.support;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.TemporalAdjusters;

/**
 * 주간 섬 랭킹의 주차 경계 계산기 (GROMO-1997).
 *
 * <p><b>주 = UTC 일요일 00:00Z 포함 ~ 다음 일요일 00:00Z 제외</b>다. 요일은 기획 정본 2026-09-14
 * 「주간 랭킹은 매주 일요일 00시에 초기화한다」에서 오고, 시간대는 결정 D8(모든 시간 UTC)과 같은 축의 신규
 * 기능 규칙에서 온다(섬 퀘스트 Q-6 · 회관 기록 RC-축 · 집중 적립 D5-적립 이 모두 UTC 를 골랐다).
 *
 * <p><b>ISO {@code YYYY-Www} 표기를 쓰지 않는 이유.</b> ISO 주차는 «월요일 시작»이 정의의 일부다
 * ({@code island-rankings/policy.md} RK-P01 원안이 그 전제였다). 시작 요일만 일요일로 바꾸고 이름을 그대로
 * 두면 {@code 2026-W37} 이 ISO 가 말하는 날짜와 하루 어긋난 «다른 주»를 가리키게 된다 — 앱·서버·로그가 같은
 * 문자열로 서로 다른 7일을 뜻하는 가장 조용한 종류의 버그다. 그래서 주 식별자는 <b>주 시작일 자체</b>
 * ({@code YYYY-MM-DD} 인 UTC 일요일)다. 자기 자신이 경계를 말하므로 해석 규칙이 필요 없고, ISO 의 «53주차가
 * 없는 해» 같은 달력 예외도 생기지 않는다.
 *
 * <p>{@link com.oneorthree.phone.league.support.LeagueWeek} 와 같은 규율이다 — 모든 메서드가 인자로 받은
 * {@code now} 만 보고 계산하므로 부수효과도 내부 시계도 없다. 1.x 리그(KST·월요일)는 살아 있는 정산 축이라
 * 건드리지 않고, 이 신규 축만 여기 둔다.
 */
public final class RankingWeek {

    /** 주 경계의 기준 존 — UTC 고정이다(결정 D8). 서버 기본 존도 유저 존도 타지 않는다. */
    public static final ZoneOffset ZONE = ZoneOffset.UTC;

    private RankingWeek() {
    }

    /**
     * @param now 기준 시각
     * @return 이 시각이 속한 주의 시작일(직전 또는 당일 일요일, UTC 날짜)
     */
    public static LocalDate weekStart(Instant now) {
        return LocalDate.ofInstant(now, ZONE).with(TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY));
    }

    /**
     * @param now 기준 시각
     * @return 직전 주의 시작일. 주 마감 배치가 «방금 끝난» 주를 가리킬 때 쓴다 — 일요일 00:00Z 에 도는
     *     크론에서 {@link #weekStart} 는 이미 «새» 주를 가리킨다
     */
    public static LocalDate previousWeekStart(Instant now) {
        return weekStart(now).minusWeeks(1);
    }

    /** @return 그 날짜가 주 시작일(UTC 일요일)인지 — 아니면 그 주를 가리키는 식별자가 아니다 */
    public static boolean isWeekStart(LocalDate date) {
        return date.getDayOfWeek() == DayOfWeek.SUNDAY;
    }

    /**
     * @param weekStart 주 시작일(일요일)
     * @return 집계 창의 하한(포함)
     */
    public static Instant startInstant(LocalDate weekStart) {
        return weekStart.atStartOfDay(ZONE).toInstant();
    }

    /**
     * @param weekStart 주 시작일(일요일)
     * @return 집계 창의 상한(<b>제외</b>) = 다음 일요일 00:00Z. 이 시각 자신은 다음 주에 속한다
     */
    public static Instant endInstant(LocalDate weekStart) {
        return weekStart.plusWeeks(1).atStartOfDay(ZONE).toInstant();
    }
}
