package com.oneorthree.phone.outbox.service;

import com.oneorthree.phone.config.OutboxRelayProperties;
import com.oneorthree.phone.outbox.client.OutboxTransport;
import com.oneorthree.phone.outbox.client.OutboxTransportResult;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** relay 지표(GROMO-2337) — 실제 선점·표시 경로를 돌려 이름·태그·값을 맞춘다. */
@SpringBootTest
@Import(OutboxRelayMetricsTest.Configuration.class)
class OutboxRelayMetricsTest {
    private static final AtomicReference<Instant> NOW = new AtomicReference<>();
    private static final Clock CLOCK = mock(Clock.class);
    private static final OutboxRelayProperties PROPERTIES = properties();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @TestConfiguration
    static class Configuration {
        @Bean
        OutboxRelayStore metricsTestStore(EventOutboxDeliveryRepository repository) {
            return new OutboxRelayStore(repository, PROPERTIES, CLOCK, new SimpleMeterRegistry());
        }
    }

    @Autowired OutboxRelayStore store;
    @Autowired EventOutboxRepository outbox;
    @Autowired EventOutboxDeliveryRepository deliveries;
    @Autowired OutboxCommandPort commands;
    @Autowired PlatformTransactionManager transactionManager;

    @BeforeEach
    void reset() {
        when(CLOCK.instant()).thenAnswer(invocation -> NOW.get());
        tx().executeWithoutResult(status -> {
            deliveries.deleteAllInBatch();
            outbox.deleteAllInBatch();
        });
    }

    @Test
    void recordsClaimSendOutcomesAndDueBacklog() {
        append();
        append();
        Instant oldest = deliveries.findAll().stream()
                .map(EventOutboxDelivery::getCreatedAt).min(Comparator.naturalOrder()).orElseThrow();
        NOW.set(oldest.plusSeconds(100));
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        AtomicInteger calls = new AtomicInteger();
        OutboxTransport firstSucceedsThenRetry = new OutboxTransport() {
            @Override
            public OutboxTarget target() {
                return OutboxTarget.KAFKA;
            }

            @Override
            public OutboxTransportResult send(EventOutboxDelivery delivery, UUID user) {
                return calls.incrementAndGet() == 1
                        ? OutboxTransportResult.success() : OutboxTransportResult.retry("broker down");
            }
        };
        OutboxRelayService relay = new OutboxRelayService(
                store, outbox, PROPERTIES, CLOCK, List.of(firstSucceedsThenRetry), registry, Runnable::run);

        assertThat(relay.relayOnce()).isEqualTo(1);

        assertThat(gauge(registry, "outbox.relay.backlog", "KAFKA")).as("틱 시작 스냅샷").isEqualTo(2);
        assertThat(gauge(registry, "outbox.relay.oldest_pending_age", "KAFKA")).isCloseTo(100, within(1.0));
        assertThat(gauge(registry, "outbox.relay.backlog", "SCORE")).isZero();
        assertThat(registry.get("outbox.relay.claim").tag("target", "KAFKA").timer().count()).isEqualTo(1);
        assertThat(registry.get("outbox.relay.send").tag("target", "KAFKA").timer().count()).isEqualTo(2);
        assertThat(registry.get("outbox.relay.delivered").tag("target", "KAFKA").counter().count()).isEqualTo(1);
        assertThat(registry.get("outbox.relay.failed").tags("target", "KAFKA", "retryable", "true")
                .counter().count()).isEqualTo(1);
        assertThat(registry.get("outbox.relay.released").tags("target", "KAFKA", "reason", "overtaking")
                .counter().count()).as("서로 다른 축이라 앞지르기가 없다").isZero();
        assertThat(registry.get("outbox.relay.released").tags("target", "KAFKA", "reason", "predecessor_failed")
                .counter().count()).isZero();

        relay.relayOnce();
        assertThat(gauge(registry, "outbox.relay.backlog", "KAFKA")).isEqualTo(1);
        assertThat(gauge(registry, "outbox.relay.oldest_pending_age", "KAFKA"))
                .as("백오프로 미뤄 둔 행은 나이에 넣지 않는다").isZero();
    }

    private static double gauge(SimpleMeterRegistry registry, String name, String target) {
        return registry.get(name).tag("target", target).gauge().value();
    }

    private void append() {
        UUID user = UUID.randomUUID();
        tx().executeWithoutResult(status -> commands.append(new OutboxAppendCommand(
                "metrics-test-" + UUID.randomUUID(), 1, "user.withdrawn", user, "ko", null,
                AggregateRef.ofUser(user), null, Map.of(), List.of(OutboxDeliveryRequest.toKafka()))));
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    private static OutboxRelayProperties properties() {
        OutboxRelayProperties result = new OutboxRelayProperties();
        result.setBatchSize(10);
        result.setLeaseDuration(Duration.ofSeconds(30));
        result.getRetry().setInitialBackoff(Duration.ofSeconds(10));
        result.getRetry().setMaxBackoff(Duration.ofSeconds(10));
        result.setTickBudget(Duration.ZERO);   // 틱 = 한 라운드 — 선점 타이머 1회를 단언한다
        return result;
    }
}
