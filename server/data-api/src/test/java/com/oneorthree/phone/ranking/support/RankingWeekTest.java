package com.oneorthree.phone.ranking.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.WeekFields;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 주간 섬 랭킹의 주 경계 (GROMO-1997) — UTC 일요일 00:00Z 시작.
 *
 * <p>ISO 주차를 쓰지 않기로 한 결정을 여기서 못박는다: 같은 날짜의 ISO 주차 시작은 <b>월요일</b>이라
 * 이 경계와 다르다. 언젠가 누가 {@code YYYY-Www} 로 되돌리려 하면 이 테스트가 막는다.
 */
class RankingWeekTest {

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
    @DisplayName("주는 UTC 일요일 00:00Z 에 시작하고 다음 일요일 00:00Z 에 끝난다")
    void weekStartsOnUtcSunday(String now, String expected) {
        assertThat(RankingWeek.weekStart(Instant.parse(now))).isEqualTo(LocalDate.parse(expected));
    }

    @Test
    @DisplayName("창은 [일요일 00:00Z, 다음 일요일 00:00Z) 반열림 — 끝 경계는 다음 주 것이다")
    void windowIsHalfOpen() {
        LocalDate week = LocalDate.of(2026, 9, 6);

        assertThat(RankingWeek.startInstant(week)).isEqualTo(Instant.parse("2026-09-06T00:00:00Z"));
        assertThat(RankingWeek.endInstant(week)).isEqualTo(Instant.parse("2026-09-13T00:00:00Z"));
        assertThat(RankingWeek.weekStart(RankingWeek.endInstant(week))).isNotEqualTo(week);
    }

    @Test
    @DisplayName("주 마감 배치가 일요일 00:00Z 에 돌면 대상은 «방금 끝난» 주다")
    void previousWeekIsTheOneThatJustEnded() {
        assertThat(RankingWeek.previousWeekStart(Instant.parse("2026-09-13T00:00:00Z")))
                .isEqualTo(LocalDate.of(2026, 9, 6));
    }

    @Test
    @DisplayName("주 시작일은 일요일뿐 — 월요일 날짜는 주를 가리키는 식별자가 아니다")
    void onlySundayIdentifiesAWeek() {
        assertThat(RankingWeek.isWeekStart(LocalDate.of(2026, 9, 6))).isTrue();
        assertThat(RankingWeek.isWeekStart(LocalDate.of(2026, 9, 7))).isFalse();
    }

    @Test
    @DisplayName("ISO 주차 표기를 그대로 쓸 수 없는 이유 — ISO 주는 월요일에 시작해 이 경계와 하루 어긋난다")
    void isoWeekWouldNameADifferentSevenDays() {
        Instant sunday = Instant.parse("2026-09-06T12:00:00Z");
        LocalDate date = LocalDate.ofInstant(sunday, RankingWeek.ZONE);

        LocalDate isoWeekStart = date.with(WeekFields.ISO.dayOfWeek(), 1);

        assertThat(RankingWeek.weekStart(sunday)).isEqualTo(date);
        // 같은 순간인데 ISO 는 «엿새 전에 시작한 주»에 속한다고 답한다 — 이 일요일은 ISO 에서 한 주의
        // «마지막» 날이고 우리 축에서는 «첫» 날이다. 이름을 재사용하면 이 차이가 조용히 숨는다.
        assertThat(isoWeekStart).isEqualTo(date.minusDays(6));
    }
}
