package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.membership.CurrentMembershipDecisionCache;
import com.oneorthree.realtime.membership.CurrentMembershipVerifier;
import io.micrometer.core.instrument.MeterRegistry;
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
    /** 사건 수신(evict)이 모드와 무관하게 부르므로 항상 만든다 — OFF 에서는 비어 있다. */
    @Bean
    public CurrentMembershipDecisionCache currentMembershipDecisionCache(RealtimeAuthorizationProperties properties,
            MeterRegistry registry) {
        return new CurrentMembershipDecisionCache(properties, registry);
    }

    @Bean
    @ConditionalOnProperty(prefix = RealtimeAuthorizationProperties.PREFIX, name = "enabled", havingValue = "true")
    public RealtimeMembershipAuthorizationClient realtimeMembershipAuthorizationClient(
            RealtimeAuthorizationProperties properties, MeterRegistry registry) {
        return new RealtimeMembershipAuthorizationClient(properties, registry);
    }

    @Bean
    @ConditionalOnProperty(prefix = RealtimeAuthorizationProperties.PREFIX, name = "enabled", havingValue = "true")
    public CurrentMembershipVerifier currentMembershipVerifier(JwtValidator jwt,
            RealtimeMembershipAuthorizationClient client, Clock clock,
            CurrentMembershipDecisionCache cache) {
        return new CurrentMembershipVerifier(jwt, client, clock, cache);
    }
}
