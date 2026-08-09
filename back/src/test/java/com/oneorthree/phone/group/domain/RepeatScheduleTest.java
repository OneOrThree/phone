package com.oneorthree.phone.group.domain;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link RepeatSchedule} 순수 커널 단위 테스트 (GROMO-1260).
 *
 * <p>기준 주: 2026-08-10(월) ~ 2026-08-16(일). 요일 경계·주 경계·월 경계가 한 화면에 들어오도록
 * 8월 말(2026-08-31 이 월요일)도 함께 쓴다.
 */
class RepeatScheduleTest {

    /** 월수금 = 1 | 4 | 16. 정책 예시("월·수·금 09–12시 집중 90분")와 같은 조합이다. */
    private static final int MON_WED_FRI = 0b0010101;

    @Test
    @DisplayName("비트 배치 — 월=1 … 일=64, 평일=31, 매일=127 (ISO 요일 번호 기준)")
    void mapsIsoDayNumbersToBits() {
        assertThat(RepeatSchedule.bit(DayOfWeek.MONDAY)).isEqualTo(1);
        assertThat(RepeatSchedule.bit(DayOfWeek.SATURDAY)).isEqualTo(32);
        assertThat(RepeatSchedule.bit(DayOfWeek.SUNDAY)).isEqualTo(64);
        assertThat(RepeatSchedule.WEEKDAYS).isEqualTo(31);
        assertThat(RepeatSchedule.EVERY_DAY).isEqualTo(127);
    }

    @ParameterizedTest(name = "mask={0} 유효={1}")
    @CsvSource({"0,false", "1,true", "31,true", "127,true", "128,false", "-1,false"})
    @DisplayName("유효 범위는 1~127 — DB CHECK(repeat_days BETWEEN 1 AND 127)와 같은 경계다")
    void validatesMaskRange(int mask, boolean valid) {
        assertThat(RepeatSchedule.isValid(mask)).isEqualTo(valid);
    }

    @ParameterizedTest(name = "{0} 활성={1}")
    @CsvSource({
            "2026-08-10,true",   // 월
            "2026-08-11,false",  // 화
            "2026-08-12,true",   // 수
            "2026-08-13,false",  // 목
            "2026-08-14,true",   // 금
            "2026-08-15,false",  // 토
            "2026-08-16,false",  // 일
    })
    @DisplayName("activeOn — 월수금 마스크는 그 세 요일에만 참이다")
    void resolvesActiveDays(String date, boolean active) {
        assertThat(RepeatSchedule.activeOn(MON_WED_FRI, LocalDate.parse(date))).isEqualTo(active);
    }

    @ParameterizedTest(name = "{0} → 다음 활성일 {1}")
    @CsvSource({
            "2026-08-10,2026-08-12",  // 월 → 수 (오늘을 세지 않는다)
            "2026-08-12,2026-08-14",  // 수 → 금
            "2026-08-14,2026-08-17",  // 금 → 다음 주 월 (주 경계를 넘는다)
            "2026-08-16,2026-08-17",  // 일 → 월
            "2026-08-31,2026-09-02",  // 월 → 수 (월 경계를 넘는다)
    })
    @DisplayName("next — 오늘을 제외한 첫 활성일. 오늘이 활성일이어도 다음을 가리킨다")
    void findsNextActiveDayExcludingToday(String from, String expected) {
        assertThat(RepeatSchedule.next(MON_WED_FRI, LocalDate.parse(from)))
                .isEqualTo(LocalDate.parse(expected));
    }

    @ParameterizedTest(name = "{0} → 직전 활성일 {1}")
    @CsvSource({
            "2026-08-12,2026-08-10",  // 수 → 월. "어제"로 갈음하면 틀린다(어제는 화요일)
            "2026-08-10,2026-08-07",  // 월 → 지난 주 금
            "2026-08-16,2026-08-14",  // 일 → 금
            "2026-09-02,2026-08-31",  // 수 → 월 (월 경계를 넘는다)
    })
    @DisplayName("previous — 오늘을 제외한 마지막 활성일. 결과 모달의 '직전 회차일'이 이걸 쓴다")
    void findsPreviousActiveDayExcludingToday(String from, String expected) {
        assertThat(RepeatSchedule.previous(MON_WED_FRI, LocalDate.parse(from)))
                .isEqualTo(LocalDate.parse(expected));
    }

    @Test
    @DisplayName("매일 마스크에서는 next/previous 가 내일·어제다 — 하루 간격이 유지된다")
    void everyDayMaskStepsOneDay() {
        LocalDate wednesday = LocalDate.parse("2026-08-12");
        assertThat(RepeatSchedule.next(RepeatSchedule.EVERY_DAY, wednesday))
                .isEqualTo(LocalDate.parse("2026-08-13"));
        assertThat(RepeatSchedule.previous(RepeatSchedule.EVERY_DAY, wednesday))
                .isEqualTo(LocalDate.parse("2026-08-11"));
    }

    @Test
    @DisplayName("단일 요일 마스크에서는 next/previous 가 정확히 7일 떨어진다")
    void singleDayMaskStepsAFullWeek() {
        int sundayOnly = RepeatSchedule.bit(DayOfWeek.SUNDAY);
        LocalDate sunday = LocalDate.parse("2026-08-16");
        assertThat(RepeatSchedule.next(sundayOnly, sunday)).isEqualTo(LocalDate.parse("2026-08-23"));
        assertThat(RepeatSchedule.previous(sundayOnly, sunday)).isEqualTo(LocalDate.parse("2026-08-09"));
    }

    @ParameterizedTest(name = "{0} 기준 이번 주 남은 활성일")
    @CsvSource({
            "2026-08-10,2026-08-10|2026-08-12|2026-08-14",  // 월(주 시작) — 오늘을 포함한다
            "2026-08-12,2026-08-12|2026-08-14",             // 수 — 오늘 포함, 지난 월요일은 빠진다
            "2026-08-14,2026-08-14",                        // 금 — 오늘 하나뿐
            "2026-08-15,",                                  // 토 — 남은 활성일 없음
    })
    @DisplayName("remainingThisWeek — 오늘을 포함한 그 ISO 주(월~일)의 활성일. '이번 주 전부' 예약이 이걸 쓴다")
    void listsRemainingActiveDaysThisWeek(String from, String expectedJoined) {
        List<LocalDate> expected = expectedJoined == null || expectedJoined.isBlank()
                ? List.of()
                : java.util.Arrays.stream(expectedJoined.split("\\|")).map(LocalDate::parse).toList();

        assertThat(RepeatSchedule.remainingThisWeek(MON_WED_FRI, LocalDate.parse(from)))
                .containsExactlyElementsOf(expected);
    }

    @Test
    @DisplayName("remainingThisWeek 는 일요일에서 주를 넘지 않는다 — 다음 주 월요일이 섞이면 예약이 새 주로 샌다")
    void remainingThisWeekStopsAtSunday() {
        // 매일 마스크로 일요일에 물으면 그날 하나뿐이어야 한다(다음 주 월요일은 다른 주).
        assertThat(RepeatSchedule.remainingThisWeek(RepeatSchedule.EVERY_DAY, LocalDate.parse("2026-08-16")))
                .containsExactly(LocalDate.parse("2026-08-16"));
        // 월요일에 물으면 그 주 7일 전부.
        assertThat(RepeatSchedule.remainingThisWeek(RepeatSchedule.EVERY_DAY, LocalDate.parse("2026-08-10")))
                .hasSize(7)
                .last().isEqualTo(LocalDate.parse("2026-08-16"));
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 128})
    @DisplayName("범위 밖 마스크는 탐색 진입 자체를 막는다 — 무한 루프 대신 즉시 실패한다")
    void rejectsOutOfRangeMaskOnTraversal(int mask) {
        LocalDate date = LocalDate.parse("2026-08-12");
        assertThatThrownBy(() -> RepeatSchedule.next(mask, date))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> RepeatSchedule.previous(mask, date))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> RepeatSchedule.remainingThisWeek(mask, date))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("maskOf — 3글자 약어·전체 이름·대소문자 혼용을 모두 같은 마스크로 수렴시킨다")
    void parsesWireNames() {
        assertThat(RepeatSchedule.maskOf(List.of("MON", "WED", "FRI"))).isEqualTo(MON_WED_FRI);
        assertThat(RepeatSchedule.maskOf(List.of("monday", "Wed", " fri "))).isEqualTo(MON_WED_FRI);
        // 중복은 비트 OR 라 흡수된다 — 클라가 같은 요일을 두 번 보내도 결과가 같다.
        assertThat(RepeatSchedule.maskOf(List.of("MON", "MON"))).isEqualTo(RepeatSchedule.bit(DayOfWeek.MONDAY));
    }

    @Test
    @DisplayName("maskOf — 빈 목록과 알 수 없는 표기는 거절한다(호출측이 각각 다른 400 으로 매핑)")
    void rejectsEmptyAndUnknownNames() {
        assertThatThrownBy(() -> RepeatSchedule.maskOf(List.of()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> RepeatSchedule.maskOf(null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> RepeatSchedule.maskOf(List.of("MON", "FUNDAY")))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("namesOf — 월→일 순서로 3글자 약어를 돌려준다(maskOf 와 왕복)")
    void formatsWireNamesInIsoOrder() {
        assertThat(RepeatSchedule.namesOf(MON_WED_FRI)).containsExactly("MON", "WED", "FRI");
        assertThat(RepeatSchedule.namesOf(RepeatSchedule.EVERY_DAY))
                .containsExactly("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN");
        assertThat(RepeatSchedule.maskOf(RepeatSchedule.namesOf(RepeatSchedule.WEEKDAYS)))
                .isEqualTo(RepeatSchedule.WEEKDAYS);
    }
}
