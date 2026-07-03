package com.oneorthree.phone.league.dto;

import java.time.Instant;

// 주간 리그 배치 실행 요약
public record LeagueBatchSummaryResponse(
        Instant weekStartAt,
        int endedArenaCount,
        int settledMemberCount,
        int createdArenaCount,
        long elapsedMillis
) {
}
