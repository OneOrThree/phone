package com.oneorthree.phone.group.domain;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;

/**
 * 챌린지 요일 반복 마스크의 <b>순수</b> 커널 (GROMO-1260) — DB·트랜잭션·시계에 무지하다.
 *
 * <p>마스크는 ISO-8601 요일 번호(월=1 … 일=7)를 {@code 1 << (dow - 1)} 로 접은 비트 집합이다.
 * 월=1 · 화=2 · 수=4 · 목=8 · 금=16 · 토=32 · 일=64 → 평일 {@value #WEEKDAYS}, 매일 {@value #EVERY_DAY}.
 * {@code 0}(요일 하나도 없음)은 저장 불가다 — DB CHECK {@code repeat_days BETWEEN 1 AND 127}(V32)와
 * 생성 검증({@code CHALLENGE_REPEAT_DAYS_REQUIRED})이 같은 규칙을 양쪽에서 막는다.
 *
 * <p><b>날짜는 전부 KST 기준</b>이다(정책 §B3). 호출측이 KST 날짜를 넘긴다 — 여기서 zone 변환을 하지 않는다.
 *
 * <p>와이어 표기는 3글자 ISO 약어({@code "MON"} … {@code "SUN"})다. 파싱은 {@link #maskOf}, 표기는
 * {@link #namesOf} 단일 변환점을 쓴다 — 경로마다 새 변환을 만들지 말 것.
 */
public final class RepeatSchedule {

    /** 월~일 전부 — 요일 개념 도입 전 챌린지의 현행 동작이고 V32 백필 값이다. */
    public static final int EVERY_DAY = 0b1111111;

    /** 월~금. */
    public static final int WEEKDAYS = 0b0011111;

    /** 마스크에 담긴 요일 수의 상한 = 한 주. {@link #next}·{@link #previous} 의 탐색 한계다. */
    private static final int DAYS_IN_WEEK = 7;

    private RepeatSchedule() {
    }

    /** 요일 하나의 비트 — 월=1 … 일=64. */
    public static int bit(DayOfWeek day) {
        return 1 << (day.getValue() - 1);
    }

    /** 마스크가 유효한가 — 1 ≤ mask ≤ 127. DB CHECK 와 같은 범위다. */
    public static boolean isValid(int mask) {
        return mask >= 1 && mask <= EVERY_DAY;
    }

    /** 날짜 {@code date} 가 활성 요일인가. */
    public static boolean activeOn(int mask, LocalDate date) {
        return (mask & bit(date.getDayOfWeek())) != 0;
    }

    /**
     * {@code date} <b>이후</b>(당일 제외) 첫 활성일. 마스크에 요일이 하나는 있으므로 최대 7일 안에 반드시 찾는다.
     *
     * <p>당일을 제외하는 이유는 응답의 {@code nextSessionAt} 계약 때문이다 — 오늘 회차 정보는
     * 별도 필드가 싣고, 이 값은 항상 "그 다음"을 가리켜야 오늘 도는 챌린지가 "다음 회차 내일"로
     * 잘못 읽히지 않는다(LLD §2.1).
     */
    public static LocalDate next(int mask, LocalDate date) {
        requireValid(mask);
        for (int i = 1; i <= DAYS_IN_WEEK; i++) {
            LocalDate candidate = date.plusDays(i);
            if (activeOn(mask, candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("도달 불가 — mask 검증 후에는 7일 내 활성일이 반드시 있다: " + mask);
    }

    /**
     * {@code date} <b>이전</b>(당일 제외) 마지막 활성일 — 결과 모달의 "직전 회차일".
     *
     * <p>"어제"로 갈음할 수 없다: 월수금 챌린지를 수요일에 열면 직전 회차는 월요일이다.
     */
    public static LocalDate previous(int mask, LocalDate date) {
        requireValid(mask);
        for (int i = 1; i <= DAYS_IN_WEEK; i++) {
            LocalDate candidate = date.minusDays(i);
            if (activeOn(mask, candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("도달 불가 — mask 검증 후에는 7일 내 활성일이 반드시 있다: " + mask);
    }

    /**
     * {@code date} 를 포함한 그 주(<b>월~일</b>)의 남은 활성일 — "이번 주 남은 회차 전부" 예약용.
     *
     * <p>주 경계는 ISO(월요일 시작)다. 일요일에 부르면 그날이 활성일일 때만 1건, 아니면 빈 목록이다.
     * 결과는 날짜 오름차순이라 호출측이 그대로 순회하며 회차를 만든다.
     */
    public static List<LocalDate> remainingThisWeek(int mask, LocalDate date) {
        requireValid(mask);
        // DayOfWeek 는 TemporalAdjuster 라 with(SUNDAY) 가 "그 ISO 주(월~일)의 일요일"을 준다
        // (일요일에 부르면 자기 자신). 주 경계 계산을 직접 하지 않아 자정·월말 걸침 실수가 없다.
        LocalDate weekEnd = date.with(DayOfWeek.SUNDAY);
        List<LocalDate> days = new ArrayList<>();
        for (LocalDate d = date; !d.isAfter(weekEnd); d = d.plusDays(1)) {
            if (activeOn(mask, d)) {
                days.add(d);
            }
        }
        return List.copyOf(days);
    }

    /**
     * 와이어 표기({@code "MON"} · {@code "MONDAY"}, 대소문자 무관) 컬렉션 → 마스크.
     *
     * @throws IllegalArgumentException 비어 있거나(요일 미선택) 알 수 없는 표기가 섞였을 때 —
     *         호출측이 각각 {@code CHALLENGE_REPEAT_DAYS_REQUIRED} / {@code INVALID_MISSION_PARAMS} 로 매핑한다
     */
    public static int maskOf(Collection<String> names) {
        if (names == null || names.isEmpty()) {
            throw new IllegalArgumentException("요일을 하나 이상 선택해야 한다");
        }
        int mask = 0;
        for (String name : names) {
            mask |= bit(parseDay(name));
        }
        return mask;
    }

    /** 마스크 → 와이어 표기(월→일 순, 3글자 ISO 약어). */
    public static List<String> namesOf(int mask) {
        List<String> names = new ArrayList<>(DAYS_IN_WEEK);
        for (DayOfWeek day : DayOfWeek.values()) {
            if ((mask & bit(day)) != 0) {
                names.add(abbrev(day));
            }
        }
        return List.copyOf(names);
    }

    private static DayOfWeek parseDay(String name) {
        if (name == null) {
            throw new IllegalArgumentException("요일 표기가 비어 있다");
        }
        String normalized = name.trim().toUpperCase(Locale.ROOT);
        for (DayOfWeek day : DayOfWeek.values()) {
            if (day.name().equals(normalized) || abbrev(day).equals(normalized)) {
                return day;
            }
        }
        throw new IllegalArgumentException("알 수 없는 요일 표기: " + name);
    }

    private static String abbrev(DayOfWeek day) {
        return day.name().substring(0, 3);
    }

    private static void requireValid(int mask) {
        if (!isValid(mask)) {
            throw new IllegalArgumentException("요일 마스크는 1~127 이어야 한다: " + mask);
        }
    }
}
