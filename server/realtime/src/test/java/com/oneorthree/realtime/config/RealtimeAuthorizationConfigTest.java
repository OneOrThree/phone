package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.membership.CurrentMembershipVerifier;
import com.oneorthree.realtime.membership.client.RealtimeMembershipAuthorizationClient;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.time.Clock;

import static org.assertj.core.api.Assertions.assertThat;

/** 기본 비활성은 기존 배포에 새 서비스 자격을 요구하지 않으며 활성화 시에만 필수 설정을 검사한다. */
class RealtimeAuthorizationConfigTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(RealtimeAuthorizationConfig.class)
            .withBean(Clock.class, Clock::systemUTC)
            .withBean(JwtValidator.class, () -> new JwtValidator(
                    "test-secret-key-that-is-at-least-256-bits-long-padded-for-hmac-sha256"));

    @Test
    void defaultOffRequiresNoNewTokenAndProvidesNoCurrentVerifier() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).doesNotHaveBean(CurrentMembershipVerifier.class);
            assertThat(context).doesNotHaveBean(RealtimeMembershipAuthorizationClient.class);
        });
    }

    @Test
    void enabledWithoutServiceSettingsFailsAtStartup() {
        runner.withPropertyValues("realtime.membership-authorization.enabled=true").run(context ->
                assertThat(context).hasFailed());
    }

    @Test
    void enabledWiresCurrentVerifierOnlyWithExplicitServiceSettings() {
        runner.withPropertyValues("realtime.membership-authorization.enabled=true",
                "realtime.membership-authorization.base-url=http://127.0.0.1:12345",
                "realtime.membership-authorization.service-token=test-config-only-service").run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(CurrentMembershipVerifier.class);
                    assertThat(context).hasSingleBean(RealtimeMembershipAuthorizationClient.class);
                });
    }
}
