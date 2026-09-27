package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/** 메일 접수 확인 뒤 차단 후처리 결과까지 영수증에 고정한다. */
public record ReportDeliveryCompleteRequest(@NotNull UUID leaseToken, boolean blocked) {
}
