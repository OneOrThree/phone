package com.oneorthree.phone.group.dto;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 와이어 요일 배열 ↔ repeat_days 비트마스크 양방향 변환 검증(GROMO-1260).
 *
 * <p>API 는 ISO 요일 문자열 배열("MON"~"SUN"), DB 는 smallint 비트마스크(월=1…일=64)다 —
 * 변환이 양쪽 유틸({@code maskOf}/{@code listOf})로만 이뤄지므로 왕복 보존이 곧 계약이다.
 */
class RepeatDayTest {

    @Test
    @DisplayName("maskOf — [MON, WED, FRI] → 21(1|4|16), 전체 7요일 → 127, 중복 요일은 접힌다")
    void foldsDaysIntoMask() {
        assertThat(RepeatDay.maskOf(List.of(RepeatDay.MON, RepeatDay.WED, RepeatDay.FRI)))
                .isEqualTo(0b0010101);
        assertThat(RepeatDay.maskOf(List.of(RepeatDay.values()))).isEqualTo(127);
        assertThat(RepeatDay.maskOf(List.of(RepeatDay.SUN))).isEqualTo(64);
        assertThat(RepeatDay.maskOf(List.of(RepeatDay.MON, RepeatDay.MON))).isEqualTo(1);
        assertThat(RepeatDay.maskOf(List.of())).isZero();
    }

    @Test
    @DisplayName("listOf — 마스크를 항상 월~일 정렬 배열로 복원한다 (앱 전송 정렬과 동일)")
    void unfoldsMaskInWeekOrder() {
        assertThat(RepeatDay.listOf(0b0010101))
                .containsExactly(RepeatDay.MON, RepeatDay.WED, RepeatDay.FRI);
        assertThat(RepeatDay.listOf(127)).containsExactly(RepeatDay.values());
        assertThat(RepeatDay.listOf(64)).containsExactly(RepeatDay.SUN);
    }

    @Test
    @DisplayName("왕복 보존 — 유효 마스크 1~127 전수에서 listOf → maskOf 가 원값을 되돌린다")
    void roundTripsEveryValidMask() {
        for (int mask = 1; mask <= 127; mask++) {
            assertThat(RepeatDay.maskOf(RepeatDay.listOf(mask)))
                    .as("mask=%d", mask)
                    .isEqualTo(mask);
        }
    }
}
