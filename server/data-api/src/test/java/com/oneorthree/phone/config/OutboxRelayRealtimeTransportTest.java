package com.oneorthree.phone.config;

import com.oneorthree.phone.outbox.client.HttpOutboxTransport;
import com.oneorthree.phone.outbox.client.KafkaOutboxTransport;
import com.oneorthree.phone.outbox.client.OutboxTransport;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.service.OutboxRelayService;
import com.oneorthree.phone.outbox.service.OutboxRelayStore;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestClient;

import java.time.Clock;
import java.time.Duration;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * REALTIME 전달 경로 조립 (GROMO-1954, 2026-09-19 R-1) — HTTP 가 기본이고 플래그일 때만 Kafka 로 바뀐다.
 * 한 대상에 경로는 하나뿐이어야 한다(대상별 전달 상태가 하나라 두 경로를 동시에 표시할 수 없다).
 */
class OutboxRelayRealtimeTransportTest {

    @Test
    @DisplayName("기본은 HTTP — 허용목록에 REALTIME 키가 있으면 realtime POST /internal/events 로 나간다")
    void defaultsToHttp() {
        Map<OutboxTarget, OutboxTransport> transports = assemble(false);

        assertThat(transports.get(OutboxTarget.REALTIME)).isInstanceOf(HttpOutboxTransport.class);
        assertThat(transports.get(OutboxTarget.KAFKA)).isInstanceOf(KafkaOutboxTransport.class);
    }

    @Test
    @DisplayName("플래그를 켜면 REALTIME 은 realtime-events 토픽으로만 나간다 — HTTP 는 등록하지 않는다")
    void flagSwitchesRealtimeToKafka() {
        Map<OutboxTarget, OutboxTransport> transports = assemble(true);

        assertThat(transports.get(OutboxTarget.REALTIME)).isInstanceOf(KafkaOutboxTransport.class);
        assertThat(ReflectionTestUtils.getField(transports.get(OutboxTarget.REALTIME), "topic"))
                .isEqualTo("realtime-events");
        assertThat(ReflectionTestUtils.getField(transports.get(OutboxTarget.KAFKA), "topic"))
                .isEqualTo("notification-events");
    }

    @SuppressWarnings("unchecked")
    private static Map<OutboxTarget, OutboxTransport> assemble(boolean realtimeKafka) {
        OutboxRelayProperties properties = new OutboxRelayProperties();
        properties.setEnabled(true);
        properties.setBatchSize(10);
        properties.setLeaseDuration(Duration.ofSeconds(30));
        properties.setPollInterval(Duration.ofSeconds(1));
        properties.getRetry().setInitialBackoff(Duration.ofSeconds(1));
        properties.getRetry().setMaxBackoff(Duration.ofSeconds(10));
        properties.getRetry().setMaxAttempts(5);
        properties.setRealtimeKafkaEnabled(realtimeKafka);
        OutboxRelayProperties.Endpoint endpoint = new OutboxRelayProperties.Endpoint();
        endpoint.setTarget(OutboxTarget.REALTIME);
        endpoint.setUrl("http://realtime:8081/internal/events");
        endpoint.setToken("data-to-realtime");
        properties.getEndpoints().put("user.withdrawn", endpoint);

        OutboxRelayService service = new OutboxRelayConfig(properties).outboxRelayService(
                mock(OutboxRelayStore.class), mock(EventOutboxRepository.class), mock(KafkaTemplate.class),
                RestClient.create(), Clock.systemUTC());
        return (Map<OutboxTarget, OutboxTransport>) ReflectionTestUtils.getField(service, "transports");
    }
}
