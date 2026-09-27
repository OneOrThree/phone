package com.oneorthree.business.report;

public interface ReportMailGateway {
    void deliverAndConfirm(ReportMail mail);

    default void deliverAndConfirm(ReportMail mail, Runnable leaseHeartbeat) {
        leaseHeartbeat.run();
        deliverAndConfirm(mail);
    }

    /** 이미 발송됐을 수 있는 confirmation token만 조회하며 새 메일은 절대 보내지 않는다. */
    default boolean confirmOnly(String confirmationToken, Runnable leaseHeartbeat) {
        throw new ReportMailException("신고 메일 확인 기능을 사용할 수 없습니다.");
    }

    record ReportMail(String caseId, String requestId, String confirmationToken, String subject, String body) {
    }
}
