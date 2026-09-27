package com.oneorthree.business.report;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@Getter
@Setter
@ConfigurationProperties(prefix = "business.report-mail")
public class ReportMailProperties {
    private boolean enabled;
    private String recipient = "nappaegonoljima@gmail.com";
    private String username;
    private String appPassword;
    private String smtpHost = "smtp.gmail.com";
    private int smtpPort = 587;
    private String imapHost = "imap.gmail.com";
    private Duration verifyTimeout = Duration.ofSeconds(10);
}
