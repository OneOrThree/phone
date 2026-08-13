package com.oneorthree.phone.group.dto;

import lombok.Builder;
import lombok.Getter;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * {@code join-week} 응답(GROMO-1408, 계약 §1) — 이번 요청으로 <b>실제 참가된</b> 회차 목록과 총
 * 차감액. 이미 참가했거나 마감·자격 가드로 스킵된 오늘(N39)은 {@code joined} 에 실리지 않는다 —
 * 전부 스킵이면 빈 목록·{@code totalStake} 0 이다(부분 예약 후 재호출이 정상 동선이라 에러가 아니다).
 */
@Getter
@Builder
public class JoinWeekResponse {

    private final List<JoinedSession> joined;
    private final int totalStake;
    private final int balanceAfter;

    /** 참가된 회차 한 건 — 날짜 오름차순으로 실린다. */
    @Getter
    @Builder
    public static class JoinedSession {

        private final UUID sessionId;
        private final LocalDate sessionDate;
    }
}
