package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * 잠정 claim 확정 요청 (A22 ㋟ · ⓚ).
 *
 * @param claimId    링크가 기록한 잠정 claim 의 id
 * @param slug       링크 식별자
 * @param capability 링크 서버가 서명한 자격 — Data 가 <b>커밋 안에서</b> 현재 멤버십과 대조한다
 */
public record ClaimConfirmationRequest(
        @NotNull UUID claimId,
        @NotBlank @Size(max = 12) String slug,
        @NotBlank String capability) {
}
