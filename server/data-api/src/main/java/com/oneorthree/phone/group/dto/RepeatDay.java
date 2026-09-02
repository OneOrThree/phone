package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.repository.domain.RepeatSchedule;

import java.time.DayOfWeek;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * 챌린지 생성 요청의 요일 표기(LLD §2.1) — {@code "repeatDays": ["MON","WED","FRI"]}.
 *
 * <p>와이어 표기는 3글자 대문자로 고정한다(JS 클라이언트 관례). {@link DayOfWeek} 를 그대로 받으면
 * 앱이 MONDAY 전체 철자를 보내야 해서 별도 enum 으로 감싼다. 비트 접기는
 * {@link RepeatSchedule} 단일 유틸에 위임한다.
 */
public enum RepeatDay {
    /** 월요일. 주차의 시작이라 리그·통계의 주간 경계도 이 요일에 맞춰져 있다. */
    MON(DayOfWeek.MONDAY),
    /** 화요일. */
    TUE(DayOfWeek.TUESDAY),
    /** 수요일. */
    WED(DayOfWeek.WEDNESDAY),
    /** 목요일. */
    THU(DayOfWeek.THURSDAY),
    /** 금요일. */
    FRI(DayOfWeek.FRIDAY),
    /** 토요일. */
    SAT(DayOfWeek.SATURDAY),
    /** 일요일. {@link DayOfWeek} 에서는 주의 마지막이라 비트 순서도 여기서 끝난다. */
    SUN(DayOfWeek.SUNDAY);

    private final DayOfWeek dayOfWeek;

    RepeatDay(DayOfWeek dayOfWeek) {
        this.dayOfWeek = dayOfWeek;
    }

    /**
     * 마스크 변환과 활성 요일 판정이 모두 거치는 표준 요일값.
     *
     * @return {@link RepeatSchedule#bit} 에 넘길 {@link DayOfWeek}
     */
    public DayOfWeek toDayOfWeek() {
        return dayOfWeek;
    }

    /**
     * 요청 요일 목록 → repeat_days 마스크. 중복 요일은 자연히 접힌다. 빈 목록이면 0(호출측이 400).
     *
     * @param days 요청이 보낸 요일 목록 — 중복은 비트 OR 로 자연히 접힌다
     * @return repeat_days 마스크. 빈 목록이면 0 이고, 그 0 을 400 으로 바꿀지는 호출측이 정한다
     */
    public static int maskOf(Collection<RepeatDay> days) {
        int mask = 0;
        for (RepeatDay day : days) {
            mask |= RepeatSchedule.bit(day.toDayOfWeek());
        }
        return mask;
    }

    /**
     * repeat_days 마스크 → 응답 요일 목록. enum 선언 순서가 곧 월~일이라 <b>항상 월~일 정렬</b>이다
     * (앱도 같은 정렬로 보낸다 — 왕복 시 순서까지 보존). {@link #maskOf} 와 쌍인 역변환.
      *
      * @param mask repeat_days 마스크 — 요일에 대응하지 않는 비트는 조용히 버린다
      * @return 항상 월~일 정렬된 요일 목록. 마스크가 0 이면 빈 리스트다
     */
    public static List<RepeatDay> listOf(int mask) {
        List<RepeatDay> days = new ArrayList<>();
        for (RepeatDay day : values()) {
            if ((mask & RepeatSchedule.bit(day.toDayOfWeek())) != 0) {
                days.add(day);
            }
        }
        return days;
    }
}
