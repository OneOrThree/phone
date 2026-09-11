package com.oneorthree.notification;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 콘솔 관리 표면. 실제 HTTP·실제 PG 로 돈다 — 서비스 직접 호출로는 토큰·행위자 검사를 못 본다. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("ci")
@Testcontainers
class AdminApiTest {

    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("22222222-2222-4222-8222-222222222222");
    static final Instant DAY = Instant.parse("2026-09-11T03:00:00Z");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired Store store;
    @Autowired DeviceService devices;
    @Autowired AckService ack;
    @Autowired DispatchService dispatch;
    @MockitoBean PushTransport transport;
    @MockitoBean DataClient data;
    @MockitoBean Clock clock;

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE delivery_devices,deliveries,inbound_events,commands,device_tokens,"
                + "session_fences,legacy_session_fences,"
                + "user_fences,settings,projections,result_ack,templates,deeplinks,kinds,jobs,job_runs,"
                + "admin_audit,imports,migration_state CASCADE");
        store.update("UPDATE dispatch_control SET enabled=false,ever_opened=false,active_migration_id=NULL");
        store.update("INSERT INTO kinds(id,quiet_policy) VALUES('BET_RESULT','BYPASS')");
        store.update("INSERT INTO templates(id,kind,locale,title,body)"
                + " VALUES('BET_RESULT.ko','BET_RESULT','ko','결과','내기 {count}건')");
        reset(transport, data, clock);
        when(clock.instant()).thenReturn(DAY);
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        when(data.eligible(any(), anyString(), any(), any())).thenReturn(true);
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
    }

    @Test
    void consoleTokenAndActorAreBothRequiredAndEveryReadIsAudited() throws Exception {
        mvc.perform(MockMvcRequestBuilders.get("/internal/admin/templates")
                .header("Authorization", "Bearer test-console")).andExpect(status(403));
        mvc.perform(MockMvcRequestBuilders.get("/internal/admin/templates")
                .header("Authorization", "Bearer test-console").header("X-Console-Actor", "member-9"))
                .andExpect(status(403));
        // 콘솔이 아닌 caller 는 경로 자체가 막힌다(ServiceAuth 허용목록).
        mvc.perform(MockMvcRequestBuilders.get("/internal/admin/templates")
                .header("Authorization", "Bearer test-data").header("X-Console-Actor", "member-1"))
                .andExpect(status(403));
        assertThat(store.rows("SELECT * FROM admin_audit")).isEmpty();
        read("/internal/admin/templates");
        assertThat(store.one("SELECT actor,action FROM admin_audit ORDER BY id DESC LIMIT 1"))
                .containsEntry("actor", "member-1").containsEntry("action", "templates.list");
    }

    @Test
    void cursorPagingCoversEveryRowOnceAndCapsLimit() throws Exception {
        store.update("DELETE FROM templates");
        for (String kind : List.of("AAA", "BBB", "CCC")) {
            store.update("INSERT INTO kinds(id) VALUES(?)", kind);
            store.update("INSERT INTO templates(id,kind,locale,body) VALUES(?,?,'ko','본문')", kind + ".ko", kind);
        }
        assertThat(code(read("/internal/admin/templates?limit=101"))).isEqualTo("INVALID_LIMIT");
        assertThat(code(read("/internal/admin/templates?limit=0"))).isEqualTo("INVALID_LIMIT");
        Map<String, Object> first = body(read("/internal/admin/templates?limit=2"));
        assertThat(first.get("nextCursor")).isEqualTo("BBB.ko");
        Map<String, Object> second = body(read("/internal/admin/templates?limit=2&cursor="
                + first.get("nextCursor")));
        List<String> seen = new java.util.ArrayList<>(ids(first));
        seen.addAll(ids(second));
        // 장 경계에서 한 건도 빠지거나 겹치지 않는다.
        assertThat(seen).containsExactly("AAA.ko", "BBB.ko", "CCC.ko");
        assertThat(second.get("nextCursor")).isNull();
    }

    @Test
    void deliveryListExposesParameterNamesButNeverValuesOrDeviceTokens() throws Exception {
        devices.register(USER, Map.of("deviceToken", "secret-fcm-token", "deviceBootstrap", "b", "sessionEpoch", 1),
                "reg");
        store.update("INSERT INTO deliveries(id,event_id,user_id,kind,payload,locale) "
                + "VALUES(?,'e1',?,'BET_RESULT','{\"count\":1,\"displayName\":\"홍길동\"}'::jsonb,'ko')",
                UUID.randomUUID(), USER);
        MvcResult result = read("/internal/admin/deliveries").andReturn();
        String json = result.getResponse().getContentAsString();
        assertThat(json).doesNotContain("홍길동").doesNotContain("secret-fcm-token");
        Map<String, Object> item = Json.map(((List<?>) body(result).get("items")).get(0));
        assertThat(item.get("paramKeys")).isEqualTo(List.of("count", "displayName"));
        assertThat(item).containsEntry("kind", "BET_RESULT").containsEntry("status", "PENDING")
                .doesNotContainKey("payload");
        assertThat(code(read("/internal/admin/deliveries?status=DROPPED"))).isEqualTo("INVALID_STATUS");
    }

    @Test
    void templateWriteIsRejectedUnlessItActuallyRenders() throws Exception {
        Map<String, Object> broken = template("내기 {count건");
        assertThat(code(put("/internal/admin/templates/BET_RESULT.ko", "t1", broken)))
                .isEqualTo("INVALID_TEMPLATE_SYNTAX");
        Map<String, Object> missing = template("내기 {count}건 · {missing}");
        assertThat(code(put("/internal/admin/templates/BET_RESULT.ko", "t2", missing)))
                .isEqualTo("TEMPLATE_ARGUMENT_MISSING");
        Map<String, Object> mismatched = template("내기 {count}건");
        mismatched.put("locale", "en");
        assertThat(code(put("/internal/admin/templates/BET_RESULT.ko", "t3", mismatched)))
                .isEqualTo("TEMPLATE_ID_MISMATCH");
        mismatched.put("locale", "de");
        assertThat(code(put("/internal/admin/templates/BET_RESULT.de", "t4", mismatched)))
                .isEqualTo("INVALID_LOCALE");
        // 문법·인자·식별자를 모두 통과한 것만 실제로 저장된다.
        assertThat(body(put("/internal/admin/templates/BET_RESULT.ko", "t5", template("내기 {count}건 확정")))
                .get("version")).isEqualTo(2);
        assertThat(store.one("SELECT body FROM templates WHERE id='BET_RESULT.ko'").get("body"))
                .isEqualTo("내기 {count}건 확정");
    }

    @Test
    void dataOwnedJobsAreRefusedAndNotificationJobsValidateCron() throws Exception {
        store.update("INSERT INTO jobs(id,owner,cron) VALUES('league-weekly','DATA','0 0 7 * * MON'),"
                + "('bundle-flush','NOTIFICATION','0 */5 * * * *')");
        Map<String, Object> change = new LinkedHashMap<>(Map.of("enabled", true, "cron", "0 0 * * * *",
                "config", Map.of("batch", 25)));
        assertThat(code(put("/internal/admin/jobs/league-weekly", "j1", change))).isEqualTo("JOB_OWNED_BY_DATA");
        assertThat(store.one("SELECT cron,enabled FROM jobs WHERE id='league-weekly'"))
                .containsEntry("cron", "0 0 7 * * MON").containsEntry("enabled", false);
        Map<String, Object> broken = new LinkedHashMap<>(change);
        broken.put("cron", "every five minutes");
        assertThat(code(put("/internal/admin/jobs/bundle-flush", "j2", broken))).isEqualTo("INVALID_CRON");
        assertThat(body(put("/internal/admin/jobs/bundle-flush", "j3", change))).containsEntry("enabled", true);
        assertThat(store.one("SELECT cron FROM jobs WHERE id='bundle-flush'")).containsEntry("cron", "0 0 * * * *");
        assertThat(code(put("/internal/admin/deliveries/anything", "j4", change)))
                .isEqualTo("UNKNOWN_ADMIN_RESOURCE");
    }

    @Test
    void previewRendersWithoutStoringAndUsesTheDeeplinkRegistry() throws Exception {
        store.update("INSERT INTO deeplinks(id,url_template,data_template)"
                + " VALUES('BET_RESULT','gromo://bet/{count}','{\"screen\":\"bet-{count}\"}'::jsonb)");
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("params", Map.of("count", 3));
        request.put("body", "초안 {count}건");
        Map<String, Object> preview = body(post("/internal/admin/templates/BET_RESULT.ko/preview", null, request));
        assertThat(preview).containsEntry("body", "초안 3건").containsEntry("title", "결과");
        assertThat(Json.map(preview.get("data"))).containsEntry("link", "gromo://bet/3")
                .containsEntry("screen", "bet-3");
        // 미리보기는 저장하지 않는다.
        assertThat(store.one("SELECT body FROM templates WHERE id='BET_RESULT.ko'").get("body"))
                .isEqualTo("내기 {count}건");
    }

    @Test
    void templateTestOnlyQueuesWhileTheGateIsClosed() throws Exception {
        devices.register(USER, Map.of("deviceToken", "device", "deviceBootstrap", "b", "sessionEpoch", 1), "reg");
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("userId", USER.toString());
        request.put("params", Map.of("count", 2));
        Map<String, Object> queued = body(post("/internal/admin/templates/BET_RESULT.ko/test", "x1", request));
        assertThat(queued).containsEntry("status", "PENDING").containsEntry("dispatchEnabled", false);
        verifyNoInteractions(transport);
        UUID id = UUID.fromString(queued.get("deliveryId").toString());
        Map<String, Object> row = store.one("SELECT * FROM deliveries WHERE id=?", id);
        assertThat(row).containsEntry("admin_actor", "member-1").containsEntry("status", "PENDING");
        assertThat(Json.map(row.get("payload").toString())).containsEntry("adminTest", true);
        // 게이트가 닫힌 동안에는 공통 발송 경로도 아무것도 내보내지 않는다.
        dispatch.dispatch(id);
        verifyNoInteractions(transport);
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true");
        dispatch.dispatch(id);
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", id)).containsEntry("status", "SENT");
    }

    @Test
    void resendKeepsTheOriginalRowAndTheSubjectThatGovernsResultAck() throws Exception {
        devices.register(USER, Map.of("deviceToken", "device", "deviceBootstrap", "b", "sessionEpoch", 1), "reg");
        UUID session = UUID.randomUUID();
        UUID origin = UUID.randomUUID();
        store.update("INSERT INTO deliveries(id,event_id,user_id,kind,subject_id,payload,locale,status,sent_at)"
                + " VALUES(?,'origin-event',?,'BET_RESULT',?,'{\"count\":1}'::jsonb,'ko','SENT',?)",
                origin, USER, session.toString(), java.sql.Timestamp.from(DAY));
        Map<String, Object> resent = body(post("/internal/admin/deliveries/" + origin + "/resend", "r1", Map.of()));
        UUID copy = UUID.fromString(resent.get("deliveryId").toString());
        assertThat(copy).isNotEqualTo(origin);
        // 원본은 그대로 남는다.
        assertThat(store.one("SELECT status,event_id FROM deliveries WHERE id=?", origin))
                .containsEntry("status", "SENT").containsEntry("event_id", "origin-event");
        Map<String, Object> row = store.one("SELECT * FROM deliveries WHERE id=?", copy);
        assertThat(row).containsEntry("subject_id", session.toString()).containsEntry("admin_actor", "member-1")
                .containsEntry("replay_of", origin).containsEntry("status", "PENDING");
        assertThat(row.get("event_id").toString()).startsWith("admin:").isNotEqualTo("origin-event");
        assertThat(row.get("slot_at")).isNull();
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true");
        // subject 를 보존했으므로 결과 ack 억제가 재전송에도 그대로 걸린다.
        ack.command(USER, session, "prepare", "hold");
        dispatch.dispatch(copy);
        verifyNoInteractions(transport);
        ack.command(USER, session, "commit", "confirm");
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", copy))
                .containsEntry("status", "SUPPRESSED");
    }

    @Test
    void writesNeedAnIdempotencyKeyAndReplayIsSafe() throws Exception {
        Map<String, Object> change = template("내기 {count}건 v2");
        assertThat(code(put("/internal/admin/templates/BET_RESULT.ko", null, change)))
                .isEqualTo("IDEMPOTENCY_KEY_REQUIRED");
        assertThat(body(put("/internal/admin/templates/BET_RESULT.ko", "k1", change)).get("version")).isEqualTo(2);
        assertThat(body(put("/internal/admin/templates/BET_RESULT.ko", "k1", change)).get("version")).isEqualTo(2);
        assertThat(store.one("SELECT version FROM templates WHERE id='BET_RESULT.ko'"))
                .containsEntry("version", 2L);
        assertThat(code(put("/internal/admin/templates/BET_RESULT.ko", "k1", template("다른 본문 {count}"))))
                .isEqualTo("IDEMPOTENCY_KEY_CONFLICT");
    }

    /** 구 AT 롤아웃 창(generation-required=false)에서는 최초 게이트 개방을 허용하지 않는다(root 운영 제약). */
    @Test
    void gateOpenIsRefusedWhileTheLegacyAuthGenerationWindowIsOpen() throws Exception {
        store.update("INSERT INTO migration_state(id,version,manifest,verified_at)"
                + " VALUES('m1',1,'{\"version\":2}'::jsonb,now())");
        Map<String, Object> manifest = Map.of("manifest", Map.of("version", 1,
                "stopWindow", Map.of("closedAt", 0, "cursor", "c", "queueDepth", 0, "source", "data-api")));
        // 검증 당시 매니페스트와 다른 것을 들고 오면 열리지 않는다.
        assertThat(code(post("/internal/admin/migration/m1/dispatch/open", "o1", manifest)))
                .isEqualTo("MANIFEST_MISMATCH");
        store.update("UPDATE migration_state SET manifest=?::jsonb WHERE id='m1'",
                Json.write(Json.map(manifest).get("manifest")));
        assertThat(code(post("/internal/admin/migration/m1/dispatch/open", "o2", manifest)))
                .isEqualTo("GENERATION_REQUIRED_FOR_OPEN");
        assertThat(store.one("SELECT enabled,ever_opened FROM dispatch_control WHERE id=1"))
                .containsEntry("enabled", false).containsEntry("ever_opened", false);
    }

    // ── 도구 ────────────────────────────────────────────────────────────

    private static org.springframework.test.web.servlet.ResultMatcher status(int expected) {
        return org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().is(expected);
    }

    private static Map<String, Object> template(String body) {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("kind", "BET_RESULT");
        request.put("locale", "ko");
        request.put("title", "결과");
        request.put("body", body);
        request.put("enabled", true);
        request.put("sampleParams", Map.of("count", 1));
        return request;
    }

    private static List<String> ids(Map<String, Object> page) {
        return ((List<?>) page.get("items")).stream().map(item -> Json.map(item).get("id").toString()).toList();
    }

    private org.springframework.test.web.servlet.ResultActions read(String path) throws Exception {
        return mvc.perform(console(MockMvcRequestBuilders.get(path), null));
    }

    private MvcResult put(String path, String key, Map<String, Object> body) throws Exception {
        return mvc.perform(console(MockMvcRequestBuilders.put(path), key)
                .contentType(MediaType.APPLICATION_JSON).content(Json.write(body))).andReturn();
    }

    private MvcResult post(String path, String key, Map<String, Object> body) throws Exception {
        return mvc.perform(console(MockMvcRequestBuilders.post(path), key)
                .contentType(MediaType.APPLICATION_JSON).content(Json.write(body))).andReturn();
    }

    private static MockHttpServletRequestBuilder console(MockHttpServletRequestBuilder builder, String key) {
        builder.header("Authorization", "Bearer test-console").header("X-Console-Actor", "member-1");
        return key == null ? builder : builder.header("Idempotency-Key", key);
    }

    private static Map<String, Object> body(MvcResult result) throws Exception {
        return Json.map(result.getResponse().getContentAsString());
    }

    private static Map<String, Object> body(org.springframework.test.web.servlet.ResultActions actions)
            throws Exception {
        return body(actions.andReturn());
    }

    private static String code(MvcResult result) throws Exception {
        return String.valueOf(body(result).get("code"));
    }

    private static String code(org.springframework.test.web.servlet.ResultActions actions) throws Exception {
        return code(actions.andReturn());
    }
}
