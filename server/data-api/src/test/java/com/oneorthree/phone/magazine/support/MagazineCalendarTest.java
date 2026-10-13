package com.oneorthree.phone.magazine.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

/** 잡지 신청 창의 KST 경계 (GROMO-2289, 잡지 구현 계획 §9-1 「MagazineCalendar」). */
class MagazineCalendarTest {

    /** KST 10/14 06:59:59. */
    private static final Instant BEFORE_SEVEN = Instant.parse("2026-10-13T21:59:59Z");
    /** KST 10/14 07:00:00. */
    private static final Instant SEVEN = Instant.parse("2026-10-13T22:00:00Z");
    /** KST 10/14 23:59:59. */
    private static final Instant LAST_SECOND = Instant.parse("2026-10-14T14:59:59Z");
    /** KST 10/15 00:00:00. */
    private static final Instant MIDNIGHT = Instant.parse("2026-10-14T15:00:00Z");

    @Test
    @DisplayName("창은 KST 07:00:00 에 열리고 00:00:00 에 닫힌다 — 06:59:59 닫힘 · 07:00 열림 · 23:59:59 열림 · 00:00 닫힘")
    void windowBoundaries() {
        assertThat(MagazineCalendar.isWindowOpen(BEFORE_SEVEN)).isFalse();
        assertThat(MagazineCalendar.isWindowOpen(SEVEN)).isTrue();
        assertThat(MagazineCalendar.isWindowOpen(LAST_SECOND)).isTrue();
        assertThat(MagazineCalendar.isWindowOpen(MIDNIGHT)).isFalse();
    }

    @Test
    @DisplayName("창이 향하는 호는 KST 오늘 + 1 이다 — 열려 있을 때도, 닫혀서 다음 창을 기다릴 때도")
    void windowIssueDateIsTomorrowInKst() {
        assertThat(MagazineCalendar.windowIssueDate(SEVEN)).isEqualTo(LocalDate.parse("2026-10-15"));
        assertThat(MagazineCalendar.windowIssueDate(LAST_SECOND)).isEqualTo(LocalDate.parse("2026-10-15"));
        assertThat(MagazineCalendar.windowIssueDate(MIDNIGHT))
                .as("자정이 지나면 10/15 호 창은 닫히고, 다음에 열릴 창은 10/16 호다").isEqualTo(LocalDate.parse("2026-10-16"));
        assertThat(MagazineCalendar.windowIssueDate(BEFORE_SEVEN)).isEqualTo(LocalDate.parse("2026-10-15"));
    }

    @Test
    @DisplayName("아직 발행되지 않은 가장 가까운 호 — 07시 전에는 오늘 호, 07시부터는 내일 호")
    void upcomingIssueDate() {
        assertThat(MagazineCalendar.upcomingIssueDate(BEFORE_SEVEN)).isEqualTo(LocalDate.parse("2026-10-14"));
        assertThat(MagazineCalendar.upcomingIssueDate(SEVEN)).isEqualTo(LocalDate.parse("2026-10-15"));
        assertThat(MagazineCalendar.upcomingIssueDate(MIDNIGHT)).isEqualTo(LocalDate.parse("2026-10-15"));
    }

    @Test
    @DisplayName("호의 창은 전날 07:00 KST(= 전전날 22:00 UTC)부터 그날 00:00 KST(= 전날 15:00 UTC)까지다")
    void windowInstants() {
        LocalDate issue = LocalDate.parse("2026-10-15");

        assertThat(MagazineCalendar.opensAt(issue)).isEqualTo(SEVEN);
        assertThat(MagazineCalendar.closesAt(issue)).isEqualTo(MIDNIGHT);
    }
}
