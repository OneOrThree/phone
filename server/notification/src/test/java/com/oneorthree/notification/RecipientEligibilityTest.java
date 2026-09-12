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
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 탈퇴 투영이 지연돼도 실제 Data HTTP 판정으로 모든 종류의 수신자 상태를 재확인한다. */
@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class RecipientEligibilityTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("77777777-7777-4777-8777-777777777777");
    static final Instant NOW = Instant.parse("2026-09-12T03:00:00Z");
    static final AtomicInteger RESPONSE_STATUS = new AtomicInteger(200);
    static final AtomicReference<String> RESPONSE = new AtomicReference<>();
    static final AtomicReference<Map<String, Object>> REQUEST = new AtomicReference<>();
    static final HttpServer DATA = startData();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
        registry.add("notification.data-url", () -> "http://127.0.0.1:" + DATA.getAddress().getPort());
        registry.add("notification.data-token", () -> "data-fixture-token");
    }

    @AfterAll
    static void stopData() {
        DATA.stop(0);
    }

    @Autowired Store store;
    @Autowired DeviceService devices;
    @Autowired InboundService inbound;
    @Autowired DispatchService dispatch;
    @MockitoBean PushTransport transport;
    @MockitoBean Clock clock;

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE delivery_devices,deliveries,inbound_events,commands,device_tokens,"
                + "session_fences,legacy_session_fences,user_fences,settings,projections,"
                + "result_ack,templates,deeplinks,kinds CASCADE");
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true,active_migration_id=NULL");
        reset(transport, clock);
        when(clock.instant()).thenReturn(NOW);
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
        RESPONSE_STATUS.set(200);
        RESPONSE.set("{\"eligible\":true}");
        REQUEST.set(null);
        devices.register(USER, Map.of("deviceToken", "still-local-active", "deviceBootstrap", "bootstrap",
                "sessionEpoch", 1L, "authGeneration", 0L), "register");
    }

    @ParameterizedTest
    @ValueSource(strings = {"FRIEND_ACCEPTED", "LEAGUE_WEEKLY_RESULT", "LEAGUE_DEADLINE",
            "LEAGUE_DEADLINE_D1", "LEAGUE_RELEGATION_WARNING", "LEAGUE_RELEGATION_WARNING_EVENING",
            "LEAGUE_FINAL_DEADLINE", "INACTIVE_RETURN", "MISSED_FOCUS_TODAY", "STREAK_AT_RISK"})
    void delayedWithdrawalProjectionCannotAllowDeliveryToAnInactiveRecipient(String kind) {
        UUID id = enqueue(kind);
        // Data에서는 탈퇴가 끝났지만 auth.generation.bumped/user.withdrawn 투영은 아직 도착하지 않았다.
        RESPONSE.set("{\"eligible\":false,\"reason\":\"USER_INACTIVE\"}");
        assertThat(store.one("SELECT active FROM device_tokens WHERE user_id=?", USER))
                .containsEntry("active", true);
        assertThat(store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", USER))
                .containsEntry("withdrawn", false);
        dispatch.dispatch(id);
        verifyNoInteractions(transport);
        assertThat(REQUEST.get()).containsEntry("userId", USER.toString()).containsEntry("kind", kind);
        assertThat(state(id)).isEqualTo("SUPPRESSED");
    }

    @ParameterizedTest
    @ValueSource(strings = {"FRIEND_ACCEPTED", "LEAGUE_WEEKLY_RESULT", "INACTIVE_RETURN"})
    void activeRecipientsStillReceiveKindsWithoutSubjectStateChecks(String kind) {
        UUID id = enqueue(kind);
        dispatch.dispatch(id);
        assertThat(REQUEST.get()).containsEntry("userId", USER.toString()).containsEntry("kind", kind);
        verify(transport).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(state(id)).isEqualTo("SENT");
    }

    @ParameterizedTest
    @ValueSource(strings = {"UNAVAILABLE", "{}", "null", "{\"eligible\":null}"})
    void anUnavailableRecipientDecisionPreservesTheDeliveryForRetry(String response) {
        UUID id = enqueue("FRIEND_ACCEPTED");
        RESPONSE.set(response);
        RESPONSE_STATUS.set("UNAVAILABLE".equals(response) ? 503 : 200);
        assertThatThrownBy(() -> dispatch.dispatch(id)).isInstanceOf(RuntimeException.class);
        verifyNoInteractions(transport);
        assertThat(state(id)).isEqualTo("PENDING");
        RESPONSE_STATUS.set(200);
        RESPONSE.set("{\"eligible\":true}");
        dispatch.dispatch(id);
        verify(transport).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(state(id)).isEqualTo("SENT");
    }

    @Test
    void aLateEnvelopePreservesOriginalTimingAtTheDataBoundary() {
        Map<String, Object> timing = Map.of("kind", "LEAGUE_FINAL_DEADLINE",
                "dedupAt", "2026-09-06T13:00:00Z", "expiresAt", "2026-09-06T15:00:00Z");
        UUID id = enqueue("LEAGUE_FINAL_DEADLINE", timing);
        RESPONSE.set("{\"eligible\":false,\"reason\":\"EVENT_EXPIRED\"}");
        dispatch.dispatch(id);
        // 봉투 수신 시각이 더 늦어도 저장·조회 경계에서 원시각과 만료를 새 시각으로 바꾸지 않는다.
        assertThat(REQUEST.get().get("params")).isEqualTo(timing);
        assertThat(Json.map(store.one("SELECT payload FROM deliveries WHERE id=?", id)
                .get("payload").toString())).isEqualTo(timing);
        verifyNoInteractions(transport);
        assertThat(state(id)).isEqualTo("SUPPRESSED");
    }

    @Test
    void runtimePayloadExpansionFailsTheDeliveryWithoutInvalidatingItsDevice() {
        UUID id = enqueue("FRIEND_ACCEPTED", Map.of("kind", "FRIEND_ACCEPTED", "content", "한".repeat(1500)));
        store.update("UPDATE templates SET body='{content}' WHERE kind='FRIEND_ACCEPTED'");
        dispatch.dispatch(id);
        assertThat(store.one("SELECT status,last_error FROM deliveries WHERE id=?", id))
                .containsEntry("status", "FAILED").containsEntry("last_error", "FCM_PAYLOAD_TOO_LARGE");
        assertThat(store.one("SELECT active,transport_invalid FROM device_tokens WHERE user_id=?", USER))
                .containsEntry("active", true).containsEntry("transport_invalid", false);
        verifyNoInteractions(transport);
        dispatch.dispatch(id);
        verifyNoInteractions(transport);
    }

    private UUID enqueue(String kind) {
        return enqueue(kind, Map.of("kind", kind));
    }

    private UUID enqueue(String kind, Map<String, Object> params) {
        store.update("INSERT INTO kinds(id,quiet_policy,eligibility_required) VALUES(?,'BYPASS',false)", kind);
        store.update("INSERT INTO templates(id,kind,locale,title,body) VALUES(?,?,'ko','알림','알림 본문')",
                kind + ".ko", kind);
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventId", "recipient-check");
        event.put("schemaVersion", 1);
        event.put("type", "notification.requested");
        event.put("userId", USER.toString());
        event.put("version", 1L);
        event.put("locale", "ko");
        event.put("occurredAt", NOW.toString());
        event.put("scheduledAt", NOW.toString());
        event.put("params", params);
        inbound.accept(event);
        return (UUID) store.one("SELECT id FROM deliveries WHERE event_id='recipient-check'").get("id");
    }

    private String state(UUID id) {
        return store.one("SELECT status FROM deliveries WHERE id=?", id).get("status").toString();
    }

    private static HttpServer startData() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/internal/notifications/eligibility", exchange -> {
                REQUEST.set(Json.map(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
                byte[] response = RESPONSE.get().getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(RESPONSE_STATUS.get(), response.length);
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
