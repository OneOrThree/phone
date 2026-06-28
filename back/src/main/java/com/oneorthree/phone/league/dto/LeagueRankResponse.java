package com.oneorthree.phone.league.dto;

public record LeagueRankResponse(
        boolean assigned,
        Integer myRank,
        int totalFocusMinutes,
        String result
) {
}
