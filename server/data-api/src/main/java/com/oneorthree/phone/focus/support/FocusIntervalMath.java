package com.oneorthree.phone.focus.support;

import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.NavigableMap;
import java.util.Optional;
import java.util.TreeMap;

/**
 * v0.3 세션 구간의 순수 시간 계산 (GROMO-1764, LLD §4). 주입이 없는 순수 계산기라 {@code support/}다.
 *
 * <p>ACTIVE 길이는 <b>마이크로초로 합산한 뒤 마지막에 한 번만</b> 초로 내린다 — pause마다 초 단위로
 * 잘라 반복 pause로 시간이 유실되지 않게 한다는 LLD §4 원칙 그대로다. 열린 구간은 {@code now}로
 * 임시로 닫아 계산하고, 그 값을 DB에 다시 쓰지 않는다(진행 중 조회 전용).
 */
public final class FocusIntervalMath {

    private FocusIntervalMath() {
    }

    /**
     * @param intervals 세션의 전체 구간(순서 무관)
     * @param now       열린 구간을 임시로 닫을 anchor
     * @return {@code now} 시점까지의 순수 ACTIVE 초 합(floor)
     */
    public static long activeSecondsAsOf(List<FocusSessionInterval> intervals, Instant now) {
        long totalMicros = 0;
        for (FocusSessionInterval interval : intervals) {
            if (interval.getKind() != FocusIntervalKind.ACTIVE) {
                continue;
            }
            Instant end = interval.getEndedAt() != null ? interval.getEndedAt() : now;
            totalMicros += microsBetween(interval.getStartedAt(), end);
        }
        return totalMicros / 1_000_000L;
    }

    /**
     * ACTIVE 구간과 {@code [windowStart, windowEnd)}의 교집합 초 합 — home-summary의
     * {@code currentSessionSecondsToday}(요청한 날짜에 걸친 진행 구간의 몫)에 쓴다.
     *
     * @param intervals  세션의 전체 구간
     * @param now        열린 구간을 임시로 닫을 anchor
     * @param windowStart 창 시작(포함)
     * @param windowEnd   창 끝(제외)
     * @return 교집합 순수 초 합(floor). 겹치지 않으면 0
     */
    public static long activeSecondsOverlapping(List<FocusSessionInterval> intervals, Instant now,
                                                Instant windowStart, Instant windowEnd) {
        long totalMicros = 0;
        for (FocusSessionInterval interval : intervals) {
            if (interval.getKind() != FocusIntervalKind.ACTIVE) {
                continue;
            }
            Instant end = interval.getEndedAt() != null ? interval.getEndedAt() : now;
            Instant lo = maxInstant(interval.getStartedAt(), windowStart);
            Instant hi = minInstant(end, windowEnd);
            if (hi.isAfter(lo)) {
                totalMicros += microsBetween(lo, hi);
            }
        }
        return totalMicros / 1_000_000L;
    }

    /**
     * 닫힌 ACTIVE 구간의 날짜별 순수 집중 초 — LLD §4 의 일별 분포 규칙 그대로다(finish 가 일 집계에 쓴다).
     *
     * <p>ACTIVE 구간을 {@code zone} 자정으로 자른 뒤 날짜별 마이크로초를 모으고, 총 초
     * {@code T = floor(총 micros / 1e6)} 와 날짜 d 까지의 누적 micros {@code C(d)} 로 누적 배정
     * {@code min(ceil(C(d)/1e6), T)} 의 전일 대비 차를 그날 몫으로 준다. 그래서 날짜 합은 언제나 T 이고,
     * 소수초 경계는 최대 1초의 결정적 배분이다(예: 23:59:59.8~00:00:00.8 → 전일 1 · 당일 0).
     *
     * @param intervals 세션의 전체 구간 — 열린 구간이 없어야 한다(닫은 뒤 부른다). 열린 구간은 건너뛴다
     * @param zone      날짜 축(KST, date-axis 규약)
     * @return 날짜 오름차순 몫. 0초인 날짜는 담지 않는다
     */
    public static NavigableMap<LocalDate, Integer> activeSecondsByDate(List<FocusSessionInterval> intervals,
                                                                        ZoneId zone) {
        TreeMap<LocalDate, Long> microsByDate = new TreeMap<>();
        long totalMicros = 0;
        for (FocusSessionInterval interval : intervals) {
            if (interval.getKind() != FocusIntervalKind.ACTIVE || interval.getEndedAt() == null) {
                continue;
            }
            Instant cursor = interval.getStartedAt();
            Instant end = interval.getEndedAt();
            while (cursor.isBefore(end)) {
                ZonedDateTime local = cursor.atZone(zone);
                Instant nextMidnight = local.toLocalDate().plusDays(1).atStartOfDay(zone).toInstant();
                Instant pieceEnd = minInstant(end, nextMidnight);
                long micros = microsBetween(cursor, pieceEnd);
                microsByDate.merge(local.toLocalDate(), micros, Long::sum);
                totalMicros += micros;
                cursor = pieceEnd;
            }
        }
        long totalSeconds = totalMicros / 1_000_000L;
        NavigableMap<LocalDate, Integer> result = new TreeMap<>();
        long cumulativeMicros = 0;
        long assigned = 0;
        for (Map.Entry<LocalDate, Long> day : microsByDate.entrySet()) {
            cumulativeMicros += day.getValue();
            long upTo = Math.min((cumulativeMicros + 999_999L) / 1_000_000L, totalSeconds);
            long share = upTo - assigned;
            assigned = upTo;
            if (share > 0) {
                result.put(day.getKey(), Math.toIntExact(share));
            }
        }
        return result;
    }

    /** @return 열린(진행 중) 구간 — 세션당 최대 1개(DB 부분 UNIQUE). 없으면 빈 값 */
    public static Optional<FocusSessionInterval> openInterval(List<FocusSessionInterval> intervals) {
        return intervals.stream().filter(FocusSessionInterval::isOpen).findFirst();
    }

    /** @return paused 중이면 열린 REST 구간의 시작 시각, active면 {@code null} */
    public static Instant openRestStartedAt(List<FocusSessionInterval> intervals) {
        return intervals.stream()
                .filter(interval -> interval.getKind() == FocusIntervalKind.REST && interval.isOpen())
                .map(FocusSessionInterval::getStartedAt)
                .findFirst()
                .orElse(null);
    }

    /** @return 다음에 발급할 ordinal(1부터) — 세션 안에서 (session_id, ordinal) UNIQUE와 짝을 이룬다 */
    public static int nextOrdinal(List<FocusSessionInterval> intervals) {
        return intervals.size() + 1;
    }

    /** @return 세션 최초 시작 시각 — ordinal 1(첫 ACTIVE 구간)의 startedAt */
    public static Instant sessionStartedAt(List<FocusSessionInterval> intervals) {
        return intervals.get(0).getStartedAt();
    }

    private static Instant maxInstant(Instant a, Instant b) {
        return a.isAfter(b) ? a : b;
    }

    private static Instant minInstant(Instant a, Instant b) {
        return a.isBefore(b) ? a : b;
    }

    private static long microsBetween(Instant start, Instant end) {
        return Duration.between(start, end).toNanos() / 1000L;
    }
}
