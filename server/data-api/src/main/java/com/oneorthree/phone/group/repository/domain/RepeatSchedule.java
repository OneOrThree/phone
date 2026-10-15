package com.oneorthree.phone.group.repository.domain;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * 요일 반복 스케줄(§A3 · LLD §3.4) — {@code repeat_days} 비트마스크의 <b>단일 소유자</b>.
 *
 * <p>ISO-8601 요일 번호(월=1…일=7)를 {@code 1 << (dow - 1)} 로 접는다: 월=1·화=2·수=4·목=8·
 * 금=16·토=32·일=64. 평일 = 0b0011111 = 31, 매일 = 127. 0(요일 없음)은 DB CHECK 로 저장 불가다.
 *
 * <p>활성일 판정({@link #activeOn})·다음 활성일({@link #next})은 회차 개설(B4)·참여(B5)·알림이,
 * 요일 교집합({@link #overlaps})과 요일 회전({@link #rotate})은 창 겹침 검사(§A5)가 전부 이 유틸을
 * 거친다 — 경로마다 비트 연산을 새로 만들면 조용히 갈라진다.
 */
public final class RepeatSchedule {

    /** 매일(월~일 전부) — 구앱 생성 기본값이자 V34 기존 행 백필값. */
    public static final int EVERYDAY = 0b111_1111;

    /** 마스크 유효 범위 — DB CHECK (repeat_days BETWEEN 1 AND 127)와 같은 값. */
    public static final int MIN_MASK = 1;
    /** 마스크 상한 — 매일(127)이 곧 최대값이라 {@link #EVERYDAY} 와 같은 값을 가리킨다. */
    public static final int MAX_MASK = EVERYDAY;

    /** 마스크의 비트 폭이자 회전의 모듈러스 — 한 주는 7일이다. */
    private static final int DAYS_IN_WEEK = 7;

    private RepeatSchedule() {
    }

    /**
     * 요일 하나의 비트 — 월=1 … 일=64.
     *
     * @param day 비트로 접을 요일. ISO 번호(월=1…일=7)를 그대로 쓰므로 로케일에 따라 흔들리지 않는다
     * @return 그 요일 하나만 켜진 마스크. 한 비트뿐이라 그 자체로 유효 마스크(1~127)다
     */
    public static int bit(DayOfWeek day) {
        return 1 << (day.getValue() - 1);
    }

    /**
     * 요일 집합 → 마스크. 빈 컬렉션이면 0 — 저장 전 검증은 호출측 몫(§A3 기본값 없음).
     *
     * @param days 켤 요일들. 중복은 무해하고(OR 라 같은 비트), 순서도 상관없다. null 은 받지 않는다
     * @return OR 로 합친 마스크. <b>빈 컬렉션이면 0 이고 이 값은 저장할 수 없다</b>(DB CHECK 1~127) —
     *     0 을 걸러내는 책임은 이 함수가 아니라 호출측에 있다
     */
    public static int maskOf(Collection<DayOfWeek> days) {
        int mask = 0;
        for (DayOfWeek day : days) {
            mask |= bit(day);
        }
        return mask;
    }

    /**
     * 유효한 마스크인가 — 1~127.
     *
     * @param mask 검사할 마스크. 범위 밖이어도 예외를 던지지 않는다(판정만 한다)
     * @return DB CHECK 와 같은 기준의 통과 여부. 요일이 하나도 없는 0 은 false 다 — "반복 없음"을
     *     0 으로 표현하는 스케줄은 존재하지 않는다
     */
    public static boolean isValidMask(int mask) {
        return mask >= MIN_MASK && mask <= MAX_MASK;
    }

    /**
     * 날짜 d 가 도는 날(활성 요일)인가.
     *
     * @param mask 스케줄 마스크. <b>여기서는 범위 검증을 하지 않는다</b> — 0 을 넣으면 조용히 항상 false 다
     * @param date 판정할 날짜. 요일만 보므로 연·월·일 자체는 결과에 영향이 없다
     * @return 그 날 회차가 도는지 여부
     */
    public static boolean activeOn(int mask, LocalDate date) {
        return (mask & bit(date.getDayOfWeek())) != 0;
    }

    /**
     * 두 스케줄이 같은 날 함께 도는가 — 요일 교집합 ≠ ∅ (§A5 · LLD §3.6).
     *
     * <p>창 겹침 판정(§A5)의 첫 관문이다: 요일이 안 겹치면 시간대가 완전히 같아도 서로 다른 날의
     * 일이라 겹침이 아니다. 교집합 판정을 서비스에 인라인하지 않고 여기 두는 이유는 이 클래스가
     * {@code repeat_days} 비트 연산의 단일 소유자이기 때문이다.
     *
     * @param maskA 한쪽 스케줄 마스크(1~127) — 범위 밖이면 {@link IllegalArgumentException}
     * @param maskB 다른 쪽 스케줄 마스크(1~127) — 범위 밖이면 {@link IllegalArgumentException}
     * @return 같은 날 함께 도는 요일이 하나라도 있으면 true. false 면 시간대가 완전히 같아도 겹침이
     *     아니므로 §A5 검사는 여기서 끝난다
     */
    public static boolean overlaps(int maskA, int maskB) {
        requireValidMask(maskA);
        requireValidMask(maskB);
        return (maskA & maskB) != 0;
    }

    /**
     * 스케줄을 {@code days} 일 <b>뒤로 미룬</b> 7비트 순환 시프트 — 요일 i 의 활성이 요일 i+days 로 간다
     * (§A5 자정 인접 판정 · GROMO-1498).
     *
     * <p>창 겹침 검사가 창 하나를 하루 앞뒤로 옮겨 비교할 때, 시각만 옮기고 요일을 그대로 두면
     * 「월요일 밤 A ↔ 화요일 새벽 B」가 같은 요일끼리 비교돼 버린다. 시각 이동과 짝이 되는
     * 요일 이동이 이 함수다.
     *
     * <p>{@code days} 는 음수·7 이상도 받는다({@code Math.floorMod} 로 접는다). {@code EVERYDAY}(127)는
     * 회전 불변이고, 0 이 아닌 마스크의 순환 시프트는 비트 수를 보존하므로 결과도 0 이 될 수 없다 —
     * 1~127 불변식이 자동으로 지켜진다.
     *
     * @param mask 옮길 스케줄 마스크(1~127) — 범위 밖이면 {@link IllegalArgumentException}
     * @param days 미룰 일수. 음수(앞당김)·7 이상도 {@code Math.floorMod} 로 접어 받는다
     * @return 회전한 마스크. 비트 수가 보존되므로 결과도 항상 1~127 이고, {@link #EVERYDAY} 는 그대로다
     */
    public static int rotate(int mask, int days) {
        requireValidMask(mask);
        int shift = Math.floorMod(days, DAYS_IN_WEEK);
        return ((mask << shift) | (mask >>> (DAYS_IN_WEEK - shift))) & EVERYDAY;
    }

    /**
     * d 이후(포함하지 않음) 첫 활성일. mask ≥ 1 이므로 최대 7일 안에 반드시 찾는다.
     *
     * @param mask 스케줄 마스크(1~127) — 범위 밖이면 {@link IllegalArgumentException}
     * @param date 기준일. <b>이 날 자신은 후보가 아니다</b> — 오늘이 활성일이어도 다음 활성일을 준다
     * @return 기준일 다음날부터 세어 처음 만나는 활성일. 유효 마스크에서는 empty 나 null 이 없다
     */
    public static LocalDate next(int mask, LocalDate date) {
        requireValidMask(mask);
        for (int i = 1; i <= 7; i++) {
            LocalDate candidate = date.plusDays(i);
            if (activeOn(mask, candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("unreachable — 유효 마스크는 7일 안에 활성일이 있다: " + mask);
    }

    /**
     * d 이전(포함하지 않음) 마지막 활성일 — 결과 모달의 "직전 회차일"({@link #next} 와 대칭).
     *
     * @param mask 스케줄 마스크(1~127) — 범위 밖이면 {@link IllegalArgumentException}
     * @param date 기준일. 이 날 자신은 후보가 아니다(오늘이 활성일이어도 어제 이전에서 찾는다)
     * @return 기준일 전날부터 거슬러 처음 만나는 활성일. 유효 마스크에서는 항상 7일 안에 있다
     */
    public static LocalDate previous(int mask, LocalDate date) {
        requireValidMask(mask);
        for (int i = 1; i <= 7; i++) {
            LocalDate candidate = date.minusDays(i);
            if (activeOn(mask, candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("unreachable — 유효 마스크는 7일 안에 활성일이 있다: " + mask);
    }

    /**
     * d 를 <b>포함한</b> 그 주(월~일)의 남은 활성일 오름차순 — "이번 주 전부" 예약(join-week)용.
     *
     * @param mask 스케줄 마스크(1~127) — 범위 밖이면 {@link IllegalArgumentException}
     * @param date 시작일이자 포함 대상. 이 날이 활성일이면 결과의 첫 원소가 된다
     * @return 기준일부터 그 주 일요일까지의 활성일 오름차순. <b>기준일이 일요일이면 최대 1개</b>이고,
     *     남은 활성일이 없으면 빈 리스트다(마스크가 비었다는 뜻이 아니라 이번 주가 끝났다는 뜻)
     */
    public static List<LocalDate> remainingThisWeek(int mask, LocalDate date) {
        requireValidMask(mask);
        List<LocalDate> remaining = new ArrayList<>();
        for (LocalDate cursor = date; ; cursor = cursor.plusDays(1)) {
            if (activeOn(mask, cursor)) {
                remaining.add(cursor);
            }
            if (cursor.getDayOfWeek() == DayOfWeek.SUNDAY) {
                return remaining;
            }
        }
    }

    private static void requireValidMask(int mask) {
        if (!isValidMask(mask)) {
            throw new IllegalArgumentException("repeat_days 마스크 범위 밖: " + mask);
        }
    }
}
