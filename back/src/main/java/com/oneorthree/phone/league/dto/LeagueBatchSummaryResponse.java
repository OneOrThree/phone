package com.oneorthree.phone.league.dto;

import java.time.Instant;

// 주간 리그 배치 실행 요약 (GROMO-1218 건별 트랜잭션 전환 후) —
// skippedMemberCount: 집계 후 탈퇴가 먼저 커밋돼 건너뛴 유저 수(정상 흐름 — 의미 불변),
// alreadySettledMemberCount: 이 주차 완료 마커가 이미 있어 건너뛴 유저 수(GROMO-1239 재실행 멱등 —
//   정상 흐름. 기본 최초 실행에서는 항상 0). 더 늦은 주차가 이미 정산돼 과거 주차 소급을 막은
//   SKIPPED_SUPERSEDED 도 여기에 접힌다 — 구분은 settler 의 "소급 금지" 로그로,
// failedMemberCount: 건별 트랜잭션이 예외로 롤백된 유저 수(비정상 — 실패 요약 로그로 추적),
// createdArenaCount: 이번 실행이 만든 anchor 수 — run=1, resume=0(재개는 회전하지 않는다)
public record LeagueBatchSummaryResponse(
        Instant weekStartAt,
        int endedArenaCount,
        int settledMemberCount,
        int skippedMemberCount,
        int alreadySettledMemberCount,
        int failedMemberCount,
        int createdArenaCount,
        long elapsedMillis
) {
}
