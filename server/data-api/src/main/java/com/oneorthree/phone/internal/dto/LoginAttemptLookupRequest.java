package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * 제공자 교환 <b>전</b> 내구 시도 조회 (계정 LLD §3-1 · §3-2).
 *
 * <p>자격 원문이 아니라 Business 가 계산한 keyed digest 만 온다. 그래서 Data 는 원 code/credential 을
 * 알지 못하고, 이 표면 하나가 유출돼도 자격이 유출되지 않는다.
 *
 * <p>{@code attemptId} 만으로는 아무것도 돌려주지 않는다 — LLD §3 이 「{@code X-Login-Attempt-Id} 나
 * digest 만 받는 공개 복구 API 를 만들지 않는다」고 금지한다. digest 가 맞아야 결과가 나온다.
 */
public record LoginAttemptLookupRequest(
        @NotNull UUID attemptId,
        @NotBlank @Size(max = 64) String digestKeyId,
        @NotBlank @Size(max = 64) String credentialDigest) {
}
