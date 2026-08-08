package com.oneorthree.phone.league.domain;

import java.util.UUID;

/**
 * 활성 유저의 주간 집중 시간 기반 전역 랭킹 조회 행.
 *
 * <p>{@code tierLevel} 은 조회 시점 스냅샷 — 랭킹/알림 표시용이다. 정산({@code LeagueUserSettler})은
 * 이 스냅샷이 락 대기 중의 커밋을 놓칠 수 있어 tierLevel 을 쓰지 않고, 락으로 잡은 유저 행을
 * 정본으로 다시 읽는다 (GROMO-1239).
 */
public record LeagueRankingRow(
        UUID userId,
        String nickname,
        int tierLevel,
        int totalFocusSeconds
) {
}
