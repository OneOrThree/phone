package com.oneorthree.notification;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 실제 Data HTTP 대기 중에도 PostgreSQL 기기·ack·gate 쓰기가 끝나고 최신 상태가 발송을 막는다. */
@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class DispatchEligibilityConcurrencyTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("88888888-8888-4888-8888-888888888888");
    static final UUID OTHER = UUID.fromString("99999999-9999-4999-8999-999999999999");
    static final UUID GROUP = UUID.randomUUID();
    static final UUID SESSION = UUID.randomUUID();
    static final Instant NOW = Instant.parse("2026-09-12T03:00:00Z");
    static final AtomicReference<CountDownLatch> ENTERED = new AtomicReference<>();
    static final AtomicReference<CountDownLatch> RELEASE = new AtomicReference<>();
    static final List<Map<String, Object>> REQUESTS = new CopyOnWriteArrayList<>();
    static final HttpServer DATA = startData();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
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
    @Autowired DeviceService devices;
    @Autowired AckService ack;
    @Autowired DispatchService dispatch;
    @Autowired PlatformTransactionManager manager;
    @MockitoBean PushTransport transport;
    @MockitoBean Clock clock;
    @MockitoSpyBean DataClient data;
    final List<Boolean> lookupTransactions = new CopyOnWriteArrayList<>();

    @BeforeEach
    void setup() {
        store.update("TRUNCATE delivery_devices,deliveries,inbound_events,commands,device_tokens,"
                + "session_fences,legacy_session_fences,user_fences,settings,projections,result_ack,"
                + "result_bundle_manifests,templates,deeplinks,kinds CASCADE");
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true,active_migration_id=NULL");
        for (String kind : List.of("FRIEND_ACCEPTED", "BET_RESULT", "CHALLENGE_WINDOW_END")) {
            store.update("INSERT INTO kinds(id,quiet_policy) VALUES(?,'BYPASS')", kind);
            store.update("INSERT INTO templates(id,kind,locale,title,body) VALUES(?,?,'ko','알림','본문')",
                    kind + ".ko", kind);
        }
        reset(transport, clock);
        when(clock.instant()).thenReturn(NOW);
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
        register(USER, "original", "first");
        ENTERED.set(new CountDownLatch(1));
        RELEASE.set(new CountDownLatch(1));
        REQUESTS.clear();
        lookupTransactions.clear();
        doAnswer(invocation -> {
            lookupTransactions.add(TransactionSynchronizationManager.isActualTransactionActive());
            return invocation.callRealMethod();
        }).when(data).eligible(any(), anyString(), any(), any());
        doAnswer(invocation -> {
            lookupTransactions.add(TransactionSynchronizationManager.isActualTransactionActive());
            return invocation.callRealMethod();
        }).when(data).eligibleTest(any(), anyString(), any(), any(), any());
    }

    @Test
    void unrelatedRegistrationFinishesWhileDataIsStillWaiting() throws Exception {
        UUID id = enqueue("FRIEND_ACCEPTED", false);
        duringLookup(id, () -> register(OTHER, "other-device", "other"));
        verify(transport).send(eq("original"), any(), anyBoolean(), anyString());
        assertThat(state(id)).isEqualTo("SENT");
    }

    @ParameterizedTest
    @ValueSource(strings = {"delete", "transfer", "ack", "gate", "withdrawn", "kind"})
    void changesCommittedDuringTheLookupAreRecheckedBeforeSending(String change) throws Exception {
        UUID id = enqueue("ack".equals(change) ? "BET_RESULT" : "FRIEND_ACCEPTED", false);
        duringLookup(id, () -> {
            switch (change) {
                case "delete" -> devices.delete(USER, "original", null, 0L, "delete");
                case "transfer" -> register(OTHER, "original", "new-owner");
                case "ack" -> ack.command(USER, SESSION, "prepare", "hold");
                case "kind" -> store.update("UPDATE kinds SET enabled=false WHERE id='FRIEND_ACCEPTED'");
                case "gate" -> store.update("UPDATE dispatch_control SET enabled=false WHERE id=1");
                case "withdrawn" -> new TransactionTemplate(manager).executeWithoutResult(status -> {
                    store.lock("device-ownership");
                    store.update("UPDATE user_fences SET withdrawn=true WHERE user_id=?", USER);
                });
                default -> throw new IllegalArgumentException(change);
            }
        });
        verifyNoInteractions(transport);
        assertThat(state(id)).isIn("PENDING", "SUPPRESSED");
    }

    @ParameterizedTest
    @ValueSource(strings = {"member", "payload", "subject", "kind", "admin", "user"})
    void aChangedBundleMustFetchFreshDecisionsBeforeAnySend(String change) throws Exception {
        UUID id = enqueue("CHALLENGE_WINDOW_END", true);
        if ("user".equals(change)) {
            register(OTHER, "other-current-device", "other");
        }
        duringLookup(id, () -> new TransactionTemplate(manager).executeWithoutResult(status -> {
            store.lock("device-ownership");
            switch (change) {
                case "member" -> enqueue("CHALLENGE_WINDOW_END", true);
                case "payload" -> store.update(
                        "UPDATE deliveries SET payload='{\"changed\":true}'::jsonb WHERE id=?", id);
                case "subject" -> store.update("UPDATE deliveries SET subject_id=? WHERE id=?", SESSION.toString(), id);
                case "kind" -> store.update("UPDATE deliveries SET kind='FRIEND_ACCEPTED' WHERE id=?", id);
                case "admin" -> store.update("UPDATE deliveries SET admin_actor='member-1',created_at=? WHERE id=?",
                        Timestamp.from(NOW), id);
                case "user" -> store.update("UPDATE deliveries SET user_id=? WHERE id=?", OTHER, id);
                default -> throw new IllegalArgumentException(change);
            }
        }));
        verifyNoInteractions(transport);
        assertThat(state(id)).isEqualTo("PENDING");
        REQUESTS.clear();
        dispatch.dispatch(id);
        assertThat(REQUESTS).hasSize("member".equals(change) ? 2 : 1);
        if ("payload".equals(change)) {
            assertThat(Json.map(REQUESTS.get(0).get("params"))).containsEntry("changed", true);
        }
        if ("subject".equals(change)) {
            assertThat(REQUESTS.get(0)).containsEntry("subjectId", SESSION.toString());
        }
        if ("admin".equals(change)) {
            assertThat(REQUESTS.get(0)).containsEntry("adminTestRequestedAt", NOW.toString());
        }
        if ("user".equals(change)) {
            assertThat(REQUESTS.get(0)).containsEntry("userId", OTHER.toString());
        }
        if ("kind".equals(change)) {
            assertThat(REQUESTS.get(0)).containsEntry("kind", "FRIEND_ACCEPTED");
        }
        assertThat(lookupTransactions).isNotEmpty().containsOnly(false);
        verify(transport).send(eq("user".equals(change) ? "other-current-device" : "original"),
                any(), anyBoolean(), anyString());
    }

    @Test
    void aCallersTransactionIsSuspendedWhileDataIsWaiting() throws Exception {
        UUID id = enqueue("FRIEND_ACCEPTED", false);
        duringLookup(id, () -> assertThat(lookupTransactions).containsExactly(false), true);
    }

    private void duringLookup(UUID id, Runnable change) throws Exception {
        duringLookup(id, change, false);
    }

    private void duringLookup(UUID id, Runnable change, boolean outer) throws Exception {
        var workers = Executors.newFixedThreadPool(2);
        try {
            var sending = workers.submit(() -> {
                if (outer) {
                    new TransactionTemplate(manager).executeWithoutResult(status -> dispatch.dispatch(id));
                } else {
                    dispatch.dispatch(id);
                }
            });
            try {
                assertThat(ENTERED.get().await(5, TimeUnit.SECONDS)).isTrue();
                // 미래의 HTTP 응답을 먼저 풀어 성공시키지 않는다. 쓰기는 Data 대기 중에 완료돼야 한다.
                workers.submit(change).get(1200, TimeUnit.MILLISECONDS);
            } finally {
                RELEASE.get().countDown();
            }
            sending.get(5, TimeUnit.SECONDS);
            assertThat(lookupTransactions).isNotEmpty().containsOnly(false);
        } finally {
            workers.shutdown();
            assertThat(workers.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    private void register(UUID user, String token, String key) {
        devices.register(user, Map.of("deviceToken", token, "deviceBootstrap", key,
                "sessionEpoch", 1L, "authGeneration", 0L), key);
    }

    private UUID enqueue(String kind, boolean bundle) {
        UUID id = UUID.randomUUID();
        store.update("INSERT INTO deliveries(id,event_id,user_id,kind,subject_id,group_id,slot_at,payload,locale,"
                + "next_attempt_at) VALUES(?,?,?,?,?,?,?,'{}'::jsonb,'ko',?)", id, id.toString(), USER, kind,
                "BET_RESULT".equals(kind) ? SESSION.toString() : id.toString(), bundle ? GROUP : null,
                bundle ? Timestamp.from(NOW) : null, Timestamp.from(NOW));
        return id;
    }

    private String state(UUID id) {
        return store.one("SELECT status FROM deliveries WHERE id=?", id).get("status").toString();
    }

    private static HttpServer startData() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/internal/notifications/eligibility", exchange -> {
                REQUESTS.add(Json.map(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
                ENTERED.get().countDown();
                try {
                    RELEASE.get().await(8, TimeUnit.SECONDS);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
                byte[] response = "{\"eligible\":true}".getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, response.length);
                exchange.getResponseBody().write(response);
                exchange.close();
            });
            server.start();
            return server;
        } catch (IOException failure) {
            throw new IllegalStateException(failure);
        }
    }
}
