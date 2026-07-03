package com.oneorthree.phone.stats.dto;

import java.util.UUID;

/**
 * 과목(태그)별 공부량 항목. ComparisonStatsResponse에서 재사용. (GROMO-525)
 *
 * @param tagId         태그 UUID. null = 미분류.
 * @param tagName       태그명. null = 미분류.
 * @param totalMinutes  이 태그의 누적 공부 시간(분).
 */
public record CategoryStatItem(
        UUID tagId,
        String tagName,
        int totalMinutes
) {}
