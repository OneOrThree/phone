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
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 축 run 전달(GROMO-2338) — 축 사이 병렬·축 안 순차, 틱 예산 루프, 중간에 끊긴 run 의 재선점. 실제 PostgreSQL. */
@SpringBootTest
@Import(OutboxRelayRunIntegrationTest.Configuration.class)
class OutboxRelayRunIntegrationTest {
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
        OutboxRelayStore runTestStore(EventOutboxDeliveryRepository repository) {
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
        NOW.set(START);
        PROPERTIES.setTickBudget(Duration.ofSeconds(5));
        when(CLOCK.instant()).thenAnswer(invocation -> NOW.get());
        tx().executeWithoutResult(status -> {
            deliveries.deleteAllInBatch();
            outbox.deleteAllInBatch();
        });
    }

    @Test
    void axesRunInParallelButEachAxisInVersionOrder() throws Exception {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        for (int i = 0; i < 3; i++) {
            append(a);
            append(b);
        }
        CountDownLatch bDone = new CountDownLatch(1);
        AtomicBoolean aWaitedForB = new AtomicBoolean();
        List<String> sent = new CopyOnWriteArrayList<>();
        // 축 A 의 첫 전송이 축 B 가 끝날 때까지 막힌다 — 축이 순차로 돌면 B 가 시작도 못 해 5초 뒤 실패한다.
        Recording transport = new Recording(row -> {
            sent.add(row.getAggregateId() + ":" + row.getAggregateVersion());
            if (row.getAggregateId().equals(a.toString()) && row.getAggregateVersion() == 1) {
                aWaitedForB.set(await(bDone));
            }
            if (row.getAggregateId().equals(b.toString()) && row.getAggregateVersion() == 3) {
                bDone.countDown();
            }
            return OutboxTransportResult.success();
        });
        var pool = Executors.newFixedThreadPool(2);
        try {
            assertThat(relay(transport, pool).relayTarget(OutboxTarget.KAFKA)).isEqualTo(6);
        } finally {
            pool.shutdownNow();
        }

        assertThat(aWaitedForB).as("축 B 는 축 A 를 기다리지 않고 끝났다").isTrue();
        assertThat(sent.stream().filter(s -> s.startsWith(a.toString())).toList())
                .containsExactly(a + ":1", a + ":2", a + ":3");
        assertThat(sent.stream().filter(s -> s.startsWith(b.toString())).toList())
                .containsExactly(b + ":1", b + ":2", b + ":3");
    }

    @Test
    void relayOnceKeepsClaimingUntilNoWorkOrBudget() {
        UUID user = UUID.randomUUID();
        for (int i = 0; i < 25; i++) {
            append(user);
        }
        Recording ok = new Recording(row -> OutboxTransportResult.success());

        PROPERTIES.setTickBudget(Duration.ZERO);
        assertThat(relay(ok, Runnable::run).relayOnce()).as("예산 0 = 한 라운드 = run 10").isEqualTo(10);

        PROPERTIES.setTickBudget(Duration.ofSeconds(5));
        assertThat(relay(ok, Runnable::run).relayOnce()).as("예산 안에서 빌 때까지 — 남은 15").isEqualTo(15);
        assertThat(ok.sent).hasSize(25).doesNotHaveDuplicates();
    }

    @Test
    void anExpiredBudgetStopsStartingNewRounds() {
        UUID user = UUID.randomUUID();
        for (int i = 0; i < 25; i++) {
            append(user);
        }
        // 전송마다 1초가 흐른다 — 첫 라운드(10건)가 끝나면 예산 5초를 넘겨 다음 라운드를 열지 않는다.
        Recording slow = new Recording(row -> {
            NOW.set(NOW.get().plusSeconds(1));
            return OutboxTransportResult.success();
        });

        assertThat(relay(slow, Runnable::run).relayOnce()).isEqualTo(10);
    }

    @Test
    void aRunInterruptedMidWayIsReclaimedAfterLeaseExpiryWithoutReorder() throws Exception {
        UUID user = UUID.randomUUID();
        for (int i = 0; i < 3; i++) {
            append(user);
        }
        List<Long> wire = new CopyOnWriteArrayList<>();
        CountDownLatch v2Entered = new CountDownLatch(1);
        CountDownLatch v2Release = new CountDownLatch(1);
        Recording original = new Recording(row -> {
            wire.add(row.getAggregateVersion());
            if (row.getAggregateVersion() == 2) {
                v2Entered.countDown();
                await(v2Release);
            }
            return OutboxTransportResult.success();
        });
        Recording replacement = new Recording(row -> {
            wire.add(row.getAggregateVersion());
            return OutboxTransportResult.success();
        });
        SimpleMeterRegistry originalMetrics = new SimpleMeterRegistry();
        OutboxRelayService originalRelay = new OutboxRelayService(store, outbox, PROPERTIES, CLOCK,
                List.of(original), originalMetrics, Runnable::run);

        var executor = Executors.newSingleThreadExecutor();
        try {
            var originalRun = executor.submit(() -> originalRelay.relayTarget(OutboxTarget.KAFKA));
            assertThat(v2Entered.await(5, TimeUnit.SECONDS)).isTrue();
            NOW.set(START.plusSeconds(31));   // A 의 v2(전송 직전 갱신분)·v3 리스가 만료됐다
            assertThat(relay(replacement, Runnable::run).relayTarget(OutboxTarget.KAFKA))
                    .as("B 가 v2·v3 를 다시 집어 순서대로 보낸다").isEqualTo(2);
            v2Release.countDown();
            assertThat(originalRun.get(5, TimeUnit.SECONDS)).as("A 는 v1 만 인정받는다 — v2 표시는 낡은 토큰").isEqualTo(1);
        } finally {
            v2Release.countDown();
            executor.shutdownNow();
        }

        assertThat(versionsOf(original.sent)).as("A 는 v3 를 보내지 않는다").containsExactly(1L, 2L);
        assertThat(versionsOf(replacement.sent)).containsExactly(2L, 3L);
        assertThat(wire).as("와이어 순서 — v2 는 중복(at-least-once)이지만 v3 가 v2 를 앞지르지 않는다")
                .containsExactly(1L, 2L, 2L, 3L);
        assertThat(deliveries.findAll()).allSatisfy(row -> {
            assertThat(row.getDeliveredAt()).isNotNull();
            assertThat(row.getLeaseToken()).isNull();
        });
        assertThat(originalMetrics.get("outbox.relay.released").tags("target", "KAFKA", "reason", "predecessor_failed")
                .counter().count()).as("A 의 v3 놓기는 이미 B 의 것이라 0행 — 남의 리스를 건드리지 않는다").isZero();
    }

    private OutboxRelayService relay(OutboxTransport transport, Executor executor) {
        return new OutboxRelayService(store, outbox, PROPERTIES, CLOCK, List.of(transport), new SimpleMeterRegistry(),
                executor);
    }

    private List<Long> versionsOf(List<UUID> ids) {
        return ids.stream().map(id -> deliveries.findById(id).orElseThrow().getAggregateVersion()).toList();
    }

    private void append(UUID user) {
        tx().executeWithoutResult(status -> commands.append(new OutboxAppendCommand(
                "run-test-" + UUID.randomUUID(), 1, "user.withdrawn", user, "ko", null,
                AggregateRef.ofUser(user), null, Map.of(), List.of(OutboxDeliveryRequest.toKafka()))));
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    private static boolean await(CountDownLatch latch) {
        try {
            return latch.await(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private static OutboxRelayProperties properties() {
        OutboxRelayProperties result = new OutboxRelayProperties();
        result.setBatchSize(10);
        result.setLeaseDuration(Duration.ofSeconds(30));
        result.getRetry().setInitialBackoff(Duration.ofSeconds(1));
        result.getRetry().setMaxBackoff(Duration.ofSeconds(10));
        return result;
    }

    /** 보낸 행 id 를 적고 결과는 주어진 함수가 정한다. */
    private static final class Recording implements OutboxTransport {
        final List<UUID> sent = new CopyOnWriteArrayList<>();
        private final Function<EventOutboxDelivery, OutboxTransportResult> behaviour;

        Recording(Function<EventOutboxDelivery, OutboxTransportResult> behaviour) {
            this.behaviour = behaviour;
        }

        @Override
        public OutboxTarget target() {
            return OutboxTarget.KAFKA;
        }

        @Override
        public OutboxTransportResult send(EventOutboxDelivery delivery, UUID user) {
            sent.add(delivery.getId());
            return behaviour.apply(delivery);
        }
    }
}
