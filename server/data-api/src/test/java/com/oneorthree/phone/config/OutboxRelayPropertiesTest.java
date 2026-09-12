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

    /**
     * 「비어 있지 않다」로는 모자라다 — Spring 7 의 {@code HttpMethod} 는 enum 이 아니라서
     * {@code HttpMethod.valueOf("POSTT")} 가 던지지 않고 그 이름의 인스턴스를 만들어 준다.
     *
     * <p>그래서 오타가 기동을 통과해 그대로 와이어로 나가고, 위성은 405 로 거절한다. relay 는 4xx 를
     * permanent 로 적으므로 그 축은 <b>설정을 고칠 때까지</b> 멈춘다. HTTP method 는 대소문자를 가리니
     * 소문자 {@code post} 도 같은 결말이다 — 둘 다 <b>기동 전에</b> 막아야 한다.
     */
    @Test
    @DisplayName("표준이 아닌 HTTP method 는 기동에서 거부한다 — 오타는 첫 전달이 아니라 부팅에서 드러나야 한다")
    void rejectsEndpointWhoseMethodIsNotAStandardHttpMethod() {
        OutboxRelayProperties properties = fullyConfigured();
        OutboxRelayProperties.Endpoint endpoint = new OutboxRelayProperties.Endpoint();
        endpoint.setTarget(OutboxTarget.LINK);
        endpoint.setUrl("http://link:3000/internal/users/{userId}/withdraw");
        endpoint.setToken("service-token");
        properties.getEndpoints().put("LINK_USER_WITHDRAW", endpoint);

        // 기본값은 그대로 통과한다.
        assertThatCode(properties::validateWhenEnabled).doesNotThrowAnyException();

        endpoint.setMethod("POSTT");
        assertThatThrownBy(properties::validateWhenEnabled)
                .as("HttpMethod.valueOf 는 모르는 이름도 만들어 주므로 런타임이 잡아 주지 않는다")
                .hasMessageContaining("표준 HTTP method");

        endpoint.setMethod("post");
        assertThatThrownBy(properties::validateWhenEnabled)
                .as("HTTP method 는 대소문자를 가린다 — 소문자는 405 로 돌아온다")
                .hasMessageContaining("표준 HTTP method");

        endpoint.setMethod("  ");
        assertThatThrownBy(properties::validateWhenEnabled).hasMessageContaining("method 가 필요합니다");

        endpoint.setMethod("PUT");
        assertThatCode(properties::validateWhenEnabled)
                .as("표준 method 는 POST 말고도 받는다 — 계약이 고르는 것이지 이 검증이 고르는 것이 아니다")
                .doesNotThrowAnyException();
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
