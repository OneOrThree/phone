package com.oneorthree.business.api.dto;

import java.time.Instant;
import java.util.UUID;

/** 신고자에게 반환하는 접수 결과. 상류 내부 DTO를 공개 계약으로 노출하지 않는다. */
public record ReportReceipt(UUID reportId, Instant receivedAt) {
}
