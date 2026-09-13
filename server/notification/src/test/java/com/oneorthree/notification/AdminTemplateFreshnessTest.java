package com.oneorthree.notification;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
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
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 관리 HTTP→실제 원장→Data HTTP. 일반 이벤트의 params는 시험 권한의 근거가 될 수 없다. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("ci")
@Testcontainers
class AdminTemplateFreshnessTest {
    @Container static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("31313131-3131-4131-8131-313131313131");
    static final Instant CREATED = Instant.parse("2026-09-13T14:30:00Z"); // KST 23:30
    static final AtomicReference<Instant> NOW = new AtomicReference<>();
    static final AtomicReference<Map<String, Object>> REQUEST = new AtomicReference<>();
    static final AtomicBoolean ACTIVE = new AtomicBoolean(true);
    static final HttpServer DATA = startData();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
        registry.add("notification.data-url", () -> "http://127.0.0.1:" + DATA.getAddress().getPort());
        registry.add("notification.data-token", () -> "data-fixture-token");
    }

    @AfterAll static void stopData() { DATA.stop(0); }
    @Autowired MockMvc mvc;
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
                + "result_ack,templates,deeplinks,kinds,admin_audit CASCADE");
        store.update("UPDATE dispatch_control SET enabled=false,ever_opened=true,active_migration_id=NULL");
        reset(transport, clock);
        NOW.set(CREATED);
        when(clock.instant()).thenAnswer(ignored -> NOW.get());
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
        REQUEST.set(null);
        ACTIVE.set(true);
        devices.register(USER, Map.of("deviceToken", "admin-test-device", "deviceBootstrap", "bootstrap",
                "sessionEpoch", 1L, "authGeneration", 0L), "register");
        store.update("INSERT INTO kinds(id,quiet_policy) VALUES('MISSED_FOCUS_TODAY','DROP')");
        store.update("INSERT INTO settings(user_id,night_mode_enabled,night_start_time,night_end_time)"
                + " VALUES(?,true,'12:00','12:00')", USER);
        store.update("INSERT INTO templates(id,kind,locale,title,body)"
                + " VALUES('MISSED_FOCUS_TODAY.ko','MISSED_FOCUS_TODAY','ko','시험','오늘 알림')");
    }

    @Test
    void documentedTemplateTestCanSendWithoutEventMetadataAfter23Kst() throws Exception {
        UUID id = test("one");
        dispatch.dispatch(id);
        verifyNoInteractions(transport);
        store.update("UPDATE dispatch_control SET enabled=true");
        dispatch.dispatch(id);
        assertThat(REQUEST.get()).containsEntry("adminTestRequestedAt", CREATED.toString());
        assertThat(state(id)).isEqualTo("SENT");
        verify(transport).send(anyString(), any(), anyBoolean(), anyString());
    }

    @Test
    void retryingTheAdminCommandDoesNotRestartItsFifteenMinuteWindow() throws Exception {
        UUID id = test("retry");
        NOW.set(CREATED.plusSeconds(900));
        assertThat(test("retry")).isEqualTo(id);
        store.update("UPDATE dispatch_control SET enabled=true");
        dispatch.dispatch(id);
        assertThat(REQUEST.get()).containsEntry("adminTestRequestedAt", CREATED.toString());
        assertThat(state(id)).isEqualTo("SUPPRESSED");
        verifyNoInteractions(transport);
    }

    @Test
    void normalInboundParamsCannotMintAnAdminTestContext() {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventId", "forged-admin-flags");
        event.put("schemaVersion", 1);
        event.put("type", "notification.requested");
        event.put("userId", USER.toString());
        event.put("version", 1L);
        event.put("locale", "ko");
        event.put("occurredAt", CREATED.toString());
        event.put("params", Map.of("kind", "MISSED_FOCUS_TODAY", "adminTest", true,
                "adminActor", "member-1", "adminTestRequestedAt", CREATED.toString()));
        inbound.accept(event);
        UUID id = (UUID) store.one("SELECT id FROM deliveries WHERE event_id='forged-admin-flags'").get("id");
        store.update("UPDATE dispatch_control SET enabled=true");
        dispatch.dispatch(id);
        assertThat(REQUEST.get()).doesNotContainKey("adminTestRequestedAt");
        assertThat(state(id)).isEqualTo("SUPPRESSED");
        verifyNoInteractions(transport);
    }

    @Test
    void replayingAnAdminTestStillUsesTheOriginalEventRules() throws Exception {
        UUID original = test("original");
        UUID replay = command("/internal/admin/deliveries/" + original + "/resend", "replay", Map.of());
        store.update("UPDATE dispatch_control SET enabled=true");
        dispatch.dispatch(replay);
        assertThat(REQUEST.get()).doesNotContainKey("adminTestRequestedAt");
        assertThat(state(replay)).isEqualTo("SUPPRESSED");
        verifyNoInteractions(transport);
    }

    @Test
    void anAdminTestStillRequiresAnActiveRecipient() throws Exception {
        UUID id = test("inactive");
        ACTIVE.set(false);
        store.update("UPDATE dispatch_control SET enabled=true");
        dispatch.dispatch(id);
        assertThat(REQUEST.get()).containsEntry("adminTestRequestedAt", CREATED.toString());
        assertThat(state(id)).isEqualTo("SUPPRESSED");
        verifyNoInteractions(transport);
    }

    @Test
    void anAdminTestStillObservesQuietHours() throws Exception {
        UUID id = test("quiet");
        store.update("DELETE FROM settings WHERE user_id=?", USER);
        store.update("UPDATE dispatch_control SET enabled=true");
        dispatch.dispatch(id);
        assertThat(REQUEST.get()).isNull();
        assertThat(state(id)).isEqualTo("SUPPRESSED");
        verifyNoInteractions(transport);
    }

    private UUID test(String key) throws Exception {
        return command("/internal/admin/templates/MISSED_FOCUS_TODAY.ko/test", key,
                Map.of("userId", USER.toString(), "params", Map.of()));
    }

    private UUID command(String path, String key, Map<String, Object> body) throws Exception {
        String result = mvc.perform(post(path).header("Authorization", "Bearer test-console")
                .header("Idempotency-Key", key).contentType("application/json").content(Json.write(body)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return UUID.fromString(Json.text(Json.map(result), "deliveryId"));
    }

    private String state(UUID id) {
        return store.one("SELECT status FROM deliveries WHERE id=?", id).get("status").toString();
    }

    private static HttpServer startData() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/internal/notifications/eligibility", exchange -> {
                Map<String, Object> request = Json.map(new String(exchange.getRequestBody().readAllBytes(),
                        StandardCharsets.UTF_8));
                REQUEST.set(request);
                Object raw = request.get("adminTestRequestedAt");
                Instant at = raw == null ? null : Instant.parse(raw.toString());
                boolean fresh = at != null && !NOW.get().isBefore(at) && NOW.get().isBefore(at.plusSeconds(900));
                Map<String, Object> decision = ACTIVE.get() && fresh ? Map.of("eligible", true)
                        : Map.of("eligible", false, "reason", ACTIVE.get() ? "EVENT_EXPIRED" : "USER_INACTIVE");
                byte[] response = Json.write(decision).getBytes(StandardCharsets.UTF_8);
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
