package com.oneorthree.phone.internal.dto;

import com.oneorthree.phone.report.dto.ReportRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import java.util.UUID;

/** 세션 증거는 Business가 검증한 AT에서만 가져온다. 앱 입력과 분리한다. */
public record ReportSubmissionRequest(@NotNull UUID sessionId,
                                      @NotNull @PositiveOrZero Long authGeneration,
                                      @NotNull @Valid ReportRequest report) {
}
