package com.oneorthree.phone.league.dto;

import java.util.UUID;

/**
 * 리그 랭킹 멤버 1건 응답.
 * tierLevel 은 멤버별 실제 티어(league_arena_users.tier_level) — 전역(교차 티어) 랭킹에서
 * 앱이 내 티어를 전원에게 임시 부여하던 문제 해소 (GROMO-748).
 */
public record LeagueMemberResponse(
        int rank,
        UUID userId,
        String nickname,
        int tierLevel,
        int totalFocusSeconds,
        String result,
        boolean isPinned
) {
}
