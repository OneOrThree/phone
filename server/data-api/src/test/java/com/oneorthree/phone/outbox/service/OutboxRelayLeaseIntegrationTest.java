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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
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
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 실제 PostgreSQL 선점·갱신·완료 트랜잭션과 두 워커를 제어 시각으로 교차 실행한다. */
@SpringBootTest
@Import(OutboxRelayLeaseIntegrationTest.Configuration.class)
class OutboxRelayLeaseIntegrationTest {
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
        OutboxRelayStore leaseTestStore(EventOutboxDeliveryRepository repository) {
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

    @ParameterizedTest
    @EnumSource(OutboxTarget.class)
    void aWorkerDoesNotSendTheRestOfABatchAfterAnotherWorkerReclaimsIt(OutboxTarget target) throws Exception {
        verifyReclaimedBatch(target, OutboxTransportResult.success());
    }

    @ParameterizedTest
    @EnumSource(OutboxTarget.class)
    void aLateFailureCannotOverwriteTheReplacementWorkersCompletion(OutboxTarget target) throws Exception {
        verifyReclaimedBatch(target, OutboxTransportResult.retry("late transport failure"));
    }

    private void verifyReclaimedBatch(OutboxTarget target, OutboxTransportResult originalResult) throws Exception {
        append(target);
        append(target);
        BlockingTransport original = new BlockingTransport(target, originalResult);
        RecordingTransport replacement = new RecordingTransport(target);
        var executor = Executors.newSingleThreadExecutor();
        var originalRun = executor.submit(() -> relay(original).relayTarget(target));
        try {
            assertThat(original.entered.await(5, TimeUnit.SECONDS)).isTrue();
            NOW.set(START.plusSeconds(31));
            assertThat(relay(replacement).relayTarget(target)).isEqualTo(2);
            assertThat(replacement.sent).hasSize(2);
            original.release.countDown();
            assertThat(originalRun.get(5, TimeUnit.SECONDS)).isZero();
            assertThat(original.sent)
                    .as("이미 시작한 첫 전송 이외에는 새 소유자의 행을 보내지 않는다")
                    .hasSize(1);
            assertThat(deliveries.findAll()).allSatisfy(row -> {
                assertThat(row.getDeliveredAt()).isEqualTo(START.plusSeconds(31));
                assertThat(row.getLeaseToken()).isNull();
                assertThat(row.getLastError()).isNull();
                assertThat(row.getAttemptCount()).isEqualTo(2);
            });
        } finally {
            original.release.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    @ParameterizedTest
    @EnumSource(OutboxTarget.class)
    void anExpiredBatchRowWaitsForANewClaimEvenWhenNobodyHasReclaimedIt(OutboxTarget target) throws Exception {
        append(target);
        append(target);
        BlockingTransport original = new BlockingTransport(target);
        var executor = Executors.newSingleThreadExecutor();
        var run = executor.submit(() -> relay(original).relayTarget(target));
        try {
            assertThat(original.entered.await(5, TimeUnit.SECONDS)).isTrue();
            NOW.set(START.plusSeconds(30));
            original.release.countDown();
            assertThat(run.get(5, TimeUnit.SECONDS)).isEqualTo(1);
            assertThat(original.sent).hasSize(1);
            RecordingTransport replacement = new RecordingTransport(target);
            assertThat(relay(replacement).relayTarget(target)).isEqualTo(1);
            assertThat(replacement.sent).hasSize(1).doesNotContain(original.sent.get(0));
        } finally {
            original.release.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    @ParameterizedTest
    @EnumSource(OutboxTarget.class)
    void eachSendRenewsItsOwnLeaseBeyondTheOriginalBatchDeadline(OutboxTarget target) throws Exception {
        append(target);
        append(target);
        CountDownLatch secondEntered = new CountDownLatch(1);
        CountDownLatch secondRelease = new CountDownLatch(1);
        RecordingTransport transport = new RecordingTransport(target) {
            @Override
            public OutboxTransportResult send(EventOutboxDelivery delivery, UUID user) {
                super.send(delivery, user);
                if (sent.size() == 1) {
                    NOW.set(START.plusSeconds(20));
                } else {
                    secondEntered.countDown();
                    awaitRelease(secondRelease);
                }
                return OutboxTransportResult.success();
            }
        };
        var executor = Executors.newSingleThreadExecutor();
        var run = executor.submit(() -> relay(transport).relayTarget(target));
        try {
            assertThat(secondEntered.await(5, TimeUnit.SECONDS)).isTrue();
            UUID secondId = transport.sent.get(1);
            EventOutboxDelivery second = deliveries.findById(secondId).orElseThrow();
            assertThat(second.getLeaseExpiresAt()).isEqualTo(START.plusSeconds(50));
            NOW.set(START.plusSeconds(31));
            assertThat(store.claim(target, "competing-worker", UUID.randomUUID())).isEmpty();
            secondRelease.countDown();
            assertThat(run.get(5, TimeUnit.SECONDS)).isEqualTo(2);
            assertThat(deliveries.findById(secondId).orElseThrow().getDeliveredAt())
                    .isEqualTo(START.plusSeconds(31));
        } finally {
            secondRelease.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    private OutboxRelayService relay(OutboxTransport transport) {
        return new OutboxRelayService(store, outbox, PROPERTIES, CLOCK, List.of(transport));
    }

    private void append(OutboxTarget target) {
        UUID user = UUID.randomUUID();
        OutboxDeliveryRequest destination = switch (target) {
            case KAFKA -> OutboxDeliveryRequest.toKafka();
            case LINK -> OutboxDeliveryRequest.toLink("LINK_TEST", null);
            case NOTI -> OutboxDeliveryRequest.toNotification("NOTI_TEST", null);
            case REALTIME -> OutboxDeliveryRequest.toRealtime("REALTIME_TEST", null);
        };
        tx().executeWithoutResult(status -> commands.append(new OutboxAppendCommand(
                "lease-test-" + UUID.randomUUID(), 1, "user.withdrawn", user, "ko", null,
                AggregateRef.ofUser(user), null, Map.of(), List.of(destination))));
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    private static OutboxRelayProperties properties() {
        OutboxRelayProperties result = new OutboxRelayProperties();
        result.setBatchSize(2);
        result.setLeaseDuration(Duration.ofSeconds(30));
        result.getRetry().setInitialBackoff(Duration.ofSeconds(1));
        result.getRetry().setMaxBackoff(Duration.ofSeconds(10));
        return result;
    }

    private static class RecordingTransport implements OutboxTransport {
        private final OutboxTarget destination;
        final List<UUID> sent = new CopyOnWriteArrayList<>();

        RecordingTransport(OutboxTarget destination) {
            this.destination = destination;
        }

        @Override
        public OutboxTarget target() {
            return destination;
        }

        @Override
        public OutboxTransportResult send(EventOutboxDelivery delivery, UUID user) {
            sent.add(delivery.getId());
            return OutboxTransportResult.success();
        }
    }

    private static final class BlockingTransport extends RecordingTransport {
        final CountDownLatch entered = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        private final OutboxTransportResult result;

        BlockingTransport(OutboxTarget destination) {
            this(destination, OutboxTransportResult.success());
        }

        BlockingTransport(OutboxTarget destination, OutboxTransportResult result) {
            super(destination);
            this.result = result;
        }

        @Override
        public OutboxTransportResult send(EventOutboxDelivery delivery, UUID user) {
            super.send(delivery, user);
            entered.countDown();
            awaitRelease(release);
            return result;
        }
    }

    private static void awaitRelease(CountDownLatch release) {
        try {
            if (!release.await(5, TimeUnit.SECONDS)) {
                throw new AssertionError("테스트의 전송 해제 신호를 받지 못했다");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }
}
