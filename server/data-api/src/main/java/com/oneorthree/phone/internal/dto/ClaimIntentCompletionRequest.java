package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * claim 의도 완료 보고.
 *
 * @param leaseToken 선점 때 받은 펜싱 토큰. 다르거나 낡았으면 409 다 — 리스를 잃은 실행자의 뒤늦은
 *                   완료 보고가 남이 진행 중인 재개를 끝난 것으로 덮는 것을 막는다
 */
public record ClaimIntentCompletionRequest(@NotNull UUID leaseToken, String terminalCode) {
}
