package com.oneorthree.phone.report.dto;

import java.time.Instant;
import java.util.UUID;

/** 접수 번호·시각만 공개한다. 신고자와 피신고자의 개인정보를 응답에 복제하지 않는다. */
public record ReportReceipt(UUID reportId, Instant receivedAt) {
}
