package com.oneorthree.phone.report.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/** 내용은 신고자의 진술이다. 서버가 검증한 원문이나 위반 확정으로 취급하지 않는다. */
public record ReportRequest(
        @NotNull UUID requestId,
        @NotBlank @Size(max = 32) String targetType,
        UUID targetId,
        UUID targetUserId,
        @NotBlank @Size(max = 32) String reason,
        @NotBlank @Size(max = 2000) String details,
        @Size(max = 5000) String submittedText) {
}
