package com.oneorthree.business.report;

public interface ReportMailGateway {
    void deliverAndConfirm(ReportMail mail);

    record ReportMail(String caseId, String requestId, String subject, String body) {
    }
}
