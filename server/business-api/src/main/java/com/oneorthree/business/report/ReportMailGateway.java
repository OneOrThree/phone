package com.oneorthree.business.report;

public interface ReportMailGateway {
    void deliverAndConfirm(ReportMail mail);

    default void deliverAndConfirm(ReportMail mail, Runnable leaseHeartbeat) {
        leaseHeartbeat.run();
        deliverAndConfirm(mail);
    }

    record ReportMail(String caseId, String requestId, String confirmationToken, String subject, String body) {
    }
}
