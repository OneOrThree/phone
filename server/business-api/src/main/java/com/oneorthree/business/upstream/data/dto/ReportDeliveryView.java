package com.oneorthree.business.upstream.data.dto;

import java.util.UUID;

public record ReportDeliveryView(
        String status,
        String caseId,
        UUID leaseToken,
        UUID authorId,
        String subject,
        String body,
        boolean blockRequested,
        Boolean blocked) {

    public boolean completed() {
        return "COMPLETED".equals(status);
    }

    public boolean prepared() {
        return authorId != null && subject != null && body != null;
    }

    public boolean emailConfirmed() {
        return "EMAIL_CONFIRMED".equals(status);
    }
}
