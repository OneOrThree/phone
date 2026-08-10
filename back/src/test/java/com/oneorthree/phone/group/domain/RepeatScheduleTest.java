package com.oneorthree.phone.group.domain;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.DayOfWeek;
import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 요일 스케줄 유틸 검증(§A3 · LLD §3.4) — 활성일 판정·다음/직전 활성일·주간 잔여 활성일.
 * 이후 회차 개설(B4)·참여(B5)가 이 유틸을 그대로 쓴다.
 */
class RepeatScheduleTest {

    // 2026-08-10 은 월요일이다.
    private static final LocalDate MONDAY = LocalDate.of(2026, 8, 10);
    private static final int MON_WED_FRI = 0b0010101;   // 월=1 · 수=4 · 금=16

    @Test
    @DisplayName("bit — ISO 요일 번호를 1<<(dow-1) 로 접는다: 월=1 … 일=64")
    void mapsIsoDayNumbersToBits() {
        assertThat(RepeatSchedule.bit(DayOfWeek.MONDAY)).isEqualTo(1);
        assertThat(RepeatSchedule.bit(DayOfWeek.SUNDAY)).isEqualTo(64);
        assertThat(RepeatSchedule.maskOf(java.util.List.of(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY,
                DayOfWeek.FRIDAY))).isEqualTo(MON_WED_FRI);
    }

    @Test
    @DisplayName("activeOn — 월수금 마스크에서 월·수는 도는 날, 화는 아니다")
    void judgesActiveDay() {
        assertThat(RepeatSchedule.activeOn(MON_WED_FRI, MONDAY)).isTrue();
        assertThat(RepeatSchedule.activeOn(MON_WED_FRI, MONDAY.plusDays(1))).isFalse();   // 화
        assertThat(RepeatSchedule.activeOn(MON_WED_FRI, MONDAY.plusDays(2))).isTrue();    // 수
        assertThat(RepeatSchedule.activeOn(RepeatSchedule.EVERYDAY, MONDAY.plusDays(5))).isTrue();
    }

    @Test
    @DisplayName("next/previous — 오늘을 제외한 다음·직전 활성일 (월수금에서 월요일 기준: 다음=수, 직전=금)")
    void findsNextAndPreviousActiveDates() {
        assertThat(RepeatSchedule.next(MON_WED_FRI, MONDAY)).isEqualTo(MONDAY.plusDays(2));      // 수
        assertThat(RepeatSchedule.previous(MON_WED_FRI, MONDAY)).isEqualTo(MONDAY.minusDays(3)); // 지난 금
        // 단일 요일 마스크 — 정확히 일주일 뒤·전.
        int onlyMonday = RepeatSchedule.bit(DayOfWeek.MONDAY);
        assertThat(RepeatSchedule.next(onlyMonday, MONDAY)).isEqualTo(MONDAY.plusDays(7));
        assertThat(RepeatSchedule.previous(onlyMonday, MONDAY)).isEqualTo(MONDAY.minusDays(7));
    }

    @Test
    @DisplayName("remainingThisWeek — 오늘 포함 그 주(월~일)의 남은 활성일 (수요일 기준 월수금 → 수·금)")
    void listsRemainingActiveDatesOfWeek() {
        LocalDate wednesday = MONDAY.plusDays(2);
        assertThat(RepeatSchedule.remainingThisWeek(MON_WED_FRI, wednesday))
                .containsExactly(wednesday, MONDAY.plusDays(4));
        // 일요일 기준 — 일이 비활성이면 빈 목록.
        assertThat(RepeatSchedule.remainingThisWeek(MON_WED_FRI, MONDAY.plusDays(6))).isEmpty();
        // 매일 마스크 — 월요일 기준 7일 전부.
        assertThat(RepeatSchedule.remainingThisWeek(RepeatSchedule.EVERYDAY, MONDAY)).hasSize(7);
    }

    @Test
    @DisplayName("유효 범위 밖 마스크(0·128)는 순회 유틸에서 즉시 거부된다 — DB CHECK 와 같은 경계")
    void rejectsOutOfRangeMasks() {
        assertThat(RepeatSchedule.isValidMask(0)).isFalse();
        assertThat(RepeatSchedule.isValidMask(128)).isFalse();
        assertThat(RepeatSchedule.isValidMask(1)).isTrue();
        assertThat(RepeatSchedule.isValidMask(127)).isTrue();
        assertThatThrownBy(() -> RepeatSchedule.next(0, MONDAY))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> RepeatSchedule.remainingThisWeek(128, MONDAY))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
