package com.oneorthree.phone.focus.support;

import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * GROMO-1764 LLD §4의 구간 산술 예시를 그대로 단언한다 — 실측 표(ACTIVE 09-11 23:50~23:55,
 * REST 23:55~09-12 00:05, ACTIVE 00:05~00:10 → 총 600초 등)와 "pause마다 초 단위로 자르지 않는다"는
 * 원칙이 실제로 지켜지는지가 이 로직의 회귀 지점이다.
 */
class FocusIntervalMathTest {

    private static final ZoneId KST = ZoneOffset.ofHours(9);

    @Test
    void activeSecondsAsOf_합산은_열린구간을now로_임시로닫고_마지막에한번만초로내린다() {
        Instant t0 = Instant.parse("2026-09-11T00:00:00.000Z");
        Instant t1 = Instant.parse("2026-09-11T00:00:00.400Z"); // REST 시작 — 첫 ACTIVE 0.4초
        Instant t2 = Instant.parse("2026-09-11T00:00:05.000Z"); // 재개(ACTIVE 재시작)
        Instant now = Instant.parse("2026-09-11T00:00:05.400Z"); // 열린 ACTIVE 구간 조회 시점 — 둘째 ACTIVE 0.4초

        List<FocusSessionInterval> intervals = List.of(
                interval(1, FocusIntervalKind.ACTIVE, t0, t1),
                interval(2, FocusIntervalKind.REST, t1, t2),
                interval(3, FocusIntervalKind.ACTIVE, t2, null));

        // 0.4초 + 0.4초 = 0.8초 → floor 0. 개별 조각을 각각 초로 내려도(0+0) 같은 값이지만,
        // 두 조각 다 0.6초씩이면(0.6+0.6=1.2 → floor 1) 개별 반올림(0+0=0)과 갈린다 — 다음 케이스가 그걸 본다.
        assertThat(FocusIntervalMath.activeSecondsAsOf(intervals, now)).isEqualTo(0L);
    }

    @Test
    void activeSecondsAsOf_반복pause로_소수초가_유실되지_않는다() {
        // 각각 0.6초인 ACTIVE 구간 둘 — 조각마다 내림하면 0+0=0초로 사라지지만, 마이크로초 누적 후
        // 한 번만 내리면 1.2초 → 1초가 살아남는다(LLD §4 "ACTIVE 누적0.6초 → REST → ACTIVE0.6초 = 총1초").
        Instant a0 = Instant.parse("2026-09-11T00:00:00.000Z");
        Instant a1 = Instant.parse("2026-09-11T00:00:00.600Z");
        Instant r1 = Instant.parse("2026-09-11T00:00:10.000Z");
        Instant b1 = Instant.parse("2026-09-11T00:00:10.600Z");

        List<FocusSessionInterval> intervals = List.of(
                interval(1, FocusIntervalKind.ACTIVE, a0, a1),
                interval(2, FocusIntervalKind.REST, a1, r1),
                interval(3, FocusIntervalKind.ACTIVE, r1, b1));

        assertThat(FocusIntervalMath.activeSecondsAsOf(intervals, b1)).isEqualTo(1L);
    }

    @Test
    void activeSecondsOverlapping_요청날짜에걸친_진행구간의몫만_더한다() {
        // ACTIVE 09-11 23:50~09-12 00:10 (KST) 진행 중 — 09-11 KST 요청은 그 날짜 몫(600초)만 받아야 한다.
        Instant start = Instant.parse("2026-09-11T14:50:00Z"); // 09-11 23:50 KST
        Instant now = Instant.parse("2026-09-11T15:10:00Z"); // 09-12 00:10 KST(진행 중, 열린 구간)
        List<FocusSessionInterval> intervals = List.of(interval(1, FocusIntervalKind.ACTIVE, start, null));

        Instant day0911Start = java.time.LocalDate.of(2026, 9, 11).atStartOfDay(KST).toInstant();
        Instant day0911End = java.time.LocalDate.of(2026, 9, 12).atStartOfDay(KST).toInstant();

        assertThat(FocusIntervalMath.activeSecondsOverlapping(intervals, now, day0911Start, day0911End))
                .isEqualTo(600L);

        Instant day0912Start = day0911End;
        Instant day0912End = java.time.LocalDate.of(2026, 9, 13).atStartOfDay(KST).toInstant();
        assertThat(FocusIntervalMath.activeSecondsOverlapping(intervals, now, day0912Start, day0912End))
                .isEqualTo(600L);
    }

    @Test
    void openRestStartedAt_paused가아니면_null이다() {
        List<FocusSessionInterval> active = List.of(
                interval(1, FocusIntervalKind.ACTIVE, Instant.EPOCH, null));
        assertThat(FocusIntervalMath.openRestStartedAt(active)).isNull();

        Instant restStart = Instant.parse("2026-09-11T00:00:10Z");
        List<FocusSessionInterval> paused = List.of(
                interval(1, FocusIntervalKind.ACTIVE, Instant.EPOCH, restStart),
                interval(2, FocusIntervalKind.REST, restStart, null));
        assertThat(FocusIntervalMath.openRestStartedAt(paused)).isEqualTo(restStart);
    }

    private static FocusSessionInterval interval(int ordinal, FocusIntervalKind kind, Instant start, Instant end) {
        return FocusSessionInterval.builder()
                .ordinal(ordinal)
                .kind(kind)
                .startedAt(start)
                .endedAt(end)
                .build();
    }
}
