package com.oneorthree.business.report;

import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.Store;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.search.HeaderTerm;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Properties;

/** Gmail SMTP 발송 뒤 IMAP 검색으로 실제 운영 메일함 접수를 확인한다. */
final class GmailReportMailGateway implements ReportMailGateway {

    private static final String CASE_HEADER = "X-Gromo-Case-Id";
    private static final String REQUEST_HEADER = "X-Gromo-Request-Id";
    private static final String CONFIRMATION_HEADER = "X-Gromo-Delivery-Token";
    private static final Duration POLL_INTERVAL = Duration.ofMillis(400);

    private final ReportMailProperties properties;
    private final JavaMailSenderImpl sender;
    private final Clock clock;

    GmailReportMailGateway(ReportMailProperties properties) {
        this(properties, Clock.systemUTC());
    }

    GmailReportMailGateway(ReportMailProperties properties, Clock clock) {
        this.properties = properties;
        this.clock = clock;
        validate(properties);
        this.sender = sender(properties);
    }

    @Override
    public void deliverAndConfirm(ReportMail mail) {
        deliverAndConfirm(mail, () -> { });
    }

    @Override
    public void deliverAndConfirm(ReportMail mail, Runnable leaseHeartbeat) {
        Properties sessionProperties = new Properties();
        sessionProperties.setProperty("mail.store.protocol", "imaps");
        sessionProperties.setProperty("mail.imaps.connectiontimeout", "3000");
        sessionProperties.setProperty("mail.imaps.timeout", "3000");
        sessionProperties.setProperty("mail.imaps.writetimeout", "3000");
        sessionProperties.setProperty("mail.imaps.ssl.checkserveridentity", "true");
        try (Store store = Session.getInstance(sessionProperties).getStore("imaps")) {
            store.connect(properties.getImapHost(), properties.getUsername(), properties.getAppPassword());
            try (Folder inbox = store.getFolder("INBOX")) {
                inbox.open(Folder.READ_ONLY);
                leaseHeartbeat.run();
                if (inMailbox(inbox, mail.confirmationToken())) {
                    return;
                }
                leaseHeartbeat.run();
                send(mail);
                Instant deadline = clock.instant().plus(properties.getVerifyTimeout());
                do {
                    leaseHeartbeat.run();
                    if (inMailbox(inbox, mail.confirmationToken())) {
                        return;
                    }
                    pause();
                } while (clock.instant().isBefore(deadline));
            }
        } catch (jakarta.mail.MessagingException e) {
            throw new ReportMailException("운영 메일함을 확인하지 못했습니다.", e);
        }
        throw new ReportMailException("운영 메일함에서 신고 사건을 확인하지 못했습니다.");
    }

    private void pause() {
        try {
            Thread.sleep(POLL_INTERVAL.toMillis());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ReportMailException("신고 메일 확인이 중단되었습니다.", e);
        }
    }

    private static boolean inMailbox(Folder inbox, String confirmationToken) {
        try {
            // 열린 IMAP 연결에서 SEARCH 만 반복한다. 매 poll 마다 재로그인하지 않아 Gmail 연결 쿼터를 지킨다.
            return inbox.search(new HeaderTerm(CONFIRMATION_HEADER, confirmationToken)).length > 0;
        } catch (jakarta.mail.MessagingException e) {
            throw new ReportMailException("운영 메일함을 확인하지 못했습니다.", e);
        }
    }

    private void send(ReportMail mail) {
        try {
            MimeMessage message = sender.createMimeMessage();
            message.setFrom(new InternetAddress(properties.getUsername()));
            message.setRecipient(Message.RecipientType.TO, new InternetAddress(properties.getRecipient()));
            message.setSubject(mail.subject(), StandardCharsets.UTF_8.name());
            message.setText(mail.body(), StandardCharsets.UTF_8.name());
            message.setHeader(CASE_HEADER, mail.caseId());
            message.setHeader(REQUEST_HEADER, mail.requestId());
            message.setHeader(CONFIRMATION_HEADER, mail.confirmationToken());
            sender.send(message);
        } catch (RuntimeException | jakarta.mail.MessagingException e) {
            throw new ReportMailException("신고 메일을 보내지 못했습니다.", e);
        }
    }

    private static JavaMailSenderImpl sender(ReportMailProperties properties) {
        JavaMailSenderImpl result = new JavaMailSenderImpl();
        result.setHost(properties.getSmtpHost());
        result.setPort(properties.getSmtpPort());
        result.setUsername(properties.getUsername());
        result.setPassword(properties.getAppPassword());
        Properties mail = result.getJavaMailProperties();
        mail.setProperty("mail.smtp.auth", "true");
        mail.setProperty("mail.smtp.starttls.enable", "true");
        mail.setProperty("mail.smtp.starttls.required", "true");
        mail.setProperty("mail.smtp.ssl.checkserveridentity", "true");
        mail.setProperty("mail.smtp.connectiontimeout", "3000");
        mail.setProperty("mail.smtp.timeout", "5000");
        mail.setProperty("mail.smtp.writetimeout", "5000");
        return result;
    }

    private static void validate(ReportMailProperties properties) {
        if (blank(properties.getUsername()) || blank(properties.getAppPassword())
                || blank(properties.getRecipient()) || blank(properties.getImapHost())) {
            throw new IllegalStateException("REPORT_MAIL 설정이 완전하지 않습니다.");
        }
        properties.setUsername(properties.getUsername().trim());
        properties.setRecipient(properties.getRecipient().trim());
        if (!properties.getUsername().equalsIgnoreCase(properties.getRecipient())) {
            throw new IllegalStateException("REPORT_MAIL_USERNAME과 REPORT_MAIL_RECIPIENT는 같은 메일함이어야 합니다.");
        }
        if (properties.getVerifyTimeout().isNegative() || properties.getVerifyTimeout().isZero()
                || properties.getVerifyTimeout().compareTo(Duration.ofMinutes(1)) > 0) {
            throw new IllegalStateException("REPORT_MAIL_VERIFY_TIMEOUT은 0초 초과 60초 이하여야 합니다.");
        }
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
