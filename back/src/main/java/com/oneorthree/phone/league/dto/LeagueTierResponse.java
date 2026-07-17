package com.oneorthree.phone.league.dto;

import java.time.Instant;

/**
 * 내 현재 리그·티어 응답.
 * tierLevel 은 {@code users.tier_level}(단일 SoT)을 그대로 노출하고, weekStartAt 은 KST 기준 주차 시작 시각이다.
 */
public record LeagueTierResponse(
        boolean assigned,
        Integer tierLevel,
        Instant weekStartAt,
        String badgeId
) {
}
