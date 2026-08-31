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
    MON(DayOfWeek.MONDAY),
    TUE(DayOfWeek.TUESDAY),
    WED(DayOfWeek.WEDNESDAY),
    THU(DayOfWeek.THURSDAY),
    FRI(DayOfWeek.FRIDAY),
    SAT(DayOfWeek.SATURDAY),
    SUN(DayOfWeek.SUNDAY);

    private final DayOfWeek dayOfWeek;

    RepeatDay(DayOfWeek dayOfWeek) {
        this.dayOfWeek = dayOfWeek;
    }

    public DayOfWeek toDayOfWeek() {
        return dayOfWeek;
    }

    /** 요청 요일 목록 → repeat_days 마스크. 중복 요일은 자연히 접힌다. 빈 목록이면 0(호출측이 400). */
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
