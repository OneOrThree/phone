package com.oneorthree.phone.league.dto;

/**
 * 진행 중 주차의 내 순위. 아직 리그에 배정되지 않은 유저도 200 으로 받으므로, 순위 필드가 비었는지가 아니라
 * {@code assigned} 가 화면 분기의 기준이다.
 *
 * @param assigned          이번 주차 리그에 배정돼 순위 산정 대상인지
 * @param myRank            전역 주간 순위. 미배정이면 null
 * @param totalFocusSeconds 이번 주차 누적 집중 초. 미배정이면 null
 */
public record LeagueRankResponse(
        boolean assigned,
        Integer myRank,
        Integer totalFocusSeconds
) {
}
