package com.oneorthree.realtime.config;

import com.oneorthree.realtime.auth.JwtValidator;
import com.oneorthree.realtime.membership.CurrentMembershipVerifier;
import com.oneorthree.realtime.membership.client.RealtimeMembershipAuthorizationClient;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Clock;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** 기본 비활성은 기존 배포에 새 서비스 자격을 요구하지 않으며 활성화 시에만 필수 설정을 검사한다. */
class RealtimeAuthorizationConfigTest {
    /** Realtime client 스위치. */
    private static final String CLIENT_ENABLED_ENV = "REALTIME_AUTHORIZATION_CLIENT_ENABLED";
    /** Data 제공자 스위치(data-api application-realtime-authorization.yml). 공유 env에 함께 있을 수 있다. */
    private static final String DATA_PROVIDER_ENABLED_ENV = "REALTIME_MEMBERSHIP_AUTHORIZATION_ENABLED";

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(RealtimeAuthorizationConfig.class)
            .withBean(Clock.class, Clock::systemUTC)
            .withBean(JwtValidator.class, () -> new JwtValidator(
                    "test-secret-key-that-is-at-least-256-bits-long-padded-for-hmac-sha256"));

    /**
     * 실제 부팅과 같은 우선순위를 만든다 — 이름이 {@code systemEnvironment}인 env 소스(완화 바인딩 대상)가
     * 실제 {@code application.yml} 위에 있다. 자리표시자 이름만 바꾸는 것으로는 부족하다는 회귀를 여기서 잡는다:
     * env 이름이 속성 키의 완화 형태와 같으면 yml 자리표시자보다 먼저 그 키로 읽힌다.
     */
    private ApplicationContextRunner withEnvironmentOverApplicationYaml(Map<String, Object> environment) {
        return runner.withInitializer(context -> {
            MutablePropertySources sources = context.getEnvironment().getPropertySources();
            sources.replace(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME,
                    new SystemEnvironmentPropertySource(
                            StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME, environment));
            try {
                new YamlPropertySourceLoader().load("application.yml", new ClassPathResource("application.yml"))
                        .forEach(sources::addLast);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        });
    }

    @Test
    void dataProviderSwitchInSharedEnvironmentDoesNotEnableClientEvenWhenClientSwitchIsFalse() {
        withEnvironmentOverApplicationYaml(Map.of(DATA_PROVIDER_ENABLED_ENV, "true", CLIENT_ENABLED_ENV, "false"))
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).doesNotHaveBean(CurrentMembershipVerifier.class);
                    assertThat(context).doesNotHaveBean(RealtimeMembershipAuthorizationClient.class);
                    assertThat(context.getBean(RealtimeAuthorizationProperties.class).isEnabled()).isFalse();
                });
    }

    @Test
    void dataProviderSwitchAloneInSharedEnvironmentDoesNotEnableClient() {
        withEnvironmentOverApplicationYaml(Map.of(DATA_PROVIDER_ENABLED_ENV, "true")).run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).doesNotHaveBean(CurrentMembershipVerifier.class);
            assertThat(context).doesNotHaveBean(RealtimeMembershipAuthorizationClient.class);
        });
    }

    @Test
    void clientSwitchInEnvironmentEnablesClientWithApplicationYamlPlaceholders() {
        withEnvironmentOverApplicationYaml(Map.of(CLIENT_ENABLED_ENV, "true",
                "REALTIME_AUTHORIZATION_DATA_URL", "http://127.0.0.1:12345",
                "SVC_TOKEN_REALTIME_TO_DATA", "test-config-only-service")).run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(CurrentMembershipVerifier.class);
                    assertThat(context).hasSingleBean(RealtimeMembershipAuthorizationClient.class);
                });
    }

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
        runner.withPropertyValues("realtime.authorization-client.enabled=true").run(context ->
                assertThat(context).hasFailed());
    }

    @Test
    void enabledWiresCurrentVerifierOnlyWithExplicitServiceSettings() {
        runner.withPropertyValues("realtime.authorization-client.enabled=true",
                "realtime.authorization-client.base-url=http://127.0.0.1:12345",
                "realtime.authorization-client.service-token=test-config-only-service").run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(CurrentMembershipVerifier.class);
                    assertThat(context).hasSingleBean(RealtimeMembershipAuthorizationClient.class);
                });
    }
}
