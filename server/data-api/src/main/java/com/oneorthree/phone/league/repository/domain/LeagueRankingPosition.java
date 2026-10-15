package com.oneorthree.phone.league.repository.domain;

/** 전역 정렬에서 한 유저의 순위와 응답 매핑에 필요한 주간 집계 값. */
public record LeagueRankingPosition(
        int rank,
        int tierLevel,
        int totalFocusSeconds
) {
}
