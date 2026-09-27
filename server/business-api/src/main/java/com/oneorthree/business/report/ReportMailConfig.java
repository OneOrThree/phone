package com.oneorthree.business.report;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(ReportMailProperties.class)
public class ReportMailConfig {

    @Bean
    @ConditionalOnProperty(prefix = "business.report-mail", name = "enabled", havingValue = "true")
    ReportMailGateway gmailReportMailGateway(ReportMailProperties properties) {
        return new GmailReportMailGateway(properties);
    }

    @Bean
    @ConditionalOnMissingBean(ReportMailGateway.class)
    ReportMailGateway unavailableReportMailGateway() {
        return mail -> {
            throw new ReportMailException("신고 메일 전송이 설정되지 않았습니다.");
        };
    }
}
