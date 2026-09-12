package com.oneorthree.notification;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.when;

/** 실제 PG의 처리 순서와 사건 잠금 아래에서 실패 재시도·새 ack의 공존을 검증한다. */
@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class AckReconcileFairnessTest {
    @Container static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant NOW = Instant.parse("2026-09-14T00:00:00Z");
    private static final UUID SESSION = UUID.fromString("12345678-1234-4234-8234-123456789012");
    private static final UUID HEALTHY = UUID.fromString("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    private static final UUID UNACKNOWLEDGED = UUID.fromString("ffffffff-ffff-4fff-8fff-ffffffffffff");
    private final Set<UUID> failing = ConcurrentHashMap.newKeySet();
    private final AtomicReference<Instant> now = new AtomicReference<>();
    private final AtomicInteger failedCalls = new AtomicInteger();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }

    @Autowired Store store;
    @Autowired AckService ack;
    @Autowired PlatformTransactionManager manager;
    @MockitoBean DataClient data;
    @MockitoBean PushTransport transport;
    @MockitoBean Clock clock;

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE result_ack,commands,delivery_devices,deliveries CASCADE");
        reset(data, clock);
        failing.clear();
        failedCalls.set(0);
        now.set(NOW);
        when(clock.instant()).thenAnswer(ignored -> now.get());
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        when(data.acknowledged(any(), any())).thenAnswer(call -> {
            UUID user = call.getArgument(0);
            if (failing.contains(user)) {
                failedCalls.incrementAndGet();
                throw new IllegalStateException("Data unavailable for " + user);
            }
            return !UNACKNOWLEDGED.equals(user);
        });
    }

    @Test
    void twentyFivePersistentFailuresDoNotStarveLaterRowsAndRemainRetryable() {
        for (int i = 1; i <= 25; i++) {
            UUID user = new UUID(0, i);
            failing.add(user);
            pending(user, NOW.minusSeconds(3600 - i));
        }
        pending(HEALTHY, NOW.minusSeconds(100));
        pending(UNACKNOWLEDGED, NOW.minusSeconds(99));
        assertThatThrownBy(ack::reconcile).isInstanceOf(IllegalStateException.class);
        assertThat(failedCalls).hasValue(25);
        assertThat(state(HEALTHY)).isEqualTo("NEEDS_CONFIRM");

        // 다음 tick은 재시도 유예 중인 25건 대신 뒤의 정본 확인 가능한 두 건을 처리해야 한다.
        ack.reconcile();
        assertThat(state(HEALTHY)).isEqualTo("CONFIRMED");
        assertThat(state(UNACKNOWLEDGED)).isEqualTo("RELEASED");
        assertThat(failedCalls).hasValue(25);
        assertThat(store.rows("SELECT state FROM result_ack WHERE user_id NOT IN (?,?)", HEALTHY, UNACKNOWLEDGED))
                .allSatisfy(row -> assertThat(row).containsEntry("state", "NEEDS_CONFIRM"));

        failing.clear();
        now.set(NOW.plusSeconds(29));
        ack.reconcile();
        assertThat(store.rows("SELECT user_id FROM result_ack WHERE state='NEEDS_CONFIRM'")).hasSize(25);
        now.set(NOW.plusSeconds(30));
        ack.reconcile();
        assertThat(store.rows("SELECT user_id FROM result_ack WHERE state='NEEDS_CONFIRM'")).isEmpty();
    }

    @Test
    void slowFailuresCannotReturnAheadOfOlderUntouchedRowsWhenBackoffHasAlreadyElapsed() {
        for (int i = 1; i <= 25; i++) {
            UUID user = new UUID(0, i);
            failing.add(user);
            pending(user, NOW.minusSeconds(3600 - i));
        }
        pending(HEALTHY, NOW.minusSeconds(100));
        reset(data);
        when(data.acknowledged(any(), any())).thenAnswer(call -> {
            if (failing.contains(call.<UUID>getArgument(0))) {
                // 실제 HTTP 지연만큼 원시계를 전진시킨다. 첫 예약의 30초가 배치 중에 지나간다.
                now.updateAndGet(time -> time.plusSeconds(2));
                throw new IllegalStateException("slow Data failure");
            }
            return true;
        });
        assertThatThrownBy(ack::reconcile).isInstanceOf(IllegalStateException.class);
        assertThat(now.get()).isEqualTo(NOW.plusSeconds(50));
        assertThatThrownBy(ack::reconcile).isInstanceOf(IllegalStateException.class);
        assertThat(state(HEALTHY)).isEqualTo("CONFIRMED");
    }

    @Test
    void aNewAbortDoesNotInheritTheFailedAttemptsBackoff() {
        pending(HEALTHY, NOW.minusSeconds(60));
        failing.add(HEALTHY);
        assertThatThrownBy(ack::reconcile).isInstanceOf(IllegalStateException.class);
        failing.clear();
        ack.command(HEALTHY, SESSION, "abort", "new-abort");
        ack.reconcile();
        assertThat(state(HEALTHY)).isEqualTo("CONFIRMED");
    }

    @Test
    void aPrepareWaitingOnAFailedReconcileRetainsItsNewHold() throws Exception {
        pending(HEALTHY, NOW.minusSeconds(60));
        CountDownLatch reading = new CountDownLatch(1);
        CountDownLatch releaseFailure = new CountDownLatch(1);
        CountDownLatch prepareStarted = new CountDownLatch(1);
        AtomicInteger reconcilePid = new AtomicInteger();
        AtomicInteger preparePid = new AtomicInteger();
        when(data.acknowledged(HEALTHY, SESSION)).thenAnswer(call -> {
            reconcilePid.set(pid());
            reading.countDown();
            assertThat(releaseFailure.await(5, TimeUnit.SECONDS)).isTrue();
            throw new IllegalStateException("Data failed during prepare");
        });
        var pool = Executors.newFixedThreadPool(2);
        try {
            var reconciling = pool.submit(() -> catchThrowable(ack::reconcile));
            assertThat(reading.await(5, TimeUnit.SECONDS)).isTrue();
            var preparing = pool.submit(() -> new TransactionTemplate(manager).execute(status -> {
                preparePid.set(pid());
                prepareStarted.countDown();
                return ack.command(HEALTHY, SESSION, "prepare", "new-prepare");
            }));
            assertThat(prepareStarted.await(5, TimeUnit.SECONDS)).isTrue();
            awaitBlockedBy(preparePid.get(), reconcilePid.get());
            releaseFailure.countDown();
            assertThat(reconciling.get(5, TimeUnit.SECONDS)).isInstanceOf(IllegalStateException.class);
            assertThat(preparing.get(5, TimeUnit.SECONDS)).containsEntry("state", "HELD");
            Map<String, Object> row = store.one("SELECT state,held_until,next_reconcile_at FROM result_ack"
                    + " WHERE user_id=? AND session_id=?", HEALTHY, SESSION);
            assertThat(row).containsEntry("state", "HELD").containsEntry("next_reconcile_at", null);
            assertThat(((Timestamp) row.get("held_until")).toInstant()).isEqualTo(NOW.plusSeconds(30));
            ack.reconcile();
            assertThat(state(HEALTHY)).isEqualTo("HELD");
        } finally {
            releaseFailure.countDown();
            pool.shutdownNow();
        }
    }

    private int pid() {
        return ((Number) store.one("SELECT pg_backend_pid() AS pid").get("pid")).intValue();
    }

    private void awaitBlockedBy(int waiting, int blocker) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        while (System.nanoTime() < deadline) {
            Map<String, Object> row = store.one("SELECT ? = ANY(pg_blocking_pids(?)) AS blocked", blocker, waiting);
            if (Boolean.TRUE.equals(row.get("blocked"))) {
                return;
            }
            Thread.sleep(20);
        }
        throw new AssertionError("prepare did not wait on the real ack lock");
    }

    private void pending(UUID user, Instant updated) {
        store.update("INSERT INTO result_ack(user_id,session_id,state,updated_at) VALUES(?,?,'NEEDS_CONFIRM',?)",
                user, SESSION, Timestamp.from(updated));
    }

    private String state(UUID user) {
        return store.one("SELECT state FROM result_ack WHERE user_id=? AND session_id=?", user, SESSION)
                .get("state").toString();
    }
}
