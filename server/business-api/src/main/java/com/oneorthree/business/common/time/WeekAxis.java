package com.oneorthree.business.common.time;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.TemporalAdjusters;

/**
 * 「이번 주」의 경계 (GROMO-2048) — <b>UTC 일요일 00:00Z 포함 ~ 다음 일요일 00:00Z 제외</b>다.
 *
 * <p>정의는 2026-09-21 결정 RK-주에서 온다: 요일은 기획 정본 「주간 랭킹은 매주 일요일 00시에 초기화한다」,
 * 시간대는 결정 D8(모든 시간 UTC)과 같은 축의 신규 기능 규칙이다. <b>이 화면들의 주는 주간 섬 랭킹의 주와
 * 같은 7일이어야 한다</b> — 도서관(회관 기록)과 전망대(랭킹)가 서로 다른 7일을 「이번 주」라고 부르면
 * 사용자가 두 화면의 숫자를 대조했을 때 어긋난다.
 *
 * <p><b>왜 여기에 또 있는가.</b> 정의의 정본은 data-api 의 {@code com.oneorthree.phone.ranking.support.RankingWeek}
 * 이지만 business-api 는 별도 Gradle 루트라 그 클래스를 코드로 참조할 수 없다. 그래서 business-api 안에서는
 * 이 한 곳만 주 경계를 계산하고(화면·유스케이스가 각자 계산하지 않는다), {@code WeekAxisTest} 가
 * {@code RankingWeekTest} 와 <b>같은 날짜 표</b>로 두 정의가 같은 7일을 가리키는지 못 박는다.
 *
 * <p>ISO {@code YYYY-Www}·{@code with(DayOfWeek.MONDAY)} 를 쓰지 않는 이유도 같다 — ISO 주는 «월요일 시작»이
 * 정의의 일부라 일요일에는 <b>엿새 전에 시작한 주</b>를 답한다(policy RK-P01-키).
 */
public final class WeekAxis {

    /** 주 경계의 기준 존 — UTC 고정이다(결정 D8). 서버 기본 존도 유저 존도 타지 않는다. */
    public static final ZoneOffset ZONE = ZoneOffset.UTC;

    private WeekAxis() {
    }

    /**
     * @param now 기준 시각
     * @return 이 시각이 속한 주의 시작일(직전 또는 당일 일요일, UTC 날짜). 주의 마지막 날은 {@code +6일}이다
     */
    public static LocalDate weekStart(Instant now) {
        return LocalDate.ofInstant(now, ZONE).with(TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY));
    }
}
