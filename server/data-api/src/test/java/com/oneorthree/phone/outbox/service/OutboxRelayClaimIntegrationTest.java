package com.oneorthree.phone.outbox.service;

import com.oneorthree.phone.config.OutboxRelayProperties;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.repository.EventOutboxDeliveryRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutboxDelivery;
import com.oneorthree.phone.outbox.repository.domain.OutboxTarget;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
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
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 윈도 선점 문장(GROMO-2337)을 실제 PostgreSQL 에서 — 동시 선점·만료 회수·KAFKA→NOTI 장벽. */
@SpringBootTest
@Import(OutboxRelayClaimIntegrationTest.Configuration.class)
class OutboxRelayClaimIntegrationTest {
    private static final Instant START = Instant.parse("2030-01-01T00:00:00Z");
    private static final AtomicReference<Instant> NOW = new AtomicReference<>(START);
    private static final Clock CLOCK = mock(Clock.class);
    private static final OutboxRelayProperties PROPERTIES = properties();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @TestConfiguration
    static class Configuration {
        @Bean
        OutboxRelayStore claimTestStore(EventOutboxDeliveryRepository repository) {
            return new OutboxRelayStore(repository, PROPERTIES, CLOCK);
        }
    }

    @Autowired OutboxRelayStore store;
    @Autowired EventOutboxRepository outbox;
    @Autowired EventOutboxDeliveryRepository deliveries;
    @Autowired OutboxCommandPort commands;
    @Autowired PlatformTransactionManager transactionManager;

    @BeforeEach
    void reset() {
        NOW.set(START);
        when(CLOCK.instant()).thenAnswer(invocation -> NOW.get());
        tx().executeWithoutResult(status -> {
            deliveries.deleteAllInBatch();
            outbox.deleteAllInBatch();
        });
    }

    @Test
    void twoConcurrentClaimersNeverCoOwnARow() throws Exception {
        for (int i = 0; i < 20; i++) {
            append(UUID.randomUUID(), OutboxDeliveryRequest.toKafka());
        }
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch go = new CountDownLatch(1);
        var executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<List<EventOutboxDelivery>>> runs = List.of(
                    executor.submit(() -> claimAfter(ready, go, "worker-a")),
                    executor.submit(() -> claimAfter(ready, go, "worker-b")));
            assertThat(ready.await(5, TimeUnit.SECONDS)).as("두 워커가 모두 출발선에 섰다").isTrue();
            go.countDown();
            Set<UUID> a = ids(runs.get(0).get(10, TimeUnit.SECONDS));
            Set<UUID> b = ids(runs.get(1).get(10, TimeUnit.SECONDS));

            assertThat(a).doesNotContainAnyElementsOf(b);
            Set<UUID> union = new HashSet<>(a);
            union.addAll(b);
            assertThat(union).as("배치 10 둘이 SKIP LOCKED 로 나눠 헤드 20개를 전부 집는다")
                    .isEqualTo(ids(deliveries.findAll()));
            assertThat(deliveries.findAll()).allSatisfy(row -> assertThat(row.getAttemptCount()).isEqualTo(1));
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void expiredLeaseReclaimTakesOverEveryRowExactlyOnce() {
        for (int i = 0; i < 5; i++) {
            append(UUID.randomUUID(), OutboxDeliveryRequest.toKafka());
        }
        UUID tokenA = UUID.randomUUID();
        assertThat(store.claim(OutboxTarget.KAFKA, "worker-a", tokenA)).hasSize(5);

        NOW.set(START.plusSeconds(29));
        assertThat(store.claim(OutboxTarget.KAFKA, "worker-b", UUID.randomUUID()))
                .as("살아 있는 리스는 회수하지 않는다").isEmpty();

        NOW.set(START.plusSeconds(31));
        UUID tokenB = UUID.randomUUID();
        List<EventOutboxDelivery> reclaimed = store.claim(OutboxTarget.KAFKA, "worker-b", tokenB);
        assertThat(ids(reclaimed)).isEqualTo(ids(deliveries.findAll()));
        assertThat(reclaimed).as("RETURNING 이 갱신 뒤 값을 돌려준다").allSatisfy(row -> {
            assertThat(row.getLeaseToken()).isEqualTo(tokenB);
            assertThat(row.getAttemptCount()).isEqualTo(2);
        });
        assertThat(deliveries.findAll()).allSatisfy(row -> {
            assertThat(row.getLeaseToken()).isEqualTo(tokenB);
            assertThat(row.getLeaseOwner()).isEqualTo("worker-b");
            assertThat(row.getAttemptCount()).isEqualTo(2);
        });
    }

    @Test
    void kafkaHeadWaitsForUndeliveredNotificationOfLowerVersionOnly() {
        UUID user = UUID.randomUUID();
        append(user, OutboxDeliveryRequest.toNotification("NOTI_TEST", null), OutboxDeliveryRequest.toKafka());
        append(user, OutboxDeliveryRequest.toKafka());

        UUID kafkaToken = UUID.randomUUID();
        List<EventOutboxDelivery> kafkaV1 = store.claim(OutboxTarget.KAFKA, "w", kafkaToken);
        assertThat(kafkaV1).as("같은 version 의 NOTI 는 KAFKA 를 막지 않는다").singleElement()
                .satisfies(row -> assertThat(row.getAggregateVersion()).isEqualTo(1));

        UUID notiToken = UUID.randomUUID();
        List<EventOutboxDelivery> notiV1 = store.claim(OutboxTarget.NOTI, "w", notiToken);
        assertThat(notiV1).as("역방향 — NOTI 는 KAFKA 를 기다리지 않는다").singleElement()
                .satisfies(row -> assertThat(row.getAggregateVersion()).isEqualTo(1));

        assertThat(store.markDelivered(kafkaV1.get(0).getId(), kafkaToken)).isEqualTo(1);
        assertThat(store.claim(OutboxTarget.KAFKA, "w", UUID.randomUUID()))
                .as("v2 KAFKA 는 v1 NOTI 미완료를 기다린다").isEmpty();

        assertThat(store.markDelivered(notiV1.get(0).getId(), notiToken)).isEqualTo(1);
        assertThat(store.claim(OutboxTarget.KAFKA, "w", UUID.randomUUID())).singleElement()
                .satisfies(row -> assertThat(row.getAggregateVersion()).isEqualTo(2));
    }

    private List<EventOutboxDelivery> claimAfter(CountDownLatch ready, CountDownLatch go, String owner)
            throws InterruptedException {
        ready.countDown();
        if (!go.await(5, TimeUnit.SECONDS)) {
            throw new AssertionError("출발 신호를 받지 못했다");
        }
        return store.claim(OutboxTarget.KAFKA, owner, UUID.randomUUID());
    }

    private void append(UUID user, OutboxDeliveryRequest... destinations) {
        tx().executeWithoutResult(status -> commands.append(new OutboxAppendCommand(
                "claim-test-" + UUID.randomUUID(), 1, "user.withdrawn", user, "ko", null,
                AggregateRef.ofUser(user), null, Map.of(), List.of(destinations))));
    }

    private static Set<UUID> ids(List<EventOutboxDelivery> rows) {
        Set<UUID> result = new HashSet<>();
        rows.forEach(row -> result.add(row.getId()));
        return result;
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    private static OutboxRelayProperties properties() {
        OutboxRelayProperties result = new OutboxRelayProperties();
        result.setBatchSize(10);
        result.setLeaseDuration(Duration.ofSeconds(30));
        result.getRetry().setInitialBackoff(Duration.ofSeconds(1));
        result.getRetry().setMaxBackoff(Duration.ofSeconds(10));
        return result;
    }
}
