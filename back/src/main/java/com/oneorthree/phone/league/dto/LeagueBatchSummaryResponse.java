package com.oneorthree.phone.league.dto;

import java.time.Instant;

// 주간 리그 배치 실행 요약 (GROMO-1218 건별 트랜잭션 전환 후) —
// skippedMemberCount: 집계 후 탈퇴가 먼저 커밋돼 건너뛴 유저 수(정상 흐름),
// failedMemberCount: 건별 트랜잭션이 예외로 롤백된 유저 수(비정상 — 실패 요약 로그로 추적)
public record LeagueBatchSummaryResponse(
        Instant weekStartAt,
        int endedArenaCount,
        int settledMemberCount,
        int skippedMemberCount,
        int failedMemberCount,
        int createdArenaCount,
        long elapsedMillis
) {
}
