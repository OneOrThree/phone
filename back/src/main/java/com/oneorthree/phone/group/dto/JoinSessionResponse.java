package com.oneorthree.phone.group.dto;

import lombok.Builder;
import lombok.Getter;

import java.time.LocalDate;
import java.util.UUID;

/**
 * 신 참여 API 단건 응답(GROMO-1408, 계약 §1) — {@code join}(오늘 회차)·{@code join-next}(다음 활성일)
 * 공용. {@code balanceAfter} 는 차감 반영 후 잔액이다 — 앱이 재조회 없이 잔액 표기를 갱신한다.
 */
@Getter
@Builder
public class JoinSessionResponse {

    private final UUID sessionId;
    private final LocalDate sessionDate;
    private final int stake;
    private final int balanceAfter;
}
