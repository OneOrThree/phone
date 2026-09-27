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
import java.util.concurrent.Semaphore;

/** Gmail SMTP 발송 뒤 IMAP 검색으로 실제 운영 메일함 접수를 확인한다. */
final class GmailReportMailGateway implements ReportMailGateway {

    private static final String CASE_HEADER = "X-Gromo-Case-Id";
    private static final String REQUEST_HEADER = "X-Gromo-Request-Id";
    private static final String CONFIRMATION_HEADER = "X-Gromo-Delivery-Token";
    private static final Duration POLL_INTERVAL = Duration.ofMillis(400);

    private final ReportMailProperties properties;
    private final JavaMailSenderImpl sender;
    private final Clock clock;
    private final Semaphore permits;

    GmailReportMailGateway(ReportMailProperties properties) {
        this(properties, Clock.systemUTC());
    }

    GmailReportMailGateway(ReportMailProperties properties, Clock clock) {
        this(properties, clock, new Semaphore(maxConcurrent(properties), true));
    }

    GmailReportMailGateway(ReportMailProperties properties, Clock clock, Semaphore permits) {
        this.properties = properties;
        this.clock = clock;
        validate(properties);
        this.sender = sender(properties);
        this.permits = permits;
    }

    @Override
    public void deliverAndConfirm(ReportMail mail) {
        deliverAndConfirm(mail, () -> { });
    }

    @Override
    public void deliverAndConfirm(ReportMail mail, Runnable leaseHeartbeat) {
        if (!permits.tryAcquire()) {
            throw new ReportMailException("신고 메일 처리량이 가득 찼습니다. 잠시 뒤 다시 시도해 주세요.");
        }
        try {
            deliverAndConfirmWithinPermit(mail, leaseHeartbeat);
        } finally {
            permits.release();
        }
    }

    @Override
    public boolean confirmOnly(String confirmationToken, Runnable leaseHeartbeat) {
        if (!permits.tryAcquire()) {
            throw new ReportMailException("신고 메일 처리량이 가득 찼습니다. 잠시 뒤 다시 시도해 주세요.");
        }
        try {
            return confirmOnlyWithinPermit(confirmationToken, leaseHeartbeat);
        } finally {
            permits.release();
        }
    }

    private void deliverAndConfirmWithinPermit(ReportMail mail, Runnable leaseHeartbeat) {
        // lease는 5분이고 이 작업은 최대 60초 확인 + 제한된 연결 timeout만 사용한다.
        // IMAP 400ms poll마다 DB lease를 갱신하지 않고 외부 side effect 시작 전에 한 번만 연장한다.
        leaseHeartbeat.run();
        Properties sessionProperties = new Properties();
        sessionProperties.setProperty("mail.store.protocol", "imaps");
        sessionProperties.setProperty("mail.imaps.connectiontimeout", "3000");
        sessionProperties.setProperty("mail.imaps.timeout", "3000");
        sessionProperties.setProperty("mail.imaps.writetimeout", "3000");
        sessionProperties.setProperty("mail.imaps.ssl.checkserveridentity", "true");
        boolean deliveryAttempted = false;
        try (Store store = Session.getInstance(sessionProperties).getStore("imaps")) {
            store.connect(properties.getImapHost(), properties.getUsername(), properties.getAppPassword());
            try (Folder inbox = store.getFolder("INBOX")) {
                inbox.open(Folder.READ_ONLY);
                if (inMailbox(inbox, mail.confirmationToken(), false)) {
                    return;
                }
                deliveryAttempted = true;
                send(mail);
                Instant deadline = clock.instant().plus(properties.getVerifyTimeout());
                do {
                    if (inMailbox(inbox, mail.confirmationToken(), true)) {
                        return;
                    }
                    pause(true);
                } while (clock.instant().isBefore(deadline));
            }
        } catch (jakarta.mail.MessagingException e) {
            throw new ReportMailException("운영 메일함을 확인하지 못했습니다.", e, deliveryAttempted);
        }
        throw new ReportMailException("운영 메일함에서 신고 사건을 확인하지 못했습니다.", true);
    }

    private boolean confirmOnlyWithinPermit(String confirmationToken, Runnable leaseHeartbeat) {
        leaseHeartbeat.run();
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
                Instant deadline = clock.instant().plus(properties.getVerifyTimeout());
                do {
                    if (inMailbox(inbox, confirmationToken, false)) {
                        return true;
                    }
                    pause(false);
                } while (clock.instant().isBefore(deadline));
                return false;
            }
        } catch (jakarta.mail.MessagingException e) {
            throw new ReportMailException("운영 메일함을 확인하지 못했습니다.", e);
        }
    }

    private void pause(boolean deliveryMayHaveOccurred) {
        try {
            Thread.sleep(POLL_INTERVAL.toMillis());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ReportMailException("신고 메일 확인이 중단되었습니다.", e, deliveryMayHaveOccurred);
        }
    }

    private static boolean inMailbox(Folder inbox, String confirmationToken, boolean deliveryMayHaveOccurred) {
        try {
            // 열린 IMAP 연결에서 SEARCH 만 반복한다. 매 poll 마다 재로그인하지 않아 Gmail 연결 쿼터를 지킨다.
            return inbox.search(new HeaderTerm(CONFIRMATION_HEADER, confirmationToken)).length > 0;
        } catch (jakarta.mail.MessagingException e) {
            throw new ReportMailException("운영 메일함을 확인하지 못했습니다.", e, deliveryMayHaveOccurred);
        }
    }

    private void send(ReportMail mail) {
        MimeMessage message;
        try {
            message = sender.createMimeMessage();
            message.setFrom(new InternetAddress(properties.getUsername()));
            message.setRecipient(Message.RecipientType.TO, new InternetAddress(properties.getRecipient()));
            message.setSubject(mail.subject(), StandardCharsets.UTF_8.name());
            message.setText(mail.body(), StandardCharsets.UTF_8.name());
            message.setHeader(CASE_HEADER, mail.caseId());
            message.setHeader(REQUEST_HEADER, mail.requestId());
            message.setHeader(CONFIRMATION_HEADER, mail.confirmationToken());
        } catch (RuntimeException | jakarta.mail.MessagingException e) {
            throw new ReportMailException("신고 메일을 만들지 못했습니다.", e);
        }
        try {
            sender.send(message);
        } catch (RuntimeException e) {
            // SMTP 예외는 서버가 DATA를 받은 뒤 응답만 유실된 경우도 있어 발송 여부가 불확실하다.
            throw new ReportMailException("신고 메일을 보내지 못했습니다.", e, true);
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
        maxConcurrent(properties);
    }

    private static int maxConcurrent(ReportMailProperties properties) {
        int value = properties.getMaxConcurrent();
        if (value <= 0 || value > 4) {
            throw new IllegalStateException("REPORT_MAIL_MAX_CONCURRENT는 1 이상 4 이하여야 합니다.");
        }
        return value;
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
