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
 * 요일 반복 스케줄(§A3 · LLD §3.4) 비트마스크 단위 테스트 — 활성일 판정·다음/직전 활성일·주간 잔여
 * 활성일이 개설(레거시 브리지 포함)·참여·카드 다음 회차 축의 공용 규칙이라 여기서 한 번에 고정한다.
 */
class RepeatScheduleTest {

    /** 2026-08-10 = 월요일 — 요일 계산의 기준 날짜. */
    private static final LocalDate MONDAY = LocalDate.of(2026, 8, 10);

    /** 월=1 · 수=4 · 금=16. */
    private static final int MON_WED_FRI = 0b0010101;

    @Test
    @DisplayName("마스크 접기 — 월=1 … 일=64, 월수금=21, 평일=31, 매일=127")
    void maskOfFoldsIsoDays() {
        assertThat(RepeatSchedule.bit(DayOfWeek.MONDAY)).isEqualTo(1);
        assertThat(RepeatSchedule.bit(DayOfWeek.SUNDAY)).isEqualTo(64);
        assertThat(RepeatSchedule.maskOf(List.of(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY,
                DayOfWeek.FRIDAY))).isEqualTo(MON_WED_FRI);
        assertThat(RepeatSchedule.maskOf(List.of(DayOfWeek.MONDAY, DayOfWeek.TUESDAY,
                DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY))).isEqualTo(31);
        assertThat(RepeatSchedule.maskOf(List.of())).isZero();
        assertThat(RepeatSchedule.EVERYDAY).isEqualTo(127);
    }

    @Test
    @DisplayName("활성일 판정 — 마스크에 든 요일만 true, 매일 마스크는 항상 true")
    void activeOnChecksDayBit() {
        int monWedFri = RepeatSchedule.maskOf(
                Set.of(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY));
        assertThat(monWedFri).isEqualTo(MON_WED_FRI);
        assertThat(RepeatSchedule.activeOn(monWedFri, MONDAY)).isTrue();
        assertThat(RepeatSchedule.activeOn(monWedFri, MONDAY.plusDays(1))).isFalse(); // 화
        assertThat(RepeatSchedule.activeOn(monWedFri, MONDAY.plusDays(2))).isTrue();  // 수
        assertThat(RepeatSchedule.activeOn(RepeatSchedule.EVERYDAY, MONDAY.plusDays(5))).isTrue();
    }

    @Test
    @DisplayName("다음 활성일 — 오늘은 제외하고, 매일 마스크면 항상 내일")
    void nextExcludesToday() {
        int mondayOnly = RepeatSchedule.bit(DayOfWeek.MONDAY);
        assertThat(RepeatSchedule.next(mondayOnly, MONDAY)).isEqualTo(MONDAY.plusDays(7));
        assertThat(RepeatSchedule.next(MON_WED_FRI, MONDAY)).isEqualTo(MONDAY.plusDays(2)); // 수
        assertThat(RepeatSchedule.next(RepeatSchedule.EVERYDAY, MONDAY)).isEqualTo(MONDAY.plusDays(1));
    }

    @Test
    @DisplayName("이전 활성일 — next 와 대칭(결과 모달의 직전 회차일)")
    void previousIsSymmetricToNext() {
        int mondayOnly = RepeatSchedule.bit(DayOfWeek.MONDAY);
        assertThat(RepeatSchedule.previous(mondayOnly, MONDAY)).isEqualTo(MONDAY.minusDays(7));
        assertThat(RepeatSchedule.previous(MON_WED_FRI, MONDAY)).isEqualTo(MONDAY.minusDays(3)); // 지난 금
    }

    @Test
    @DisplayName("이번 주 남은 활성일 — 오늘 포함, 일요일까지 오름차순")
    void remainingThisWeekIncludesTodayThroughSunday() {
        LocalDate wednesday = MONDAY.plusDays(2);
        assertThat(RepeatSchedule.remainingThisWeek(MON_WED_FRI, wednesday))
                .containsExactly(wednesday, MONDAY.plusDays(4));
        // 일요일 기준 — 일이 비활성이면 빈 목록.
        assertThat(RepeatSchedule.remainingThisWeek(MON_WED_FRI, MONDAY.plusDays(6))).isEmpty();
        // 매일 마스크 — 월요일 기준 7일 전부.
        assertThat(RepeatSchedule.remainingThisWeek(RepeatSchedule.EVERYDAY, MONDAY)).hasSize(7);
    }

    @Test
    @DisplayName("요일 교집합 — 한 요일이라도 겹치면 true, 완전 분리면 false (창 겹침 §A5 의 1관문)")
    void overlapsChecksWeekdayIntersection() {
        int tueThu = RepeatSchedule.maskOf(Set.of(DayOfWeek.TUESDAY, DayOfWeek.THURSDAY));
        int wedThu = RepeatSchedule.maskOf(Set.of(DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY));

        // 월수금 vs 화목 — 교집합 ∅ 라 같은 시간대여도 창 겹침이 아니다
        assertThat(RepeatSchedule.overlaps(MON_WED_FRI, tueThu)).isFalse();
        // 월수금 vs 수목 — 수요일 하나만 겹쳐도 true(그날 하나의 행동이 두 목표를 채운다)
        assertThat(RepeatSchedule.overlaps(MON_WED_FRI, wedThu)).isTrue();
        // 매일은 무엇과도 겹치고, 같은 마스크끼리는 당연히 겹친다
        assertThat(RepeatSchedule.overlaps(RepeatSchedule.EVERYDAY, tueThu)).isTrue();
        assertThat(RepeatSchedule.overlaps(MON_WED_FRI, MON_WED_FRI)).isTrue();
        // 대칭이다 — 인자 순서로 답이 갈리면 "누가 기존 창인가"가 판정을 바꾼다
        assertThat(RepeatSchedule.overlaps(tueThu, MON_WED_FRI))
                .isEqualTo(RepeatSchedule.overlaps(MON_WED_FRI, tueThu));
        // 단일 요일끼리
        assertThat(RepeatSchedule.overlaps(
                RepeatSchedule.bit(DayOfWeek.MONDAY), RepeatSchedule.bit(DayOfWeek.MONDAY))).isTrue();
        assertThat(RepeatSchedule.overlaps(
                RepeatSchedule.bit(DayOfWeek.MONDAY), RepeatSchedule.bit(DayOfWeek.SUNDAY))).isFalse();
    }

    @Test
    @DisplayName("범위 밖 마스크(0·128)는 활성일 계산을 거부한다 — DB CHECK(1~127)와 같은 경계")
    void rejectsMaskOutOfRange() {
        assertThat(RepeatSchedule.isValidMask(0)).isFalse();
        assertThat(RepeatSchedule.isValidMask(128)).isFalse();
        assertThat(RepeatSchedule.isValidMask(1)).isTrue();
        assertThat(RepeatSchedule.isValidMask(127)).isTrue();
        assertThatThrownBy(() -> RepeatSchedule.next(0, MONDAY))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> RepeatSchedule.remainingThisWeek(128, MONDAY))
                .isInstanceOf(IllegalArgumentException.class);
        // 교집합도 같은 가드를 쓴다 — 0(요일 없음)을 "아무것과도 안 겹침"으로 조용히 통과시키면
        // 저장 불가한 마스크가 겹침 검사를 무력화하는 우회로가 된다
        assertThatThrownBy(() -> RepeatSchedule.overlaps(0, RepeatSchedule.EVERYDAY))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> RepeatSchedule.overlaps(RepeatSchedule.EVERYDAY, 128))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
