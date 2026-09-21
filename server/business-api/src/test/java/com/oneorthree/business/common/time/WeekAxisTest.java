package com.oneorthree.business.common.time;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.WeekFields;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 화면의 「이번 주」 경계 (GROMO-2048) — UTC 일요일 00:00Z 시작.
 *
 * <p><b>날짜 표는 data-api 의 {@code RankingWeekTest} 와 같은 것을 일부러 쓴다.</b> 두 서비스가 별도 Gradle
 * 루트라 {@code RankingWeek} 을 코드로 참조할 수 없으므로, 「도서관 통계와 주간 섬 랭킹이 같은 시점에 같은
 * 7일을 가리킨다」를 못 박는 자리가 여기다. 한쪽 정의가 바뀌면 같은 입력에 다른 답이 나와 두 표가 갈린다.
 */
class WeekAxisTest {

    @ParameterizedTest
    @CsvSource({
        // 일요일 자정 정각은 «그 주의 첫 순간»이다 — 전 주에 속하지 않는다.
        "2026-09-06T00:00:00Z, 2026-09-06",
        "2026-09-06T23:59:59Z, 2026-09-06",
        "2026-09-07T00:00:00Z, 2026-09-06",
        // 토요일 마지막 순간까지 같은 주.
        "2026-09-12T23:59:59Z, 2026-09-06",
        // 다음 일요일 00:00Z 부터 새 주.
        "2026-09-13T00:00:00Z, 2026-09-13"})
    @DisplayName("주는 UTC 일요일에 시작한다 — RankingWeekTest 와 같은 날짜 표다")
    void weekStartsOnUtcSunday(String now, String expected) {
        assertThat(WeekAxis.weekStart(Instant.parse(now))).isEqualTo(LocalDate.parse(expected));
    }

    @Test
    @DisplayName("도서관이 부르는 창 [시작, 시작+6일] 은 랭킹의 반열림 창 [일요일, 다음 일요일) 과 같은 7일이다")
    void libraryWindowCoversTheSameSevenDaysAsTheRankingWeek() {
        Instant now = Instant.parse("2026-09-09T10:00:00Z");   // 수요일

        LocalDate from = WeekAxis.weekStart(now);
        LocalDate to = from.plusDays(6);

        // 랭킹의 창: [일요일 00:00Z, 다음 일요일 00:00Z) — 마지막으로 «포함되는» 날짜는 그 직전 날(토요일)이다.
        LocalDate rankingLastIncludedDay = from.plusWeeks(1).minusDays(1);
        assertThat(from).isEqualTo(LocalDate.of(2026, 9, 6));
        assertThat(to).isEqualTo(rankingLastIncludedDay).isEqualTo(LocalDate.of(2026, 9, 12));
        assertThat(WeekAxis.weekStart(to.plusDays(1).atStartOfDay(WeekAxis.ZONE).toInstant()))
                .as("다음 날부터는 다음 주다 — 창이 겹치지도 비지도 않는다").isEqualTo(from.plusWeeks(1));
    }

    @Test
    @DisplayName("종전의 with(DayOfWeek.MONDAY) 는 일요일에 «엿새 전에 시작한 주»를 답했다 — 그 하루가 어긋남이었다")
    void isoMondayWeekNamedADifferentSevenDays() {
        Instant sunday = Instant.parse("2026-09-06T12:00:00Z");
        LocalDate date = LocalDate.ofInstant(sunday, WeekAxis.ZONE);

        LocalDate isoWeekStart = date.with(WeekFields.ISO.dayOfWeek(), 1);

        assertThat(WeekAxis.weekStart(sunday)).isEqualTo(date);
        assertThat(isoWeekStart).isEqualTo(date.minusDays(6));
    }
}
