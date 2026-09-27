package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 신고 메일 intent 선점 요청. fingerprint는 공개 요청의 정규화된 의미 전체를 묶는다. */
public record ReportDeliveryClaimRequest(
        @NotBlank @Pattern(regexp = "[0-9a-f]{64}") String fingerprint,
        @NotBlank @Size(max = 64) String caseId,
        @NotNull Boolean blockRequested) {
}
