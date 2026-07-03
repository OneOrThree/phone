package com.oneorthree.phone.stats.dto;

import java.util.List;

/**
 * 비교 통계 조회 응답. (GROMO-525)
 * comparisonAvailable=false 고정 — 실 집계는 후속 스프린트.
 */
public record ComparisonStatsResponse(
        /** 비교 데이터 제공 가능 여부. 스텁: false 고정. */
        boolean comparisonAvailable,
        /** 내 과목별·총 공부량 (스텁: totalMinutes=0, subjects=[]). */
        MyStats mine,
        /** 비교군 평균. null = 데이터 미제공. */
        ComparisonGroup average,
        /** 시험 합격자 비교군. null = 데이터 미제공. */
        ComparisonGroup examPassers
) {

    /** 내 과목별·총 공부량. */
    public record MyStats(
            /** 총 공부 시간(분). 스텁: 0. */
            int totalMinutes,
            /** 과목별 항목 목록. 스텁: 빈 배열. */
            List<CategoryStatItem> subjects
    ) {}

    /** 비교군(평균 또는 합격자)의 과목별·총 공부량. null = 데이터 미제공. */
    public record ComparisonGroup(
            /** 총 공부 시간(분). */
            int totalMinutes,
            /** 과목별 항목 목록. */
            List<CategoryStatItem> subjects
    ) {}
}
