package com.oneorthree.phone.group.domain;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 요일 반복 스케줄(§A3 · LLD §3.4) 비트마스크 단위 테스트 — 활성일 판정·다음/이전 활성일이
 * 개설(레거시 브리지 포함)·참여·카드 다음 회차 축의 공용 규칙이라 여기서 한 번에 고정한다.
 */
class RepeatScheduleTest {

    /** 2026-08-10 = 월요일 — 요일 계산의 기준 날짜. */
    private static final LocalDate MONDAY = LocalDate.of(2026, 8, 10);

    @Test
    @DisplayName("마스크 접기 — 월=1 … 일=64, 평일=31, 매일=127")
    void maskOfFoldsIsoDays() {
        assertThat(RepeatSchedule.bit(DayOfWeek.MONDAY)).isEqualTo(1);
        assertThat(RepeatSchedule.bit(DayOfWeek.SUNDAY)).isEqualTo(64);
        assertThat(RepeatSchedule.maskOf(List.of(DayOfWeek.MONDAY, DayOfWeek.TUESDAY,
                DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY))).isEqualTo(31);
        assertThat(RepeatSchedule.maskOf(List.of())).isZero();
        assertThat(RepeatSchedule.EVERYDAY).isEqualTo(127);
    }

    @Test
    @DisplayName("활성일 판정 — 마스크에 든 요일만 true")
    void activeOnChecksDayBit() {
        int monWedFri = RepeatSchedule.maskOf(
                Set.of(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY));
        assertThat(RepeatSchedule.activeOn(monWedFri, MONDAY)).isTrue();
        assertThat(RepeatSchedule.activeOn(monWedFri, MONDAY.plusDays(1))).isFalse(); // 화
        assertThat(RepeatSchedule.activeOn(monWedFri, MONDAY.plusDays(2))).isTrue();  // 수
    }

    @Test
    @DisplayName("다음 활성일 — 오늘은 제외하고, 매일 마스크면 항상 내일")
    void nextExcludesToday() {
        int mondayOnly = RepeatSchedule.bit(DayOfWeek.MONDAY);
        assertThat(RepeatSchedule.next(mondayOnly, MONDAY)).isEqualTo(MONDAY.plusDays(7));
        assertThat(RepeatSchedule.next(RepeatSchedule.EVERYDAY, MONDAY)).isEqualTo(MONDAY.plusDays(1));
    }

    @Test
    @DisplayName("이전 활성일 — next 와 대칭(결과 모달의 직전 회차일)")
    void previousIsSymmetricToNext() {
        int mondayOnly = RepeatSchedule.bit(DayOfWeek.MONDAY);
        assertThat(RepeatSchedule.previous(mondayOnly, MONDAY)).isEqualTo(MONDAY.minusDays(7));
    }

    @Test
    @DisplayName("이번 주 남은 활성일 — 오늘 포함, 일요일까지 오름차순")
    void remainingThisWeekIncludesTodayThroughSunday() {
        int monWedFri = RepeatSchedule.maskOf(
                Set.of(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY));
        assertThat(RepeatSchedule.remainingThisWeek(monWedFri, MONDAY.plusDays(2))) // 수요일부터
                .containsExactly(MONDAY.plusDays(2), MONDAY.plusDays(4));
    }

    @Test
    @DisplayName("범위 밖 마스크(0·128)는 활성일 계산을 거부한다 — DB CHECK(1~127)와 같은 경계")
    void rejectsMaskOutOfRange() {
        assertThat(RepeatSchedule.isValidMask(0)).isFalse();
        assertThat(RepeatSchedule.isValidMask(128)).isFalse();
        assertThatThrownBy(() -> RepeatSchedule.next(0, MONDAY))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
