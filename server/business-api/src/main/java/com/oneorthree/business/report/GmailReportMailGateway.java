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
        if (inMailbox(mail.caseId())) {
            return;
        }
        send(mail);
        Instant deadline = clock.instant().plus(properties.getVerifyTimeout());
        do {
            if (inMailbox(mail.caseId())) {
                return;
            }
            try {
                Thread.sleep(POLL_INTERVAL.toMillis());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new ReportMailException("신고 메일 확인이 중단되었습니다.", e);
            }
        } while (clock.instant().isBefore(deadline));
        throw new ReportMailException("운영 메일함에서 신고 사건을 확인하지 못했습니다.");
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
            sender.send(message);
        } catch (RuntimeException | jakarta.mail.MessagingException e) {
            throw new ReportMailException("신고 메일을 보내지 못했습니다.", e);
        }
    }

    private boolean inMailbox(String caseId) {
        Properties sessionProperties = new Properties();
        sessionProperties.setProperty("mail.store.protocol", "imaps");
        sessionProperties.setProperty("mail.imaps.connectiontimeout", "3000");
        sessionProperties.setProperty("mail.imaps.timeout", "3000");
        try (Store store = Session.getInstance(sessionProperties).getStore("imaps")) {
            store.connect(properties.getImapHost(), properties.getUsername(), properties.getAppPassword());
            try (Folder inbox = store.getFolder("INBOX")) {
                inbox.open(Folder.READ_ONLY);
                return inbox.search(new HeaderTerm(CASE_HEADER, caseId)).length > 0;
            }
        } catch (jakarta.mail.MessagingException e) {
            throw new ReportMailException("운영 메일함을 확인하지 못했습니다.", e);
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
        if (properties.getVerifyTimeout().isNegative() || properties.getVerifyTimeout().isZero()) {
            throw new IllegalStateException("REPORT_MAIL_VERIFY_TIMEOUT은 양수여야 합니다.");
        }
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
