package com.oneorthree.phone.group;

import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.group.service.FirstIslandArrivalCapiSender;
import com.oneorthree.phone.internal.dto.IntroArrivalRequest;
import com.oneorthree.phone.internal.service.IntroVoyageService;
import com.oneorthree.phone.internal.service.TelescopeService;
import com.oneorthree.phone.outbox.support.OutboxEnvelopeCodec;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;

/** 실제 전송기 빈이 실제 행을 읽어 로컬 스텁 HTTP 서버로 보낸다 — 판정 메서드는 건드리지 않는다. */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class FirstIslandArrivalCapiSenderIntegrationTest {

    private static final HttpServer STUB = start();
    private static final List<String> BODIES = new CopyOnWriteArrayList<>();
    private static final List<String> PATHS = new CopyOnWriteArrayList<>();
    private static volatile int stubStatus = 200;
    private static volatile String stubBody = "{\"events_received\":2}";

    private static HttpServer start() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                BODIES.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                PATHS.add(exchange.getRequestURI().toString());
                byte[] out = stubBody.getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(stubStatus, out.length);
                exchange.getResponseBody().write(out);
                exchange.close();
            });
            server.start();
            return server;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @AfterAll
    static void stop() {
        STUB.stop(0);
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("meta.capi.enabled", () -> "true");
        registry.add("meta.capi.dataset-id", () -> "1234567890");
        registry.add("meta.capi.access-token", () -> "secret-token");
        registry.add("meta.capi.api-version", () -> "v24.0");
        registry.add("meta.capi.test-event-code", () -> "TEST777");
        registry.add("meta.capi.base-url", () -> "http://127.0.0.1:" + STUB.getAddress().getPort());
    }

    @Autowired
    FirstIslandArrivalCapiSender sender;
    @Autowired
    IntroVoyageService intro;
    @Autowired
    TelescopeService telescope;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;

    @BeforeEach
    void reset() {
        jdbc.update("update islands set deleted_at = now() where deleted_at is null");
        jdbc.update("delete from first_island_arrivals");
        BODIES.clear();
        PATHS.clear();
        stubStatus = 200;
        stubBody = "{\"events_received\":2}";
    }

    private UUID pendingRow() {
        UUID user = jwt.extractUserId(auth.guestSession(UUID.randomUUID().toString()).accessToken());
        List<String> ext = new ArrayList<>(Collections.nCopies(16, ""));
        ext.set(0, "a2");
        ext.set(4, "14");
        intro.arrive(user, telescope.list(user).items().get(0).islandId(), UUID.randomUUID(),
                new IntroArrivalRequest(new IntroArrivalRequest.Meta("anon-xyz", false, ext), "198.51.100.9"));
        return user;
    }

    private Map<String, Object> row(UUID user) {
        return jdbc.queryForMap("select * from first_island_arrivals where user_id=?", user);
    }

    @Test
    @DisplayName("200 이면 SENT 로 바뀌고 매칭 값이 지워지며 본문이 계약 모양이다")
    void sentClearsIdentifiersAndPostsContractShape() throws Exception {
        UUID user = pendingRow();
        var before = row(user);
        sender.sendDue();

        var after = row(user);
        assertThat(after.get("send_status")).isEqualTo("SENT");
        assertThat(after.get("sent_at")).isNotNull();
        assertThat(after.get("anon_id")).isNull();
        assertThat(after.get("client_ip")).isNull();
        assertThat(after.get("extinfo")).isNull();
        assertThat(PATHS).containsExactly("/v24.0/1234567890/events");
        JsonNode root = OutboxEnvelopeCodec.fromJson(BODIES.get(0), JsonNode.class);
        assertThat(root.path("access_token").asText()).isEqualTo("secret-token");
        assertThat(root.path("test_event_code").asText()).isEqualTo("TEST777");
        // 같은 사건을 맞춤 이름과 표준 「등록 완료」 두 이름으로 보낸다(GROMO-2755). 나머지 값은 둘이 같다.
        assertThat(root.path("data").size()).isEqualTo(2);
        assertThat(root.path("data").get(0).path("event_name").asText()).isEqualTo("first_island_arrival");
        assertThat(root.path("data").get(1).path("event_name").asText()).isEqualTo("fb_mobile_complete_registration");
        for (JsonNode e : root.path("data")) {
            assertThat(e.path("event_time").asLong())
                    .isEqualTo(((Timestamp) before.get("occurred_at")).toInstant().getEpochSecond());
            assertThat(e.path("event_id").asText()).isEqualTo(before.get("event_id").toString());
            assertThat(e.path("action_source").asText()).isEqualTo("app");
            assertThat(e.path("user_data").path("anon_id").asText()).isEqualTo("anon-xyz");
            assertThat(e.path("user_data").path("client_ip_address").asText()).isEqualTo("198.51.100.9");
            assertThat(e.path("app_data").path("advertiser_tracking_enabled").asInt()).isZero();
            assertThat(e.path("app_data").path("application_tracking_enabled").asInt()).isEqualTo(1);
            assertThat(e.path("app_data").path("extinfo").size()).isEqualTo(16);
            assertThat(e.path("app_data").path("extinfo").get(0).asText()).isEqualTo("a2");
        }
        // 종료 상태는 다시 보내지 않는다.
        sender.sendDue();
        assertThat(BODIES).hasSize(1);
    }

    @Test
    @DisplayName("200 이어도 보낸 두 이름 중 하나만 접수되면 SENT 가 아니라 FAILED 로 남는다")
    void partialReceiptFails() {
        UUID user = pendingRow();
        stubBody = "{\"events_received\":1}";
        sender.sendDue();
        var after = row(user);
        assertThat(after.get("send_status")).isEqualTo("FAILED");
        assertThat(after.get("sent_at")).isNull();
        assertThat(after.get("anon_id")).isNull();
    }

    @Test
    @DisplayName("5xx 이면 PENDING 으로 남아 시도 횟수가 오르고 다음 시도가 뒤로 밀린다")
    void serverErrorBacksOff() {
        UUID user = pendingRow();
        stubStatus = 500;
        stubBody = "{}";
        Instant start = Instant.now();
        sender.sendDue();
        var after = row(user);
        assertThat(after.get("send_status")).isEqualTo("PENDING");
        assertThat(after.get("attempts")).isEqualTo(1);
        assertThat(((Timestamp) after.get("next_attempt_at")).toInstant()).isAfter(start.plusSeconds(30));
        assertThat(after.get("anon_id")).isEqualTo("anon-xyz");
        assertThat((String) after.get("last_error")).isEqualTo("HTTP 500");
        // 아직 때가 아니므로 다시 보내지 않는다.
        sender.sendDue();
        assertThat(BODIES).hasSize(1);
    }

    @Test
    @DisplayName("4xx 이면 FAILED 로 닫히고 오류 코드·추적 ID 만 남기며 매칭 값을 지운다")
    void clientErrorFails() {
        UUID user = pendingRow();
        stubStatus = 400;
        stubBody = "{\"error\":{\"code\":100,\"message\":\"bad anon_id anon-xyz\",\"fbtrace_id\":\"AbC\"}}";
        sender.sendDue();
        var after = row(user);
        assertThat(after.get("send_status")).isEqualTo("FAILED");
        assertThat((String) after.get("last_error")).isEqualTo("HTTP 400 code=100 fbtrace_id=AbC");
        assertThat(after.get("anon_id")).isNull();
        assertThat(after.get("extinfo")).isNull();
    }

    @Test
    @DisplayName("7일에서 1시간을 뺀 시간을 넘긴 사건은 요청 없이 EXPIRED 가 된다")
    void staleEventExpiresWithoutHttp() {
        UUID user = pendingRow();
        jdbc.update("update first_island_arrivals set occurred_at = now() - interval '6 days 23 hours 30 minutes' "
                + "where user_id=?", user);
        sender.sendDue();
        assertThat(BODIES).isEmpty();
        var after = row(user);
        assertThat(after.get("send_status")).isEqualTo("EXPIRED");
        assertThat(after.get("anon_id")).isNull();
        assertThat(after.get("client_ip")).isNull();
    }
}
