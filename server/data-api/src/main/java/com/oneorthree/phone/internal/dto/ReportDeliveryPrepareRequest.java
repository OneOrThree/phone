package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/** 최초 서버 증거 검증 뒤 고정할 메일 snapshot. */
public record ReportDeliveryPrepareRequest(
        @NotNull UUID leaseToken,
        @NotNull UUID authorId,
        @NotBlank @Size(max = 255) String subject,
        @NotBlank @Size(max = 20_000) String body) {
}
