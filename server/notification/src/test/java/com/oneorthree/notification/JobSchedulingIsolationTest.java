package com.oneorthree.notification;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

import static org.assertj.core.api.Assertions.assertThat;

/** 실제 스케줄러와 PG 잡 원장을 거쳐 느린 snapshot HTTP로 인한 발송·ack 정지를 재현한다. */
@SpringBootTest(properties = "notification.scheduling-enabled=true")
@ActiveProfiles("ci")
@Testcontainers
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class JobSchedulingIsolationTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final AtomicReference<CountDownLatch> ENTERED = new AtomicReference<>();
    static final AtomicReference<CountDownLatch> RELEASE = new AtomicReference<>();
    static final AtomicInteger HITS = new AtomicInteger();
    static final AtomicReference<String> BODY = new AtomicReference<>();
    static final HttpServer DATA = startData();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
        registry.add("notification.data-url", () -> "http://127.0.0.1:" + DATA.getAddress().getPort());
    }

    @AfterAll
    static void stopData() {
        DATA.stop(0);
    }

    @Autowired Store store;
    @Autowired DispatchScheduler scheduler;
    @Autowired SnapshotReconciler snapshots;
    @Autowired @Qualifier("notificationSnapshotScheduler") ThreadPoolTaskScheduler snapshotScheduler;
    @MockitoBean PushTransport transport;

    @BeforeEach
    void reset() {
        store.update("UPDATE jobs SET enabled=false");
        store.update("DELETE FROM job_runs");
        store.update("UPDATE jobs SET cron='0 0 0 1 1 *',updated_at=now()");
        store.update("UPDATE dispatch_control SET enabled=true");
        ENTERED.set(new CountDownLatch(1));
        RELEASE.set(new CountDownLatch(1));
        HITS.set(0);
        BODY.set("{\"items\":[],\"nextCursor\":null}");
    }

    @Test
    @Order(1)
    void slowSnapshotDoesNotBlockNewAckAndBundleRuns() throws Exception {
        Timestamp run = Timestamp.from(Instant.now().minusSeconds(60));
        enqueue("user-reconcile", run);
        try {
            assertThat(ENTERED.get().await(5, TimeUnit.SECONDS)).isTrue();
            // 다른 호출도 실제 ShedLock 프록시를 지난다. 진행 중인 전수 조회를 중복 시작하면 안 된다.
            scheduler.reconcileUsers();
            assertThat(HITS).hasValue(1);
            assertThat(store.one("SELECT lock_until>timezone('UTC',now()) AS held FROM shedlock"
                    + " WHERE name='notification-user-reconcile'")).containsEntry("held", true);
            enqueue("ack-reconcile", run);
            enqueue("bundle-flush", run);
            assertThat(await(() -> completed("ack-reconcile", run) && completed("bundle-flush", run),
                    Duration.ofSeconds(3))).as("snapshot HTTP 대기 중에도 두 잡의 새 회차가 완료되어야 한다").isTrue();
            assertThat(completed("user-reconcile", run)).isFalse();
            assertThat(HITS).hasValue(1);
        } finally {
            store.update("UPDATE jobs SET enabled=false WHERE id<>'user-reconcile'");
            RELEASE.get().countDown();
            assertThat(await(() -> completed("user-reconcile", run), Duration.ofSeconds(5))).isTrue();
            store.update("UPDATE jobs SET enabled=false");
        }
    }

    @Test
    @Order(2)
    void snapshotFailureIsNotCompletedAndTheSameRunRetries() throws Exception {
        Timestamp run = Timestamp.from(Instant.now().minusSeconds(60));
        BODY.set("{\"items\":[]}"); // required nullable nextCursor 유실
        RELEASE.get().countDown();
        enqueue("user-reconcile", run);
        try {
            assertThat(await(() -> store.one("SELECT error FROM job_runs WHERE job_id='user-reconcile'"
                    + " AND scheduled_at=?", run).get("error") != null, Duration.ofSeconds(5))).isTrue();
            assertThat(completed("user-reconcile", run)).isFalse();
            store.update("UPDATE jobs SET enabled=false WHERE id='user-reconcile'");
            enqueue("ack-reconcile", run);
            enqueue("bundle-flush", run);
            assertThat(await(() -> completed("ack-reconcile", run) && completed("bundle-flush", run),
                    Duration.ofSeconds(3))).isTrue();
            BODY.set("{\"items\":[],\"nextCursor\":null}");
            store.update("UPDATE jobs SET enabled=true WHERE id='user-reconcile'");
            assertThat(await(() -> completed("user-reconcile", run), Duration.ofSeconds(5))).isTrue();
            assertThat(HITS.get()).isGreaterThanOrEqualTo(2);
            assertThat(store.one("SELECT error FROM job_runs WHERE job_id='user-reconcile' AND scheduled_at=?", run))
                    .containsEntry("error", null);
        } finally {
            store.update("UPDATE jobs SET enabled=false");
        }
    }

    @Test
    @Order(3)
    void shutdownStopsTheScanWithoutCompletingOrApplyingItsNextPage() throws Exception {
        UUID user = UUID.randomUUID();
        BODY.set("{\"items\":[{\"userId\":\"" + user + "\",\"authGeneration\":0,"
                + "\"withdrawn\":false,\"version\":1}],\"nextCursor\":\"" + user + "\"}");
        Timestamp run = Timestamp.from(Instant.now().minusSeconds(60));
        enqueue("user-reconcile", run);
        try {
            assertThat(ENTERED.get().await(5, TimeUnit.SECONDS)).isTrue();
            var shutdown = CompletableFuture.runAsync(snapshotScheduler::shutdown);
            assertThat(await(() -> snapshotScheduler.getScheduledThreadPoolExecutor().isShutdown(),
                    Duration.ofSeconds(2))).isTrue();
            RELEASE.get().countDown();
            shutdown.get(6, TimeUnit.SECONDS);
            assertThat(snapshotScheduler.getScheduledThreadPoolExecutor().isTerminated()).isTrue();
            assertThat(HITS).hasValue(1);
            assertThat(completed("user-reconcile", run)).isFalse();
            assertThat(store.rows("SELECT * FROM projections WHERE user_id=?", user)).isEmpty();
            assertThat(store.one("SELECT error FROM job_runs WHERE job_id='user-reconcile' AND scheduled_at=?", run)
                    .get("error")).isNotNull();
            assertThat(store.one("SELECT lock_until<=timezone('UTC',now()) AS released FROM shedlock"
                    + " WHERE name='notification-user-reconcile'")).containsEntry("released", true);

            // 스케줄러 종료는 직접 호출 표면을 바꾸지 않는다. 수동 전수 조회는 호출 스레드에서 끝난다.
            BODY.set("{\"items\":[],\"nextCursor\":null}");
            snapshots.reconcile();
            assertThat(HITS).hasValue(2);
        } finally {
            RELEASE.get().countDown();
            store.update("UPDATE jobs SET enabled=false");
        }
    }

    private void enqueue(String job, Timestamp run) {
        store.update("INSERT INTO job_runs(job_id,scheduled_at) VALUES(?,?)", job, run);
        store.update("UPDATE jobs SET enabled=true WHERE id=?", job);
    }

    private boolean completed(String job, Timestamp run) {
        return store.one("SELECT completed_at FROM job_runs WHERE job_id=? AND scheduled_at=?", job, run)
                .get("completed_at") != null;
    }

    private static boolean await(BooleanSupplier condition, Duration timeout) throws InterruptedException {
        long end = System.nanoTime() + timeout.toNanos();
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() >= end) {
                return false;
            }
            Thread.sleep(25);
        }
        return true;
    }

    private static HttpServer startData() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/internal/users/notification-snapshot", exchange -> {
                HITS.incrementAndGet();
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, 0);
                ENTERED.get().countDown();
                // 분할 본문은 read timeout 안에 도착하지만 완성된 페이지는 운영자의 해제까지 늦어진다.
                // 고정 sleep으로 2초 read timeout만 재현하는 대신 실제 장시간 조회를 유지한다.
                try {
                    for (int i = 0; i < 150 && !RELEASE.get().await(100, TimeUnit.MILLISECONDS); i++) {
                        exchange.getResponseBody().write(' ');
                        exchange.getResponseBody().flush();
                    }
                    exchange.getResponseBody().write(BODY.get().getBytes(StandardCharsets.UTF_8));
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                } finally {
                    exchange.close();
                }
            });
            server.start();
            return server;
        } catch (IOException failure) {
            throw new IllegalStateException(failure);
        }
    }
}
