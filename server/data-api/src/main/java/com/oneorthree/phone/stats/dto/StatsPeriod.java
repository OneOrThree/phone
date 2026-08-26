package com.oneorthree.phone.stats.dto;

/** 집중 시간 통계 조회 기간 단위. */
public enum StatsPeriod {
    /** 오늘 하루 단위. */
    DAY,
    /** 이번 주 (월요일~오늘) 단위. */
    WEEK,
    /** 이번 달 (1일~오늘) 단위. */
    MONTH
}
