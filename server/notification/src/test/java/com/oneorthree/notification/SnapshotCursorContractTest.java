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
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실제 Data HTTP 페이지의 커서 오류가 사용자 tombstone을 건너뛰지 않도록 검증한다. */
@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class SnapshotCursorContractTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID FIRST = UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    static final UUID SECOND = UUID.fromString("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    static final ConcurrentLinkedQueue<String> RESPONSES = new ConcurrentLinkedQueue<>();
    static final List<String> QUERIES = Collections.synchronizedList(new ArrayList<>());
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
    @Autowired DeviceService devices;
    @Autowired SnapshotReconciler snapshots;
    @MockitoBean PushTransport transport;

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE commands,device_tokens,session_fences,legacy_session_fences,"
                + "user_fences,projections CASCADE");
        RESPONSES.clear();
        QUERIES.clear();
        devices.register(SECOND, Map.of("deviceToken", "cursor-device", "deviceBootstrap", "bootstrap",
                "sessionEpoch", 1L, "authGeneration", 0L), "register");
    }

    @ParameterizedTest
    @ValueSource(strings = {"cccccccc-cccc-4ccc-8ccc-cccccccccccc", "99999999-9999-4999-8999-999999999999",
            "not-a-uuid", "a-a-a-a-a", ""})
    void invalidCursorRejectsThePageAndRetryStillAppliesTheSkippedWithdrawal(String cursor) {
        rejectAndRetry(page(List.of(row(FIRST, false)), cursor));
    }

    @Test
    void missingCursorIsNotMistakenForTheLastPage() {
        rejectAndRetry(Map.of("items", List.of(row(FIRST, false))));
    }

    @Test
    void nonTextCursorIsAContractFailure() {
        rejectAndRetry(page(List.of(row(FIRST, false)), 42));
    }

    @Test
    void matchingCursorStillCannotGoBackwardsOnTheNextPage() {
        RESPONSES.add(Json.write(page(List.of(row(FIRST, false)), FIRST.toString())));
        RESPONSES.add(Json.write(page(List.of(row(FIRST, false)), FIRST.toString())));
        assertThatThrownBy(snapshots::reconcile).isInstanceOf(NotificationFailure.class)
                .satisfies(error -> assertThat(((NotificationFailure) error).status()).isEqualTo(502));
        assertThat(QUERIES).hasSize(2);
    }

    @Test
    void validUppercaseUuidCursorReachesTheNextUserAndExplicitNullEndsTheScan() {
        successfulRetry(FIRST.toString().toUpperCase(java.util.Locale.ROOT));
    }

    @Test
    void anEmptyFinalPageIsValidButAnEmptyPageCannotAdvance() {
        RESPONSES.add(Json.write(page(List.of(), FIRST.toString())));
        assertThatThrownBy(snapshots::reconcile).isInstanceOf(NotificationFailure.class);
        QUERIES.clear();
        RESPONSES.add(Json.write(page(List.of(), null)));
        snapshots.reconcile();
        assertThat(QUERIES).hasSize(1);
    }

    private void rejectAndRetry(Map<String, Object> invalid) {
        RESPONSES.add(Json.write(invalid));
        assertThatThrownBy(snapshots::reconcile).isInstanceOf(NotificationFailure.class)
                .satisfies(error -> assertThat(((NotificationFailure) error).status()).isEqualTo(502));
        assertThat(QUERIES).hasSize(1);
        assertThat(store.rows("SELECT * FROM projections WHERE user_id=?", FIRST)).isEmpty();
        assertThat(store.one("SELECT active FROM device_tokens WHERE user_id=?", SECOND))
                .containsEntry("active", true);
        successfulRetry(FIRST.toString());
    }

    private void successfulRetry(String firstCursor) {
        QUERIES.clear();
        RESPONSES.add(Json.write(page(List.of(row(FIRST, false)), firstCursor)));
        RESPONSES.add(Json.write(page(List.of(row(SECOND, true)), null)));
        snapshots.reconcile();
        assertThat(QUERIES).hasSize(2);
        assertThat(QUERIES.get(1).toLowerCase(java.util.Locale.ROOT)).contains("cursor=" + FIRST);
        assertThat(store.one("SELECT active FROM device_tokens WHERE user_id=?", SECOND))
                .containsEntry("active", false);
        assertThat(store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", SECOND))
                .containsEntry("withdrawn", true);
        assertThat(store.rows("SELECT * FROM projections WHERE user_id=?", FIRST)).hasSize(1);
    }

    private static Map<String, Object> row(UUID user, boolean withdrawn) {
        return Map.of("userId", user.toString(), "authGeneration", withdrawn ? 1L : 0L,
                "withdrawn", withdrawn, "version", 1L);
    }

    private static Map<String, Object> page(List<?> items, Object cursor) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("nextCursor", cursor);
        return result;
    }

    private static HttpServer startData() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/internal/users/notification-snapshot", exchange -> {
                QUERIES.add(exchange.getRequestURI().getQuery());
                String next = RESPONSES.poll();
                byte[] response = (next == null ? "{\"items\":[],\"nextCursor\":null}" : next)
                        .getBytes(StandardCharsets.UTF_8);
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
