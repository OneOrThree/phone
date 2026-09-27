package com.oneorthree.business.report;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Clock;
import java.util.concurrent.Semaphore;

import static org.assertj.core.api.Assertions.assertThat;
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

    @Test
    void rejectsExcessDeliveryImmediatelyWithoutStartingLeaseOrNetworkWork() {
        ReportMailProperties properties = properties("operations@gmail.com", "operations@gmail.com");
        GmailReportMailGateway gateway = new GmailReportMailGateway(properties, Clock.systemUTC(), new Semaphore(0));
        boolean[] heartbeat = {false};

        assertThatThrownBy(() -> gateway.deliverAndConfirm(
                new ReportMailGateway.ReportMail("case", "request", "token", "subject", "body"),
                () -> heartbeat[0] = true))
                .isInstanceOfSatisfying(ReportMailException.class,
                        error -> assertThat(error.deliveryMayHaveOccurred()).isFalse())
                .hasMessageContaining("처리량");
        assertThat(heartbeat[0]).isFalse();

        assertThatThrownBy(() -> gateway.confirmOnly("token", () -> heartbeat[0] = true))
                .isInstanceOfSatisfying(ReportMailException.class,
                        error -> assertThat(error.deliveryMayHaveOccurred()).isFalse())
                .hasMessageContaining("처리량");
        assertThat(heartbeat[0]).isFalse();
    }

    @Test
    void rejectsBulkheadSizeThatCouldConsumeTooManyRequestWorkers() {
        ReportMailProperties properties = properties("operations@gmail.com", "operations@gmail.com");
        properties.setMaxConcurrent(5);

        assertThatThrownBy(() -> new GmailReportMailGateway(properties))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("1 이상 4 이하");
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
