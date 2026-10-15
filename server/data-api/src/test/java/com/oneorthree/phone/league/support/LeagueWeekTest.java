package com.oneorthree.phone.league.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

class LeagueWeekTest {

    private final LeagueWeek leagueWeek = new LeagueWeek();

    @Test
    @DisplayName("KST 월요일 00:00 직전은 이전 주, 정각부터 새 주로 계산한다")
    void mondayBoundaryUsesKst() {
        Instant justBefore = Instant.parse("2026-07-12T14:59:59Z");
        Instant mondayMidnight = Instant.parse("2026-07-12T15:00:00Z");

        assertThat(leagueWeek.currentDate(justBefore)).isEqualTo(LocalDate.of(2026, 7, 12));
        assertThat(leagueWeek.currentWeekStartDate(justBefore)).isEqualTo(LocalDate.of(2026, 7, 6));
        assertThat(leagueWeek.currentDate(mondayMidnight)).isEqualTo(LocalDate.of(2026, 7, 13));
        assertThat(leagueWeek.currentWeekStartDate(mondayMidnight)).isEqualTo(LocalDate.of(2026, 7, 13));
        assertThat(leagueWeek.currentWeekStart(mondayMidnight)).isEqualTo(mondayMidnight);
        assertThat(leagueWeek.previousWeekStartDate(mondayMidnight)).isEqualTo(LocalDate.of(2026, 7, 6));
        assertThat(leagueWeek.previousWeekStart(mondayMidnight))
                .isEqualTo(Instant.parse("2026-07-05T15:00:00Z"));
    }
}
