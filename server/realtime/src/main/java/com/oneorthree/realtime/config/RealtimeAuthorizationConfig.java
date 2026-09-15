package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.membership.CurrentMembershipVerifier;
import com.oneorthree.realtime.membership.client.RealtimeMembershipAuthorizationClient;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

/** OFF에서는 HTTP client나 새 인증 관문을 생성하지 않는다. */
@Configuration
@EnableConfigurationProperties(RealtimeAuthorizationProperties.class)
public class RealtimeAuthorizationConfig {
    @Bean
    @ConditionalOnProperty(prefix = RealtimeAuthorizationProperties.PREFIX, name = "enabled", havingValue = "true")
    public RealtimeMembershipAuthorizationClient realtimeMembershipAuthorizationClient(
            RealtimeAuthorizationProperties properties) {
        return new RealtimeMembershipAuthorizationClient(properties);
    }

    @Bean
    @ConditionalOnProperty(prefix = RealtimeAuthorizationProperties.PREFIX, name = "enabled", havingValue = "true")
    public CurrentMembershipVerifier currentMembershipVerifier(JwtValidator jwt,
            RealtimeMembershipAuthorizationClient client, Clock clock) {
        return new CurrentMembershipVerifier(jwt, client, clock);
    }
}
