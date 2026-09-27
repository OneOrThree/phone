package com.oneorthree.business.report;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GmailReportMailGatewayTest {

    @Test
    void rejectsRecipientThatCannotBeConfirmedThroughConfiguredInbox() {
        ReportMailProperties properties = properties("sender@gmail.com", "operations@gmail.com");

        assertThatThrownBy(() -> new GmailReportMailGateway(properties))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("같은 메일함");
    }

    @Test
    void acceptsSameInboxIgnoringEmailCaseAndOuterWhitespace() {
        ReportMailProperties properties = properties(" Operations@Gmail.com ", "operations@gmail.com");

        assertThatCode(() -> new GmailReportMailGateway(properties)).doesNotThrowAnyException();
    }

    private static ReportMailProperties properties(String username, String recipient) {
        ReportMailProperties properties = new ReportMailProperties();
        properties.setUsername(username);
        properties.setAppPassword("app-password");
        properties.setRecipient(recipient);
        properties.setVerifyTimeout(Duration.ofSeconds(10));
        return properties;
    }
}
