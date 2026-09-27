package com.oneorthree.business.report;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatCode;

/** 운영 계정 자격을 명시적으로 제공했을 때만 Gmail SMTP 발송과 IMAP 수신 확인을 함께 검사한다. */
@EnabledIfEnvironmentVariable(named = "REPORT_MAIL_LIVE_TEST", matches = "true")
class GmailReportMailGatewayLiveTest {

    @Test
    void sendsAndFindsMessageInOperationsInbox() {
        String username = required("REPORT_MAIL_USERNAME");
        String caseId = "GR-LIVE-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();

        ReportMailProperties properties = new ReportMailProperties();
        properties.setUsername(username);
        properties.setAppPassword(required("REPORT_MAIL_APP_PASSWORD"));
        properties.setRecipient(System.getenv().getOrDefault(
                "REPORT_MAIL_RECIPIENT", "nappaegonoljima@gmail.com"));
        properties.setVerifyTimeout(Duration.ofSeconds(30));

        GmailReportMailGateway gateway = new GmailReportMailGateway(properties);
        ReportMailGateway.ReportMail message = new ReportMailGateway.ReportMail(
                caseId,
                UUID.randomUUID().toString(),
                UUID.randomUUID().toString(),
                "[GROMO 신고 메일 연결 테스트] " + caseId,
                "자동 연결 테스트입니다.\ncreatedAt: " + Instant.now());

        assertThatCode(() -> gateway.deliverAndConfirm(message)).doesNotThrowAnyException();
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " 환경변수가 필요합니다.");
        }
        return value;
    }
}
