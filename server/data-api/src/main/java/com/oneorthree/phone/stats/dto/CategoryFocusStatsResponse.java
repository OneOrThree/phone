package com.oneorthree.phone.stats.dto;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 카테고리(태그)별 집중 통계 조회 응답 (GROMO-524).
 * 비율(%) 계산은 클라이언트 담당 — 서버는 totalFocusMinutes 합계만 제공.
 */
public record CategoryFocusStatsResponse(
        /** 조회 기간 종류 (DAY | WEEK | MONTH). */
        StatsPeriod period,
        /** 구간 시작일 (UTC). */
        LocalDate from,
        /** 구간 종료일 (UTC, = 오늘). */
        LocalDate to,
        /** 전체 합계(분) — 클라이언트 비율 계산용 분모. */
        int totalFocusMinutes,
        /** 태그별 항목 목록 (totalFocusMinutes 내림차순). */
        List<CategoryItem> items
) {

    /**
     * 태그별 집중 시간 항목.
     * tagId·tagName 이 null 이면 '미분류' (태그 없는 세션 + 소프트딜리트 태그 세션).
     */
    public record CategoryItem(
            /** 태그 UUID. null = 미분류. */
            UUID tagId,
            /** 태그명. null = 미분류. */
            String tagName,
            /** 이 태그의 누적 집중 시간(분). */
            int totalFocusMinutes
    ) {}
}
