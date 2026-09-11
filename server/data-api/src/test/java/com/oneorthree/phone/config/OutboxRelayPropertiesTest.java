package com.oneorthree.phone.config;

import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * relay 설정의 <b>A18 보류 규약</b>과 <b>SSRF 방어</b>를 못 박는다.
 *
 * <p>A18(발행 실패 정책)은 보류다. 그래서 이 기반은 두 가지를 지킨다 — ① 설정이 없으면 <b>꺼져
 * 있다</b>(임의 기본값이 운영 정책이 되지 않는다), ② 켜면 재시도 정책 필수값을 <b>반드시</b> 채우게
 * 한다(빈 채로 켜지면 코드의 기본값이 곧 정책이 된다).
 *
 * <p>목적지는 설정의 허용목록에만 있다. 저장된 payload 가 URL 을 고를 수 있으면 그게 곧 SSRF 구조다.
 */
class OutboxRelayPropertiesTest {

    @Test
    @DisplayName("설정이 하나도 없으면 꺼져 있고, 꺼진 상태는 아무 값도 요구하지 않는다")
    void defaultsToDisabledAndValidatesNothing() {
        OutboxRelayProperties properties = new OutboxRelayProperties();

        assertThat(properties.isEnabled())
                .as("브로커도 위성도 없는 시점에 켜진 채 들어가면 기존 앱 기동이 매 틱 타임아웃을 문다")
                .isFalse();
        assertThatCode(properties::validateWhenEnabled).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("켰는데 재시도 정책이 비면 기동을 거부한다 — 빈 값은 곧 코드의 임의 기본값이 정책이 되는 것")
    void rejectsEnabledWithoutRetryPolicy() {
        OutboxRelayProperties properties = enabledWithoutRetry();

        assertThatThrownBy(properties::validateWhenEnabled)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("initial-backoff");

        properties.getRetry().setInitialBackoff(Duration.ofSeconds(1));
        assertThatThrownBy(properties::validateWhenEnabled)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("max-backoff");

        properties.getRetry().setMaxBackoff(Duration.ofMinutes(5));
        assertThatThrownBy(properties::validateWhenEnabled)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("max-attempts");

        properties.getRetry().setMaxAttempts(10);
        assertThatCode(properties::validateWhenEnabled).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("리스·배치·주기도 필수다 — 이 셋이 비면 선점 자체가 성립하지 않는다")
    void rejectsEnabledWithoutLeaseAndBatchSettings() {
        OutboxRelayProperties properties = fullyConfigured();
        properties.setLeaseDuration(null);
        assertThatThrownBy(properties::validateWhenEnabled).hasMessageContaining("lease-duration");

        properties = fullyConfigured();
        properties.setBatchSize(0);
        assertThatThrownBy(properties::validateWhenEnabled).hasMessageContaining("batch-size");

        properties = fullyConfigured();
        properties.setPollInterval(null);
        assertThatThrownBy(properties::validateWhenEnabled).hasMessageContaining("poll-interval");
    }

    @Test
    @DisplayName("파티션 수를 3 이 아닌 값으로 바꾸면 거부한다 — notification-events 와 .DLT 는 계약이 3 이다")
    void rejectsPartitionCountOtherThanThree() {
        OutboxRelayProperties properties = fullyConfigured();
        properties.getKafka().setPartitions(1);

        assertThatThrownBy(properties::validateWhenEnabled)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("3파티션");
    }

    @Test
    @DisplayName("엔드포인트는 절대 http(s) URL + caller 토큰이 있어야 한다 — 목적지는 설정에만 있다")
    void rejectsEndpointWithoutAbsoluteUrlOrToken() {
        OutboxRelayProperties properties = fullyConfigured();
        OutboxRelayProperties.Endpoint endpoint = new OutboxRelayProperties.Endpoint();
        endpoint.setTarget(OutboxTarget.LINK);
        endpoint.setUrl("/internal/users/{userId}/withdraw");
        endpoint.setToken("service-token");
        properties.getEndpoints().put("LINK_USER_WITHDRAW", endpoint);

        assertThatThrownBy(properties::validateWhenEnabled)
                .as("상대 경로를 허용하면 「어느 호스트로 가는가」가 설정 밖에서 정해진다")
                .hasMessageContaining("절대 http(s) URL");

        endpoint.setUrl("http://link:3000/internal/users/{userId}/withdraw");
        assertThatCode(properties::validateWhenEnabled).doesNotThrowAnyException();

        endpoint.setToken("${SVC_TOKEN_DATA_TO_LINK}");
        assertThatThrownBy(properties::validateWhenEnabled).hasMessageContaining("token");

        endpoint.setToken("  ");
        assertThatThrownBy(properties::validateWhenEnabled)
                .as("위성 수신부는 caller 별 서비스 토큰으로 호출자를 가른다(계약 §2)")
                .hasMessageContaining("token");
    }

    @Test
    @DisplayName("Kafka 를 HTTP 엔드포인트 대상으로 쓸 수 없다 — 브로커는 URL 을 갖지 않는다")
    void rejectsKafkaAsHttpEndpointTarget() {
        OutboxRelayProperties properties = fullyConfigured();
        OutboxRelayProperties.Endpoint endpoint = new OutboxRelayProperties.Endpoint();
        endpoint.setTarget(OutboxTarget.KAFKA);
        endpoint.setUrl("http://kafka:9092/publish");
        endpoint.setToken("t");
        properties.getEndpoints().put("BAD", endpoint);

        assertThatThrownBy(properties::validateWhenEnabled)
                .hasMessageContaining("Kafka 는 HTTP 목적지를 갖지 않습니다");
    }

    private static OutboxRelayProperties enabledWithoutRetry() {
        OutboxRelayProperties properties = new OutboxRelayProperties();
        properties.setEnabled(true);
        properties.setBatchSize(50);
        properties.setLeaseDuration(Duration.ofMinutes(1));
        properties.setPollInterval(Duration.ofSeconds(5));
        return properties;
    }

    private static OutboxRelayProperties fullyConfigured() {
        OutboxRelayProperties properties = enabledWithoutRetry();
        properties.getRetry().setInitialBackoff(Duration.ofSeconds(1));
        properties.getRetry().setMaxBackoff(Duration.ofMinutes(5));
        properties.getRetry().setMaxAttempts(10);
        return properties;
    }
}
