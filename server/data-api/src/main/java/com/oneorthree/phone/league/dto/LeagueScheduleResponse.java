package com.oneorthree.phone.league.dto;

import java.time.Instant;

/**
 * 리그 마감 스케줄 응답 DTO.
 *
 * <p>nextResetAt: 다음 리셋(다음 월요일 00:00 KST) 시각</p>
 * <p>remainingSeconds: 지금부터 nextResetAt까지 남은 초(카운트다운, 항상 ≥ 0)</p>
 */
public record LeagueScheduleResponse(
        Instant nextResetAt,
        long remainingSeconds
) {
}
