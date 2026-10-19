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
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 윈도 선점 문장(GROMO-2337)을 실제 PostgreSQL 에서 — 동시 선점·만료 회수·KAFKA→NOTI 장벽, 그리고 축 run 과
 * 앞지르기 보정(GROMO-2338).
 */
@SpringBootTest
@Import(OutboxRelayClaimIntegrationTest.Configuration.class)
class OutboxRelayClaimIntegrationTest {
    private static final Instant START = Instant.parse("2030-01-01T00:00:00Z");
    private static final AtomicReference<Instant> NOW = new AtomicReference<>(START);
    private static final Clock CLOCK = mock(Clock.class);
    private static final OutboxRelayProperties PROPERTIES = properties();
    private static final SimpleMeterRegistry REGISTRY = new SimpleMeterRegistry();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @TestConfiguration
    static class Configuration {
        @Bean
        OutboxRelayStore claimTestStore(EventOutboxDeliveryRepository repository) {
            return new OutboxRelayStore(repository, PROPERTIES, CLOCK, REGISTRY);
        }
    }

    @Autowired OutboxRelayStore store;
    @Autowired EventOutboxRepository outbox;
    @Autowired EventOutboxDeliveryRepository deliveries;
    @Autowired OutboxCommandPort commands;
    @Autowired PlatformTransactionManager transactionManager;
    @Autowired JdbcTemplate jdbc;
    @Autowired DataSource dataSource;

    @BeforeEach
    void reset() {
        NOW.set(START);
        PROPERTIES.setRunLength(10);
        REGISTRY.clear();
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

    @Test
    void claimsAtMostRunLengthConsecutiveRowsPerAxis() {
        PROPERTIES.setRunLength(3);
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        for (int i = 0; i < 5; i++) {
            append(a, OutboxDeliveryRequest.toKafka());
            append(b, OutboxDeliveryRequest.toKafka());
        }

        List<EventOutboxDelivery> claimed = store.claim(OutboxTarget.KAFKA, "w", UUID.randomUUID());

        assertThat(versionsOf(claimed, a)).as("축마다 앞쪽 3건만").containsExactly(1L, 2L, 3L);
        assertThat(versionsOf(claimed, b)).containsExactly(1L, 2L, 3L);
    }

    @Test
    void aBackoffRowInTheMiddleCutsTheRun() {
        UUID user = UUID.randomUUID();
        for (int i = 0; i < 5; i++) {
            append(user, OutboxDeliveryRequest.toKafka());
        }
        jdbc.update("UPDATE event_outbox_deliveries SET next_attempt_at = ? WHERE aggregate_id = ? AND aggregate_version = 3",
                java.sql.Timestamp.from(START.plusSeconds(60)), user.toString());

        List<EventOutboxDelivery> claimed = store.claim(OutboxTarget.KAFKA, "w", UUID.randomUUID());

        assertThat(versionsOf(claimed, user)).as("백오프 중인 v3 뒤는 run 에 들지 않는다").containsExactly(1L, 2L);
    }

    @Test
    void kafkaRunStopsAtAnUndeliveredNotificationRow() {
        UUID user = UUID.randomUUID();
        append(user, OutboxDeliveryRequest.toKafka());
        append(user, OutboxDeliveryRequest.toKafka());
        append(user, OutboxDeliveryRequest.toNotification("NOTI_TEST", null), OutboxDeliveryRequest.toKafka());
        append(user, OutboxDeliveryRequest.toKafka());

        List<EventOutboxDelivery> claimed = store.claim(OutboxTarget.KAFKA, "w", UUID.randomUUID());

        assertThat(versionsOf(claimed, user))
                .as("같은 version 의 NOTI 는 막지 않고(v3 KAFKA 포함), 그 NOTI 미완료가 v4 를 막는다")
                .containsExactly(1L, 2L, 3L);
    }

    @Test
    void aLockedPredecessorMakesTheWholeRunUnclaimable() throws Exception {
        UUID user = UUID.randomUUID();
        for (int i = 0; i < 3; i++) {
            append(user, OutboxDeliveryRequest.toKafka());
        }
        UUID v1 = idOf(user, 1);
        // 다른 워커가 v1 을 선점하는 중(잠금은 잡았고 커밋 전)인 순간을 결정적으로 만든다 — 윈도는 v1 을 «선점 가능»으로
        // 보고 run {v1,v2,v3} 를 계산하지만 SKIP LOCKED 가 v1 을 건너뛰어 v2·v3 만 잠근다. 보정이 없으면 v2 가 v1 을 앞지른다.
        try (Connection holder = dataSource.getConnection()) {
            holder.setAutoCommit(false);
            try (PreparedStatement lock = holder.prepareStatement(
                    "SELECT id FROM event_outbox_deliveries WHERE id = ? FOR UPDATE")) {
                lock.setObject(1, v1);
                lock.executeQuery().close();
            }

            assertThat(store.claim(OutboxTarget.KAFKA, "w", UUID.randomUUID()))
                    .as("선행이 내 것이 아니면 뒤 run 전체를 되돌린다").isEmpty();
            holder.rollback();
        }

        assertThat(deliveries.findAll()).allSatisfy(row -> {
            assertThat(row.getLeaseToken()).isNull();
            assertThat(row.getAttemptCount()).as("보내지 않은 선점은 시도가 아니다").isZero();
        });
        assertThat(REGISTRY.get("outbox.relay.released").tags("target", "KAFKA", "reason", "overtaking")
                .counter().count()).isEqualTo(2);
        assertThat(versionsOf(store.claim(OutboxTarget.KAFKA, "w", UUID.randomUUID()), user))
                .as("잠금이 풀리면 앞쪽부터 다시 집힌다").containsExactly(1L, 2L, 3L);
    }

    @ParameterizedTest
    @ValueSource(ints = {2, 3, 4})
    void concurrentRunClaimersKeepEveryAxisAPrefix(int workers) throws Exception {
        List<UUID> users = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            users.add(UUID.randomUUID());
        }
        for (int version = 0; version < 10; version++) {
            for (UUID user : users) {
                append(user, OutboxDeliveryRequest.toKafka());
            }
        }
        CountDownLatch ready = new CountDownLatch(workers);
        CountDownLatch go = new CountDownLatch(1);
        AtomicInteger delivered = new AtomicInteger();
        List<UUID> ownedOnce = Collections.synchronizedList(new ArrayList<>());
        var executor = Executors.newFixedThreadPool(workers);
        try {
            List<Future<?>> runs = new ArrayList<>();
            for (int w = 0; w < workers; w++) {
                String owner = "worker-" + w;
                runs.add(executor.submit(() -> {
                    ready.countDown();
                    assertThat(go.await(5, TimeUnit.SECONDS)).isTrue();
                    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60);
                    while (delivered.get() < 200 && System.nanoTime() < deadline) {
                        UUID token = UUID.randomUUID();
                        List<EventOutboxDelivery> mine = store.claim(OutboxTarget.KAFKA, owner, token);
                        if (mine.isEmpty()) {
                            Thread.sleep(2);
                            continue;
                        }
                        assertThat(deliveries.findOvertaking(mine.stream().map(EventOutboxDelivery::getId).toList(),
                                token)).as("커밋된 내 행의 선행 미전달은 전부 내 것이다").isEmpty();
                        for (EventOutboxDelivery row : mine) {
                            assertThat(store.markDelivered(row.getId(), token)).isEqualTo(1);
                            ownedOnce.add(row.getId());
                            delivered.incrementAndGet();
                        }
                    }
                    return null;
                }));
            }
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            go.countDown();
            for (Future<?> run : runs) {
                run.get(90, TimeUnit.SECONDS);
            }
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }

        assertThat(ownedOnce).as("두 워커가 같은 행을 갖지 않는다(교집합 0)").doesNotHaveDuplicates().hasSize(200);
        assertThat(deliveries.findAll()).allSatisfy(row -> assertThat(row.getDeliveredAt()).isNotNull());
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

    private static List<Long> versionsOf(List<EventOutboxDelivery> rows, UUID user) {
        return rows.stream().filter(row -> row.getAggregateId().equals(user.toString()))
                .map(EventOutboxDelivery::getAggregateVersion).sorted().toList();
    }

    private UUID idOf(UUID user, long version) {
        return deliveries.findAll().stream()
                .filter(row -> row.getAggregateId().equals(user.toString()) && row.getAggregateVersion() == version)
                .map(EventOutboxDelivery::getId).findFirst().orElseThrow();
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
