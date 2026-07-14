package com.oneorthree.phone.league.domain;

import java.util.UUID;

/** 활성 유저의 주간 집중 시간 기반 전역 랭킹 조회 행. */
public record LeagueRankingRow(
        UUID userId,
        String nickname,
        int tierLevel,
        int totalFocusSeconds
) {
}
