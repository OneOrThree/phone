package com.oneorthree.notification;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
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

/**
 * 원사건 만료(GROMO-893 ⑧)는 관리자 <b>템플릿 시험</b>에 적용하지 않고 <b>재전송</b>에는 적용한다 — 관리 HTTP → 실제 원장 →
 * Data HTTP 로 본다.
 *
 * <p>시험은 과거 사건의 params 를 복사해 넣을 수 있고 그러면 과거의 {@code expiresAt} 이 따라온다. 시험의 수명은 Data 가
 * {@code created_at} 부터 15분으로 잰다. 재전송은 원사건의 알림이므로 원사건이 만료됐으면 그대로 만료다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("ci")
@Testcontainers
class AdminTestExpiryTest {

    @Container static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("41414141-4141-4141-8141-414141414141");
    static final Instant CREATED = Instant.parse("2026-09-14T03:30:00Z");
    static final AtomicReference<Instant> NOW = new AtomicReference<>();
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
        devices.register(USER, Map.of("deviceToken", "admin-expiry-device", "deviceBootstrap", "bootstrap",
                "sessionEpoch", 1L, "authGeneration", 0L), "register");
        store.update("INSERT INTO kinds(id,quiet_policy) VALUES('MISSED_FOCUS_TODAY','DROP')");
        // 조용한 시간을 비워 둔다 — 시각과 무관하게 만료만 본다.
        store.update("INSERT INTO settings(user_id,night_mode_enabled,night_start_time,night_end_time)"
                + " VALUES(?,true,'12:00','12:00')", USER);
        store.update("INSERT INTO templates(id,kind,locale,title,body)"
                + " VALUES('MISSED_FOCUS_TODAY.ko','MISSED_FOCUS_TODAY','ko','시험','오늘 알림')");
    }

    @Test
    @DisplayName("과거 만료를 복사한 템플릿 시험도 15분 시험 창 안이면 발송된다")
    void aTemplateTestCopyingAPastExpiryIsSentWithinItsTestWindow() throws Exception {
        UUID id = test("copied-expiry", pastTiming());
        store.update("UPDATE dispatch_control SET enabled=true");

        dispatch.dispatch(id);

        assertThat(REQUEST.get()).containsEntry("adminTestRequestedAt", CREATED.toString());
        assertThat(row(id)).containsEntry("status", "SENT");
        verify(transport).send(anyString(), any(), anyBoolean(), anyString());
    }

    @Test
    @DisplayName("과거 만료를 복사한 템플릿 시험은 15분 시험 창이 지나면 Data 판정으로 억제된다")
    void aTemplateTestCopyingAPastExpiryIsSuppressedAfterItsTestWindow() throws Exception {
        UUID id = test("copied-expiry-late", pastTiming());
        NOW.set(CREATED.plusSeconds(900));
        store.update("UPDATE dispatch_control SET enabled=true");

        dispatch.dispatch(id);

        assertThat(REQUEST.get()).containsEntry("adminTestRequestedAt", CREATED.toString());
        assertThat(row(id)).containsEntry("status", "SUPPRESSED");
        verifyNoInteractions(transport);
    }

    @Test
    @DisplayName("만료된 원사건의 재전송은 원사건 만료를 그대로 따라 조회·발송 없이 끝난다")
    void aReplayOfAnExpiredOriginalStillFollowsTheOriginalExpiry() throws Exception {
        Map<String, Object> params = new LinkedHashMap<>(pastTiming());
        params.put("kind", "MISSED_FOCUS_TODAY");
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventId", "expired-original");
        event.put("schemaVersion", 1);
        event.put("type", "notification.requested");
        event.put("userId", USER.toString());
        event.put("version", 1L);
        event.put("locale", "ko");
        event.put("occurredAt", CREATED.toString());
        event.put("scheduledAt", CREATED.toString());
        event.put("params", params);
        inbound.accept(event);
        UUID original = (UUID) store.one("SELECT id FROM deliveries WHERE event_id='expired-original'").get("id");
        UUID replay = command("/internal/admin/deliveries/" + original + "/resend", "replay-expired", Map.of());
        store.update("UPDATE dispatch_control SET enabled=true");

        dispatch.dispatch(replay);

        assertThat(REQUEST.get()).isNull();
        assertThat(row(replay)).containsEntry("status", "SUPPRESSED").containsEntry("last_error", "EXPIRED");
        verifyNoInteractions(transport);
    }

    /** @return 하루 전 사건의 원시각·만료 — 시험·재전송 모두에 이미 지난 값 */
    private static Map<String, Object> pastTiming() {
        Instant occurred = CREATED.minusSeconds(86_400);
        return Map.of("dedupAt", occurred.toString(), "expiresAt", occurred.plusSeconds(7_200).toString());
    }

    private UUID test(String key, Map<String, Object> params) throws Exception {
        return command("/internal/admin/templates/MISSED_FOCUS_TODAY.ko/test", key,
                Map.of("userId", USER.toString(), "params", params));
    }

    private UUID command(String path, String key, Map<String, Object> body) throws Exception {
        String result = mvc.perform(post(path).header("Authorization", "Bearer test-console")
                .header("Idempotency-Key", key).contentType("application/json").content(Json.write(body)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return UUID.fromString(Json.text(Json.map(result), "deliveryId"));
    }

    private Map<String, Object> row(UUID id) {
        return store.one("SELECT status,last_error FROM deliveries WHERE id=?", id);
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
                Map<String, Object> decision = fresh ? Map.of("eligible", true)
                        : Map.of("eligible", false, "reason", "EVENT_EXPIRED");
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
