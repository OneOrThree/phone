package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/** 신고 전달 상태. COMPLETED면 receipt, PENDING이면 현재 작업자의 lease와 고정 snapshot을 돌려준다. */
public record ReportDeliveryView(
        String status,
        String caseId,
        UUID confirmationToken,
        UUID leaseToken,
        UUID authorId,
        String subject,
        String body,
        boolean blockRequested,
        Boolean blocked) {
}
