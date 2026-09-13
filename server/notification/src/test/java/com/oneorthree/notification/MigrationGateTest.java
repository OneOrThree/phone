package com.oneorthree.notification;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.when;

/** 이관 적재·검증·발송 게이트. 매니페스트 태그가 아니라 «실제 PG 행»으로 닫는다. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("ci")
@Testcontainers
class MigrationGateTest {

    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("33333333-3333-4333-8333-333333333333");
    static final UUID SESSION = UUID.fromString("77777777-7777-4777-8777-777777777777");
    static final UUID CHALLENGE = UUID.fromString("88888888-8888-4888-8888-888888888888");
    static final UUID GROUP = UUID.fromString("99999999-9999-4999-8999-999999999999");
    static final Instant DAY = Instant.parse("2026-09-11T03:00:00Z");
    static final long CLOSED_AT = DAY.minusSeconds(600).toEpochMilli();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
        // 최초 게이트 개방은 구 AT 롤아웃 창이 닫힌 뒤에만 허용된다(root 운영 제약).
        registry.add("notification.generation-required", () -> "true");
        // 드레인 예산을 짧게 — 「예산을 넘기면 drained=false」를 초 단위로 확인하기 위해서다.
        registry.add("notification.drain-budget-seconds", () -> "1");
    }

    @Autowired MockMvc mvc;
    @Autowired Store store;
    @Autowired DataSource dataSource;
    @Autowired PlatformTransactionManager transactions;
    @Autowired DeviceService devices;
    @Autowired SettingsService settings;
    @Autowired InboundService inbound;
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
                + "admin_audit,imports,migration_snapshots,migration_state CASCADE");
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
    void reimportSkipsUnchangedKeysAndRewritesTheWholeRecordWhenItChanges() throws Exception {
        Map<String, Object> first = body(load("i1", records(true, 5)));
        assertThat(Json.map(first.get("outcome"))).containsEntry("IMPORTED", 3);
        assertThat(body(load("i2", records(true, 5))).get("outcome"))
                .isEqualTo(Map.of("SKIPPED", 3));
        assertThat(store.rows("SELECT * FROM imports")).hasSize(3);
        // 이미 행이 있어도 뒤늦은 opt-out 이 반드시 반영돼야 한다(ON CONFLICT DO NOTHING 금지, §7.1 ②).
        assertThat(body(load("i3", List.of(settingsRecord(false, 6)))).get("outcome"))
                .isEqualTo(Map.of("IMPORTED", 1));
        assertThat(store.one("SELECT notification_enabled,version FROM settings WHERE user_id=?", USER))
                .containsEntry("notification_enabled", false).containsEntry("version", 6L);
    }

    @Test
    void importNeverResurrectsTombstonedDevicesOrSentDeliveries() throws Exception {
        load("i1", records(true, 5));
        devices.delete(USER, "tok-1", null, null, "logout");
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='tok-1'"))
                .containsEntry("active", false);
        Map<String, Object> laterDevice = deviceRecord(4L, true);
        assertThat(body(load("i2", List.of(laterDevice))).get("outcome")).isEqualTo(Map.of("SUPERSEDED", 1));
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='tok-1'"))
                .containsEntry("active", false);
        // 종결된 발송을 미발송으로 되돌리면 재훑기가 같은 회차를 다시 선점한다(A22 ⓗ).
        store.update("UPDATE deliveries SET status='SENT',sent_at=? WHERE event_id='ev-1'",
                java.sql.Timestamp.from(DAY));
        Map<String, Object> reopened = deliveryRecord("PENDING", 7);
        assertThat(body(load("i3", List.of(reopened))).get("outcome")).isEqualTo(Map.of("SUPERSEDED", 1));
        assertThat(store.one("SELECT status,attempts FROM deliveries WHERE event_id='ev-1'"))
                .containsEntry("status", "SENT").containsEntry("attempts", 0);
    }

    @Test
    void lateSettingsImportAndUnchangedReimportRespectWithdrawalAndConvergeSkippedStatus() throws Exception {
        List<Map<String, Object>> original = List.of(settingsRecord(false, 5));
        load("before-withdraw", original);
        inbound.accept(Map.of("eventId", "withdraw", "schemaVersion", 1, "type", "user.withdrawn",
                "userId", USER.toString(), "version", 6, "occurredAt", DAY.toString(),
                "params", Map.of("authGeneration", 1)));
        assertThat(store.rows("SELECT * FROM settings")).isEmpty();
        // 같은 snapshot/checksum이어도 기존 IMPORTED 행을 SKIPPED로 수렴시켜 verify가 누락으로 오판하지 않는다.
        assertThat(body(load("unchanged-after-withdraw", original)).get("outcome"))
                .isEqualTo(Map.of("SKIPPED", 1));
        assertThat(store.one("SELECT status FROM imports WHERE record_key=?", "settings:" + USER))
                .containsEntry("status", "SKIPPED");
        Map<String, Object> report = body(verify(original, 1, 0));
        assertThat(report).containsEntry("verified", true);
        assertThat(Json.map(report.get("skippedByFence"))).containsEntry("settings", 1);
        List<Map<String, Object>> changed = List.of(settingsRecord(true, 7));
        assertThat(body(load("changed-after-withdraw", changed)).get("outcome"))
                .isEqualTo(Map.of("SKIPPED", 1));
        assertThat(body(verify(changed, 2, 0))).containsEntry("verified", true);
        assertThat(store.rows("SELECT * FROM settings")).isEmpty();
    }

    @Test
    void arbitraryImportRecordOrderWaitsBeforeLockingSettingsOrDeliveriesDuringWithdrawal() throws Exception {
        for (boolean settingsFirst : List.of(true, false)) {
            resetState();
            load("initial", records(true, 5));
            var held = new CountDownLatch(1);
            var release = new CountDownLatch(1);
            ExecutorService executor = Executors.newFixedThreadPool(2);
            try {
                Future<?> withdrawal = executor.submit(() -> new TransactionTemplate(transactions)
                        .executeWithoutResult(status -> {
                            store.lock("device-ownership");
                            held.countDown();
                            awaitRelease(release);
                            inbound.accept(Map.of("eventId", "withdraw-race", "schemaVersion", 1,
                                    "type", "user.withdrawn", "userId", USER.toString(), "version", 8,
                                    "occurredAt", DAY.toString(), "params", Map.of("authGeneration", 4)));
                        }));
                assertThat(held.await(5, TimeUnit.SECONDS)).isTrue();
                List<Map<String, Object>> batch = settingsFirst
                        ? List.of(settingsRecord(false, 7), deliveryRecord("PENDING", 1), deviceRecord(4, true))
                        : List.of(deliveryRecord("PENDING", 1), settingsRecord(false, 7), deviceRecord(4, true));
                Future<MvcResult> imported = executor.submit(() -> load("race", batch));
                long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
                boolean waiting = false;
                while (!waiting && System.nanoTime() < until) {
                    waiting = store.one("SELECT pid FROM pg_stat_activity WHERE datname=current_database()"
                            + " AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%' LIMIT 1") != null;
                    if (!waiting) {
                        Thread.sleep(10);
                    }
                }
                assertThat(waiting).isTrue();
                // 이관이 global lock 전에 첫 실제 행을 잡았다면 NOWAIT가 실패한다. sleep으로 성공을 추정하지 않는다.
                try (Connection probe = dataSource.getConnection(); Statement sql = probe.createStatement()) {
                    probe.setAutoCommit(false);
                    sql.execute("SELECT user_id FROM settings WHERE user_id='" + USER + "' FOR UPDATE NOWAIT");
                    sql.execute("SELECT id FROM deliveries WHERE event_id='ev-1' FOR UPDATE NOWAIT");
                    probe.rollback();
                }
                release.countDown();
                withdrawal.get(10, TimeUnit.SECONDS);
                assertThat(body(imported.get(10, TimeUnit.SECONDS)).get("outcome"))
                        .isEqualTo(Map.of("SKIPPED", 3));
                assertThat(store.rows("SELECT * FROM settings")).isEmpty();
                assertThat(store.one("SELECT status FROM imports WHERE record_key=?", "settings:" + USER))
                        .containsEntry("status", "SKIPPED");
            } finally {
                release.countDown();
                executor.shutdownNow();
            }
        }
    }

    private static void awaitRelease(CountDownLatch release) {
        try {
            if (!release.await(10, TimeUnit.SECONDS)) {
                throw new AssertionError("탈퇴 경합 테스트 잠금 해제 시간 초과");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new AssertionError(interrupted);
        }
    }

    @Test
    void verifyComparesActualRowsFieldByFieldAndRendersUnsentOnes() throws Exception {
        List<Map<String, Object>> records = records(true, 5);
        load("i1", records);
        assertThat(verify(records, 1, 0).getResponse().getStatus()).isEqualTo(200);
        assertThat(store.one("SELECT verified_at FROM migration_state WHERE id='m1'").get("verified_at")).isNotNull();
        // 필드 하나만 어긋나도 걸린다 — 존재 여부 검사로 퇴화하지 않는다.
        store.update("UPDATE settings SET sound_enabled=false WHERE user_id=?", USER);
        Map<String, Object> report = body(verify(records, 1, 0));
        assertThat(report).containsEntry("verified", false);
        assertThat(reasons(report)).contains("FIELD_MISMATCH");
        assertThat(Json.map(((List<?>) report.get("failures")).get(0)))
                .containsEntry("scope", "settings.soundEnabled");
        assertThat(store.one("SELECT verified_at FROM migration_state WHERE id='m1'").get("verified_at")).isNull();
        store.update("UPDATE settings SET sound_enabled=true WHERE user_id=?", USER);
        assertThat(body(verify(records, 1, 0))).containsEntry("verified", true);
        // 미발송 행은 코어 추가 조회 없이 렌더돼야 한다(§7.1.1).
        store.update("DELETE FROM templates WHERE id='BET_RESULT.ko'");
        assertThat(reasons(body(verify(records, 1, 0)))).contains("RENDER_FAILED");
    }

    @ParameterizedTest
    @ValueSource(strings = {"LEAGUE_DEADLINE_D1", "STREAK_AT_RISK", "FRIEND_ACCEPTED", "CHALLENGE_CREATED"})
    void terminalLegacyEvidenceDoesNotRequireMissingHistoricalRenderInputs(String kind) throws Exception {
        String missingArgument = switch (kind) {
            case "LEAGUE_DEADLINE_D1" -> "shortfallHours";
            case "STREAK_AT_RISK" -> "streakCount";
            case "FRIEND_ACCEPTED" -> "nickname";
            default -> "missionLabel";
        };
        store.update("INSERT INTO kinds(id,quiet_policy) VALUES(?,'DROP')", kind);
        store.update("INSERT INTO templates(id,kind,locale,title,body) VALUES(?,?,'ko','안내',?)",
                kind + ".ko", kind, "{" + missingArgument + "}");
        Map<String, Object> delivery = new LinkedHashMap<>(Json.map(deliveryRecord("PENDING", 0).get("data")));
        delivery.put("kind", kind);
        delivery.put("params", Map.of("kind", kind));
        List<Map<String, Object>> pending = List.of(record("delivery", delivery));
        load("pending", pending);
        assertThat(reasons(body(verify(pending, 1, 0)))).contains("RENDER_FAILED");
        assertThat(store.one("SELECT enabled FROM dispatch_control WHERE id=1")).containsEntry("enabled", false);

        Map<String, Object> suppressedData = new LinkedHashMap<>(delivery);
        suppressedData.put("status", "SUPPRESSED");
        List<Map<String, Object>> suppressed = List.of(record("delivery", suppressedData));
        load("suppressed", suppressed);
        assertThat(body(verify(suppressed, 1, 0))).containsEntry("verified", true);
        assertThat(Json.map(body(open("open-suppressed", suppressed, 1)).get("dispatch")))
                .containsEntry("enabled", true);
        assertThat(store.one("SELECT status FROM deliveries WHERE event_id='ev-1'"))
                .containsEntry("status", "SUPPRESSED");
        // 같은 사건이 다시 이관돼도 종결 근거가 미발송으로 돌아가지 않는다.
        load("retry-pending", pending);
        assertThat(store.one("SELECT status FROM deliveries WHERE event_id='ev-1'"))
                .containsEntry("status", "SUPPRESSED");
        org.mockito.Mockito.verify(transport, org.mockito.Mockito.never()).send(anyString(), any(), anyBoolean(), anyString());
    }

    @Test
    void manifestCountAndChecksumGapsFailVerification() throws Exception {
        List<Map<String, Object>> records = records(true, 5);
        load("i1", records);
        Map<String, Object> manifest = manifest(records, 1, 0);
        Map<String, Object> resources = new LinkedHashMap<>(Json.map(manifest.get("resources")));
        Map<String, Object> settingsEntry = new LinkedHashMap<>(Json.map(resources.get("settings")));
        settingsEntry.put("count", 2);
        resources.put("settings", settingsEntry);
        manifest.put("resources", resources);
        assertThat(reasons(body(post("/internal/admin/migration/m1/verify", null,
                Map.of("manifest", manifest))))).contains("COUNT_MISMATCH");
        settingsEntry.put("count", 1);
        settingsEntry.put("checksum", Json.digest("손댄 값"));
        resources.put("settings", settingsEntry);
        manifest.put("resources", resources);
        assertThat(reasons(body(post("/internal/admin/migration/m1/verify", null,
                Map.of("manifest", manifest))))).contains("CHECKSUM_MISMATCH");
    }

    @Test
    void stopWindowEvidenceIsRequiredAndMustBeDrained() throws Exception {
        List<Map<String, Object>> records = records(true, 5);
        load("i1", records);
        assertThat(reasons(body(verify(records, 1, 3)))).contains("STOP_WINDOW_NOT_DRAINED");
        Map<String, Object> manifest = manifest(records, 1, 0);
        manifest.remove("stopWindow");
        // 증거 자체가 없으면 fail-closed 다.
        assertThat(code(post("/internal/admin/migration/m1/verify", null, Map.of("manifest", manifest))))
                .isEqualTo("INVALID_stopWindow");
        assertThat(store.one("SELECT enabled FROM dispatch_control WHERE id=1")).containsEntry("enabled", false);
    }

    @Test
    void missingWholeResourcesCannotVerifyOrOpenEvenWhenNoRowsWereImported() throws Exception {
        for (boolean omitAll : List.of(true, false)) {
            Map<String, Object> manifest = manifest(List.of(), 1, 0);
            Map<String, Object> resources = new LinkedHashMap<>(Json.map(manifest.get("resources")));
            if (omitAll) {
                resources.clear();
            } else {
                resources.remove("settings");
            }
            manifest.put("resources", resources);
            var verified = body(post("/internal/admin/migration/m1/verify", null, Map.of("manifest", manifest)));
            assertThat(verified).containsEntry("verified", false);
            assertThat(Json.write(verified)).contains("REQUIRED_RESOURCE_MISSING");
            assertThat(code(post("/internal/admin/migration/m1/dispatch/open", "missing-" + omitAll,
                    Map.of("manifest", manifest)))).isEqualTo("MIGRATION_NOT_VERIFIED");
            assertThat(store.one("SELECT enabled,ever_opened FROM dispatch_control WHERE id=1"))
                    .containsEntry("enabled", false).containsEntry("ever_opened", false);
        }
    }

    @Test
    void retryStateMustMatchBeforeFirstOpen() throws Exception {
        var records = records(true, 5);
        load("i1", records);
        store.update("UPDATE deliveries SET attempts=attempts+1 WHERE event_id='ev-1'");
        var report = body(verify(records, 1, 0));
        assertThat(report).containsEntry("verified", false);
        assertThat(Json.write(report)).contains("delivery.attempts");
    }

    @Test
    void actualFcmRetryDoesNotPreventReopenButImmutablePayloadStillMustMatch() throws Exception {
        var records = records(true, 5);
        load("i1", records);
        assertThat(body(verify(records, 1, 0))).containsEntry("verified", true);
        assertThat(Json.map(body(open("o1", records, 1)).get("dispatch"))).containsEntry("enabled", true);
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.RETRY);
        dispatch.dispatch((UUID) store.one("SELECT id FROM deliveries WHERE event_id='ev-1'").get("id"));
        assertThat(store.one("SELECT status,attempts,last_error FROM deliveries WHERE event_id='ev-1'"))
                .containsEntry("status", "PENDING").containsEntry("attempts", 1).containsEntry("last_error", "FCM_RETRY");
        post("/internal/admin/dispatch/close", "c1", Map.of());
        assertThat(Json.map(body(open("o2", records, 1)).get("dispatch"))).containsEntry("enabled", true);
        // 재개가 바뀐 발송 입력까지 허용하는 것은 아니다.
        post("/internal/admin/dispatch/close", "c2", Map.of());
        store.update("UPDATE deliveries SET payload='{\"count\":2}'::jsonb WHERE event_id='ev-1'");
        assertThat(code(open("o3", records, 1))).isEqualTo("VERIFICATION_FAILED");
    }

    @Test
    void closeReplayClosesAReopenedGateAndDrainsAgain() throws Exception {
        var records = records(true, 5);
        load("i1", records);
        verify(records, 1, 0);
        open("o1", records, 1);
        post("/internal/admin/dispatch/close", "c1", Map.of());
        assertThat(open("o2", records, 1).getResponse().getStatus()).isEqualTo(200);
        var replay = body(post("/internal/admin/dispatch/close", "c1", Map.of()));
        assertThat(replay).containsEntry("drained", true);
        assertThat(Json.map(replay.get("dispatch"))).containsEntry("enabled", false);
        assertThat(store.one("SELECT enabled FROM dispatch_control WHERE id=1"))
                .containsEntry("enabled", false);
    }

    @Test
    void openReplayCannotUndoALaterCloseButANewOpenCanResume() throws Exception {
        var records = records(true, 5);
        load("i1", records);
        verify(records, 1, 0);
        assertThat(open("o1", records, 1).getResponse().getStatus()).isEqualTo(200);
        assertThat(open("o1", records, 1).getResponse().getStatus()).isEqualTo(200);
        post("/internal/admin/dispatch/close", "c1", Map.of());
        assertThat(code(open("o1", records, 1))).isEqualTo("DISPATCH_OPEN_REPLAY_STALE");
        assertThat(store.one("SELECT enabled FROM dispatch_control WHERE id=1"))
                .containsEntry("enabled", false);
        assertThat(open("o2", records, 1).getResponse().getStatus()).isEqualTo(200);
    }

    @Test
    void closeReplayWaitsForAnInflightDispatchGateLock() throws Exception {
        var records = records(true, 5);
        load("i1", records);
        verify(records, 1, 0);
        open("o1", records, 1);
        post("/internal/admin/dispatch/close", "c1", Map.of());
        open("o2", records, 1);
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try (Connection inflight = dataSource.getConnection()) {
            inflight.setAutoCommit(false);
            try (Statement statement = inflight.createStatement()) {
                statement.execute("SELECT enabled FROM dispatch_control WHERE id=1 FOR SHARE");
            }
            Future<MvcResult> closing = worker.submit(() ->
                    post("/internal/admin/dispatch/close", "c1", Map.of()));
            awaitBlockedOnTheGate();
            assertThat(closing.isDone()).isFalse();
            inflight.commit();
            var response = body(closing.get(30, TimeUnit.SECONDS));
            assertThat(response).containsEntry("drained", true);
            assertThat(Json.map(response.get("dispatch"))).containsEntry("enabled", false);
        } finally {
            worker.shutdownNow();
        }
    }

    /**
     * 판정이 끝난 워커는 <b>트랜잭션도 잠금도 없이</b> FCM 을 부른다. 그 워커는 게이트 행을 쥐고
     * 있지 않으므로 {@code dispatch_control} UPDATE 가 붙잡지 못한다.
     *
     * <p>그런데도 {@code drained=true} 를 돌려주면 운영자는 「긴급 정지가 끝났다」로 읽고 컷오버를
     * 이어간다 — 실제로는 그 워커가 남은 기기들에 계속 발송하고, 전환된 경로와 겹쳐 중복이 된다.
     * 살아 있는 발송 임대가 있으면 드레인은 완료가 아니다.
     */
    @Test
    void closeDoesNotReportDrainedWhileAnExternalSendIsStillInFlight() throws Exception {
        var records = records(true, 5);
        load("i1", records);
        verify(records, 1, 0);
        open("o1", records, 1);

        // 판정이 끝나 임대를 쥔 채 FCM 을 부르는 중인 워커 — 트랜잭션도 게이트 잠금도 없다.
        UUID inflight = UUID.randomUUID();
        store.update("INSERT INTO deliveries(id,event_id,user_id,kind,payload,status,next_attempt_at,"
                + "lease_token,lease_expires_at) VALUES(?,?,?,?,?::jsonb,'PENDING',now()+interval '120 seconds',"
                + "?,now()+interval '120 seconds')",
                inflight, "inflight-1", USER, "BET_RESULT", "{}", UUID.randomUUID());

        var response = body(post("/internal/admin/dispatch/close", "c-inflight", Map.of()));
        // 게이트는 «먼저» 닫는다 — 닫는 것이 안전이고 기다리는 것은 확인이다.
        assertThat(Json.map(response.get("dispatch"))).containsEntry("enabled", false);
        assertThat(response)
                .as("발송이 아직 도는 중이면 드레인 완료가 아니다")
                .containsEntry("drained", false);

        // 그 워커가 결과를 맺으면(임대 해제) 같은 명령의 재실행이 드레인 완료를 준다.
        store.update("UPDATE deliveries SET lease_token=NULL,lease_expires_at=NULL WHERE id=?", inflight);
        assertThat(body(post("/internal/admin/dispatch/close", "c-inflight", Map.of())))
                .containsEntry("drained", true);
    }

    @Test
    void failedRevalidationAlsoDrainsBeforeClearingVerification() throws Exception {
        var records = records(true, 5);
        load("i1", records);
        verify(records, 1, 0);
        open("o1", records, 1);
        store.update("INSERT INTO deliveries(id,event_id,user_id,kind,payload,status,next_attempt_at,"
                + "lease_token,lease_expires_at) VALUES(?,?,?,?,?::jsonb,'PENDING',now()+interval '120 seconds',"
                + "?,now()+interval '120 seconds')", UUID.randomUUID(), "invalidating-inflight", USER,
                "BET_RESULT", "{}", UUID.randomUUID());
        store.update("UPDATE settings SET night_end_time='08:00:00' WHERE user_id=?", USER);

        long started = System.nanoTime();
        assertThat(code(open("o1", records, 1))).isEqualTo("VERIFICATION_FAILED");
        assertThat(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)).isGreaterThanOrEqualTo(900);
        assertThat(store.one("SELECT enabled FROM dispatch_control WHERE id=1")).containsEntry("enabled", false);
        assertThat(store.one("SELECT verified_at FROM migration_state WHERE id='m1'"))
                .containsEntry("verified_at", null);
        assertThat(store.one("SELECT 1 FROM admin_audit WHERE action='dispatch.drain.timeout'"))
                .isNotNull();
        assertThat(store.one("SELECT request->>'drained' AS drained FROM admin_audit"
                + " WHERE action='migration.verification.cleared' AND resource_id='m1'"))
                .containsEntry("drained", "false");
    }

    @Test
    void openReplayRevalidatesTheActualRows() throws Exception {
        var records = records(true, 5);
        load("i1", records);
        verify(records, 1, 0);
        assertThat(open("o1", records, 1).getResponse().getStatus()).isEqualTo(200);
        store.update("UPDATE settings SET night_end_time='08:00:00' WHERE user_id=?", USER);
        assertThat(code(open("o1", records, 1))).isEqualTo("VERIFICATION_FAILED");
        assertThat(store.one("SELECT enabled FROM dispatch_control WHERE id=1"))
                .containsEntry("enabled", false);
    }

    @Test
    void openReRunsVerificationAndEverOpenedNeverGoesBack() throws Exception {
        List<Map<String, Object>> records = records(true, 5);
        load("i1", records);
        assertThat(body(verify(records, 1, 0))).containsEntry("verified", true);
        // verified_at 태그가 서 있어도 개방 시점에 DB 가 어긋나 있으면 열리지 않는다.
        store.update("UPDATE settings SET night_end_time='08:00:00' WHERE user_id=?", USER);
        assertThat(code(open("o1", records, 1))).isEqualTo("VERIFICATION_FAILED");
        assertThat(store.one("SELECT enabled,ever_opened FROM dispatch_control WHERE id=1"))
                .containsEntry("enabled", false).containsEntry("ever_opened", false);
        assertThat(store.one("SELECT verified_at FROM migration_state WHERE id='m1'").get("verified_at")).isNull();
        store.update("UPDATE settings SET night_end_time='07:00:00' WHERE user_id=?", USER);
        assertThat(body(verify(records, 1, 0))).containsEntry("verified", true);
        Map<String, Object> opened = body(open("o2", records, 1));
        assertThat(Json.map(opened.get("dispatch"))).containsEntry("enabled", true)
                .containsEntry("everOpened", true);
        assertThat(store.one("SELECT opened_at FROM migration_state WHERE id='m1'").get("opened_at")).isNotNull();
        // 닫아도 ever_opened 는 되돌아가지 않는다 — 개방 이후는 roll-forward 전용이다(A22 ㋭).
        Map<String, Object> closed = body(post("/internal/admin/dispatch/close", "c1", Map.of()));
        assertThat(Json.map(closed.get("dispatch"))).containsEntry("enabled", false)
                .containsEntry("everOpened", true);
        assertThat(closed).containsEntry("drained", true);
        assertThat(code(load("i9", records))).isEqualTo("IMPORT_CLOSED");
    }

    @Test
    void anyImportInvalidatesAnEarlierVerification() throws Exception {
        List<Map<String, Object>> records = records(true, 5);
        load("i1", records);
        assertThat(body(verify(records, 1, 0))).containsEntry("verified", true);
        UUID other = UUID.fromString("44444444-4444-4444-8444-444444444444");
        Map<String, Object> extra = new LinkedHashMap<>(settingsRecord(true, 1));
        Map<String, Object> payload = new LinkedHashMap<>(Json.map(extra.get("data")));
        payload.put("userId", other.toString());
        extra.put("data", payload);
        assertThat(body(load("i2", List.of(extra)))).containsEntry("verificationCleared", true);
        assertThat(code(open("o1", records, 1))).isEqualTo("MIGRATION_NOT_VERIFIED");
    }

    @Test
    void closedGateStillAppliesSettingsDeviceAndAck() {
        assertThat(store.one("SELECT enabled FROM dispatch_control WHERE id=1")).containsEntry("enabled", false);
        Map<String, Object> preferences = new LinkedHashMap<>();
        preferences.put("notificationEnabled", false);
        preferences.put("soundEnabled", true);
        preferences.put("nightModeEnabled", false);
        preferences.put("nightStartTime", null);
        preferences.put("nightEndTime", null);
        settings.apply(USER, preferences, 3, "s1");
        assertThat(settings.read(USER)).containsEntry("notificationEnabled", false);
        devices.register(USER, Map.of("deviceToken", "tok-live", "deviceBootstrap", "b", "sessionEpoch", 1,
                "authGeneration", 0), "d1");
        devices.delete(USER, "tok-live", null, null, "d2");
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='tok-live'"))
                .containsEntry("active", false);
        UUID session = UUID.randomUUID();
        assertThat(ack.command(USER, session, "prepare", "a1")).containsEntry("state", "HELD");
    }

    @Test
    void replayQueuesMissedRunsWithoutMarkingThemDone() throws Exception {
        store.update("INSERT INTO jobs(id,owner,cron) VALUES('league-weekly','DATA','0 0 7 * * MON'),"
                + "('bundle-flush','NOTIFICATION','0 0 * * * *')");
        assertThat(code(post("/internal/admin/jobs/ghost/replay", "r0", window(5)))).isEqualTo("UNKNOWN_JOB");
        assertThat(store.rows("SELECT * FROM job_runs")).isEmpty();
        assertThat(code(post("/internal/admin/jobs/league-weekly/replay", "r1", window(5))))
                .isEqualTo("JOB_OWNED_BY_DATA");
        Map<String, Object> replayed = body(post("/internal/admin/jobs/bundle-flush/replay", "r2", window(5)));
        assertThat(replayed).containsEntry("missed", 5).containsEntry("queued", 5).containsEntry("executed", false);
        assertThat(store.rows("SELECT * FROM job_runs WHERE completed_at IS NULL")).hasSize(5);
        // 같은 창을 다시 요청해도 이미 등록된 회차를 두 번 만들지 않는다.
        assertThat(body(post("/internal/admin/jobs/bundle-flush/replay", "r3", window(5))))
                .containsEntry("missed", 5).containsEntry("queued", 0);
        assertThat(code(post("/internal/admin/jobs/bundle-flush/replay", "r4", window(300))))
                .isEqualTo("REPLAY_WINDOW_TOO_LARGE");
        assertThat(code(post("/internal/admin/jobs/bundle-flush/replay", "r5", Map.of())))
                .isEqualTo("REPLAY_WINDOW_REQUIRED");
    }

    /**
     * A 계정의 구 export 를 적재한 뒤 같은 기기가 B 계정으로 라이브 전환되면,
     * 뒤늦게 «다시» 도착한 A 의 export 는 그 토큰을 되찾아가면 안 된다.
     * 되돌리면 ownership_token 은 B 값 그대로인 채 user_id 만 A 가 되어 A 의 알림이 B 의 기기로 간다.
     */
    @Test
    void aLateLegacyExportCannotTakeBackATokenThatLiveRegistrationMovedToAnotherAccount() throws Exception {
        UUID accountB = UUID.fromString("55555555-5555-4555-8555-555555555555");
        assertThat(body(load("i1", List.of(deviceRecord(3L, true)))).get("outcome"))
                .isEqualTo(Map.of("IMPORTED", 1));
        UUID importedOwnership = (UUID) store.one("SELECT ownership_token FROM device_tokens"
                + " WHERE device_token='tok-1'").get("ownership_token");
        devices.register(accountB, Map.of("deviceToken", "tok-1", "deviceBootstrap", "switch",
                "sessionEpoch", 1, "authGeneration", 0), "switch");
        // 증분 백필 재시도로 A 의 export 가 한 번 더 도착한다.
        assertThat(body(load("i2", List.of(deviceRecord(4L, true)))).get("outcome"))
                .isEqualTo(Map.of("SUPERSEDED", 1));
        Map<String, Object> after = store.one("SELECT * FROM device_tokens WHERE device_token='tok-1'");
        assertThat(after).containsEntry("user_id", accountB).containsEntry("active", true);
        assertThat(after.get("ownership_token")).isNotEqualTo(importedOwnership);
        // A 의 세대(4)가 B 의 행에 얹히지도 않는다.
        assertThat(after).containsEntry("auth_generation", 0L);
        // 라이브 쓰기가 설명하는 어긋남이므로 검증은 통과하되 SUPERSEDED 로 드러난다.
        Map<String, Object> report = body(verify(List.of(deviceRecord(4L, true)), 1, 0));
        assertThat(report).containsEntry("verified", true);
        assertThat(Json.map(report.get("supersededByLiveWrite"))).containsEntry("device", 1);
    }

    /** 반대로 라이브 흔적이 «없는» 최초 적재 행은 뒤늦은 export 변경을 그대로 받아야 한다. */
    @Test
    void anImportOnlyRowStillAcceptsLaterExportChanges() throws Exception {
        load("i1", List.of(deviceRecord("tok-2", 3L, true)));
        assertThat(body(load("i2", List.of(deviceRecord("tok-2", 3L, false)))).get("outcome"))
                .isEqualTo(Map.of("IMPORTED", 1));
        assertThat(store.one("SELECT active,ownership_version FROM device_tokens WHERE device_token='tok-2'"))
                .containsEntry("active", false).containsEntry("ownership_version", 1L);
    }

    /** 세대가 이미 올라간 뒤 도착한 구 export 는 등록으로 취급하지 않는다(A22 ㉴). */
    @Test
    void anExportOlderThanTheCurrentAuthGenerationIsFenced() throws Exception {
        store.update("INSERT INTO user_fences(user_id,auth_generation) VALUES(?,7)", USER);
        assertThat(body(load("i1", List.of(deviceRecord(3L, true)))).get("outcome"))
                .isEqualTo(Map.of("SKIPPED", 1));
        assertThat(store.rows("SELECT * FROM device_tokens")).isEmpty();
        // 펜스로 «일부러» 안 넣은 행은 대상 행이 없어도 검증 실패가 아니다.
        Map<String, Object> report = body(verify(List.of(deviceRecord(3L, true)), 1, 0));
        assertThat(report).containsEntry("verified", true);
        assertThat(Json.map(report.get("skippedByFence"))).containsEntry("device", 1);
    }

    /**
     * 알림 이력도 투영도 아직 없는 환경의 «정상» Data export — 다섯 자원이 전부 0건이다.
     * Data 는 빈 자원도 manifest 에 SHA256("") 로 싣는다(NotificationMigrationManifest.ResourceDigest).
     * 알림 쪽이 적재 행이 있는 자원만 접으면 그 자원의 체크섬이 null 이라 건수 0 은 맞는데도
     * 매번 CHECKSUM_MISMATCH 로 막혀 verify 도 최초 개방도 끝낼 수 없다.
     */
    @Test
    void anExportWhoseResourcesAreAllEmptyStillVerifiesAndOpensTheGate() throws Exception {
        Map<String, Object> empty = manifest(List.of(), 1, 0);
        assertThat(Json.map(Json.map(empty.get("resources")).get("delivery")))
                .containsEntry("count", 0).containsEntry("checksum", Json.digest(""));
        Map<String, Object> report = body(post("/internal/admin/migration/m1/verify", null,
                Map.of("manifest", empty)));
        assertThat(report).containsEntry("verified", true).containsEntry("records", 0);
        // 투영 bootstrap 두 자원이 늘어도 같다 — 빠뜨린 것과 비어 있는 것을 구분해야 한다.
        assertThat(Json.map(report.get("checksums")))
                .containsEntry("settings", Json.digest("")).containsEntry("device", Json.digest(""))
                .containsEntry("delivery", Json.digest("")).containsEntry("user", Json.digest(""))
                .containsEntry("participation", Json.digest(""));
        Map<String, Object> opened = body(post("/internal/admin/migration/m1/dispatch/open", "o1",
                Map.of("manifest", empty)));
        assertThat(Json.map(opened.get("dispatch"))).containsEntry("enabled", true)
                .containsEntry("everOpened", true).containsEntry("activeMigrationId", "m1");
    }

    /** 다섯 중 «하나만» 비어도 같다. 그리고 0건이 아닌데 0건이라 선언하면 여전히 걸린다. */
    @Test
    void aResourceDeclaredWithZeroRecordsIsCheckedAgainstTheEmptyChecksum() throws Exception {
        List<Map<String, Object>> partial = List.of(settingsRecord(true, 5), deviceRecord(3L, true));
        load("i1", partial);
        Map<String, Object> report = body(verify(partial, 1, 0));
        assertThat(report).containsEntry("verified", true);
        assertThat(Json.map(report.get("checksums"))).containsEntry("delivery", Json.digest(""));
        load("i2", List.of(deliveryRecord("PENDING", 0)));
        assertThat(reasons(body(verify(partial, 2, 0)))).contains("COUNT_MISMATCH", "CHECKSUM_MISMATCH");
    }

    // ── 투영 bootstrap (승인 계획 ②′) ──────────────────────────────────

    /**
     * 투영 bootstrap 은 «판정 테이블»이 아니라 {@code projections} 로만 간다. 그리고 같은 version 의
     * 재적재는 <b>실제로 필드를 복구</b>해야 한다 — 라이브 경로의 {@code version <} 가드를 그대로
     * 쓰면 부분 적재를 이어 붙이는 재시도가 조용한 no-op 이 되어 현장에서 원인이 안 보인다.
     */
    @Test
    void projectionBootstrapWritesBothTypesAndReimportAtTheSameVersionRestoresFields() throws Exception {
        assertThat(Json.map(body(load("i1", List.of(userRecord("가나다", 5), participationRecord(SESSION, 5))))
                .get("outcome"))).containsEntry("IMPORTED", 2);
        Map<String, Object> user = store.one("SELECT version,payload::text AS payload FROM projections"
                + " WHERE projection_type='user.snapshot' AND user_id=? AND subject_id=''", USER);
        assertThat(user).containsEntry("version", 5L);
        assertThat(Json.map(user.get("payload"))).containsEntry("displayName", "가나다")
                .containsEntry("settingsPresent", true).containsEntry("nightStartTime", "23:00:00");
        Map<String, Object> participation = store.one("SELECT version,payload::text AS payload"
                + " FROM projections WHERE projection_type='participation.updated'"
                + " AND user_id=? AND subject_id=?", USER, SESSION.toString());
        assertThat(Json.map(participation.get("payload"))).containsEntry("sessionId", SESSION.toString())
                .containsEntry("stake", 30).containsEntry("achieved", null);
        // 같은 version 으로 고쳐 보낸 재적재 — 값이 실제로 복구돼야 한다.
        assertThat(body(load("i2", List.of(userRecord("라마바", 5)))).get("outcome"))
                .isEqualTo(Map.of("IMPORTED", 1));
        assertThat(Json.map(store.one("SELECT payload::text AS payload FROM projections"
                + " WHERE projection_type='user.snapshot' AND user_id=? AND subject_id=''", USER)
                .get("payload"))).containsEntry("displayName", "라마바");
    }

    @Test
    void reimportOfIdenticalProjectionRepairsTheActualPayload() throws Exception {
        List<Map<String, Object>> records = List.of(userRecord("원본", 5), participationRecord(SESSION, 5));
        load("i1", records);
        store.update("UPDATE projections SET payload=jsonb_set(payload,'{displayName}',"
                + "'\"불완전한 값\"') WHERE projection_type='user.snapshot' AND user_id=?", USER);
        assertThat(body(verify(records, 1, 0))).containsEntry("verified", false);
        assertThat(body(load("i2", records)).get("outcome")).isEqualTo(Map.of("IMPORTED", 2));
        assertThat(body(verify(records, 2, 0))).containsEntry("verified", true);
    }

    @Test
    void reimportAfterWithdrawalRefreshesTheFenceOutcomeWithoutRestoringProjections() throws Exception {
        List<Map<String, Object>> records = List.of(userRecord("원본", 5), participationRecord(SESSION, 5));
        load("i1", records);
        devices.generation(USER, 6, true);
        assertThat(store.rows("SELECT * FROM projections WHERE user_id=?", USER)).isEmpty();
        assertThat(body(load("i2", records)).get("outcome")).isEqualTo(Map.of("SKIPPED", 2));
        assertThat(store.rows("SELECT * FROM projections WHERE user_id=?", USER)).isEmpty();
        assertThat(body(verify(records, 1, 0))).containsEntry("verified", true);
    }

    /** 더 높은 라이브 version 은 bootstrap 이 되돌리지 못한다 — 옛 스냅샷이 새 상태를 덮으면 안 된다. */
    @Test
    void aHigherLiveProjectionVersionIsPreserved() throws Exception {
        load("i1", List.of(userRecord("가나다", 5)));
        store.update("UPDATE projections SET version=9,payload=jsonb_set(payload,'{displayName}',"
                + "'\"라이브\"') WHERE projection_type='user.snapshot' AND user_id=?", USER);
        assertThat(body(load("i2", List.of(userRecord("옛이름", 5)))).get("outcome"))
                .isEqualTo(Map.of("SUPERSEDED", 1));
        Map<String, Object> row = store.one("SELECT version,payload::text AS payload FROM projections"
                + " WHERE projection_type='user.snapshot' AND user_id=?", USER);
        assertThat(row).containsEntry("version", 9L);
        assertThat(Json.map(row.get("payload"))).containsEntry("displayName", "라이브");
        // 라이브가 더 최신인 방향은 검증 실패가 아니다 — SUPERSEDED 로 드러날 뿐이다.
        Map<String, Object> report = body(verify(List.of(userRecord("옛이름", 5)), 1, 0));
        assertThat(report).containsEntry("verified", true);
        assertThat(Json.map(report.get("supersededByLiveWrite"))).containsEntry("user", 1);
    }

    /**
     * 탈퇴 tombstone 은 적재 경로에서도 지켜야 한다. {@code InboundService.project()} 만 막고 여기를
     * 열어 두면 export~import 사이에 탈퇴한 유저의 PII 투영이 되살아난다(A22 ⓐ) —
     * {@code DeviceService} 가 탈퇴 때 지운 바로 그 행이다.
     */
    @Test
    void projectionImportHonoursTheWithdrawalTombstone() throws Exception {
        store.update("INSERT INTO user_fences(user_id,auth_generation,withdrawn) VALUES(?,0,true)", USER);
        assertThat(Json.map(body(load("i1", List.of(userRecord("가나다", 5), participationRecord(SESSION, 5))))
                .get("outcome"))).containsEntry("SKIPPED", 2);
        assertThat(store.rows("SELECT * FROM projections")).isEmpty();
        // 펜스로 «일부러» 안 넣은 행은 대상 행이 없어도 검증 실패가 아니다.
        Map<String, Object> report = body(verify(
                List.of(userRecord("가나다", 5), participationRecord(SESSION, 5)), 1, 0));
        assertThat(report).containsEntry("verified", true);
        assertThat(Json.map(report.get("skippedByFence")))
                .containsEntry("user", 1).containsEntry("participation", 1);
    }

    /** 회차는 subject 축으로 갈린다 — 한 회차가 다른 회차를 덮으면 그 회차의 참가자가 영영 사라진다(A22 ㊂). */
    @Test
    void participationRowsAreKeyedPerSessionSoOneSessionCannotOverwriteAnother() throws Exception {
        UUID other = UUID.fromString("66666666-6666-4666-8666-666666666666");
        List<Map<String, Object>> both = List.of(participationRecord(SESSION, 5), participationRecord(other, 5));
        assertThat(Json.map(body(load("i1", both)).get("outcome"))).containsEntry("IMPORTED", 2);
        assertThat(store.rows("SELECT subject_id FROM projections"
                + " WHERE projection_type='participation.updated' AND user_id=?", USER)).hasSize(2);
        assertThat(store.rows("SELECT record_key FROM imports ORDER BY record_key"))
                .extracting(row -> row.get("record_key").toString())
                .contains("participation:" + USER + ":" + SESSION, "participation:" + USER + ":" + other);
        assertThat(body(verify(both, 1, 0))).containsEntry("verified", true);
    }

    /** 같은 version 인데 투영 내용이 다르면 검증이 필드 단위로 잡는다 — 존재 검사로 퇴화하지 않는다. */
    @Test
    void verifyComparesProjectionPayloadsFieldByField() throws Exception {
        List<Map<String, Object>> records = List.of(userRecord("가나다", 5));
        load("i1", records);
        assertThat(body(verify(records, 1, 0))).containsEntry("verified", true);
        store.update("UPDATE projections SET payload=jsonb_set(payload,'{locale}','\"en\"')"
                + " WHERE projection_type='user.snapshot' AND user_id=?", USER);
        Map<String, Object> report = body(verify(records, 1, 0));
        assertThat(report).containsEntry("verified", false);
        assertThat(Json.map(((List<?>) report.get("failures")).get(0)))
                .containsEntry("reason", "FIELD_MISMATCH").containsEntry("scope", "user.locale");
    }

    /**
     * settings·device_tokens·deliveries 는 이관들 사이에 «공유»된다. 서로 다른 migrationId 가 같은
     * 저장소에 적재하면 한쪽의 최종 검사 대상과 실제로 열리는 데이터가 어긋난다 — 전역 활성 이관
     * 하나를 게이트 행에 묶어 둘째 id 를 아예 들이지 않는다. 같은 id 의 재개는 그대로 이어진다.
     */
    @Test
    void aSecondMigrationIdCannotTouchTheStoreWhileAnotherOneIsActive() throws Exception {
        List<Map<String, Object>> records = records(true, 5);
        load("i1", records);
        assertThat(store.one("SELECT active_migration_id FROM dispatch_control WHERE id=1"))
                .containsEntry("active_migration_id", "m1");
        assertThat(code(post("/internal/admin/migration/m2/import", "x1", Map.of("records", records))))
                .isEqualTo("MIGRATION_ID_CONFLICT");
        assertThat(code(post("/internal/admin/migration/m2/verify", null,
                Map.of("manifest", manifest(records, 1, 0))))).isEqualTo("MIGRATION_ID_CONFLICT");
        assertThat(code(post("/internal/admin/migration/m2/dispatch/open", "x2",
                Map.of("manifest", manifest(records, 1, 0))))).isEqualTo("MIGRATION_ID_CONFLICT");
        assertThat(store.rows("SELECT * FROM imports WHERE migration_id='m2'")).isEmpty();
        assertThat(body(load("i2", records)).get("outcome")).isEqualTo(Map.of("SKIPPED", 3));
    }

    /**
     * 게이트 잠금을 «최종 검사 뒤»에 얻으면, 그 사이 커밋된 다른 적재의 미검증 쓰기를 안은 채 열린다.
     * 여기서는 진행 중인 적재가 잡고 있는 것과 같은 게이트 행 잠금을 밖에서 걸어 두고, open 이
     * 그 잠금을 기다리는 동안 검증을 깨뜨리는 쓰기를 커밋한다. 순서가 맞다면 open 은 그 쓰기를
     * 보고 닫힌 채로 남아야 한다.
     */
    @Test
    void openTakesTheGateBeforeItsFinalCheckSoConcurrentImportsCannotSlipIn() throws Exception {
        List<Map<String, Object>> records = records(true, 5);
        load("i1", records);
        assertThat(body(verify(records, 1, 0))).containsEntry("verified", true);
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try (Connection blocker = dataSource.getConnection()) {
            blocker.setAutoCommit(false);
            try (Statement statement = blocker.createStatement()) {
                statement.execute("SELECT ever_opened FROM dispatch_control WHERE id=1 FOR UPDATE");
            }
            Future<MvcResult> opening = worker.submit(() -> open("o1", records, 1));
            awaitBlockedOnTheGate();
            // 아직 검증되지 않은 쓰기. open 이 최종 검사를 먼저 끝냈다면 이것을 못 보고 열어 버린다.
            store.update("UPDATE settings SET sound_enabled=false WHERE user_id=?", USER);
            blocker.commit();
            assertThat(code(opening.get(30, TimeUnit.SECONDS))).isEqualTo("VERIFICATION_FAILED");
        } finally {
            worker.shutdownNow();
        }
        assertThat(store.one("SELECT enabled,ever_opened FROM dispatch_control WHERE id=1"))
                .containsEntry("enabled", false).containsEntry("ever_opened", false);
        assertThat(store.one("SELECT verified_at FROM migration_state WHERE id='m1'").get("verified_at")).isNull();
    }

    /** open 스레드가 실제로 게이트 행 잠금에서 «대기»하기 시작할 때까지 기다린다. */
    private void awaitBlockedOnTheGate() throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        while (System.nanoTime() < deadline) {
            if (!store.rows("SELECT 1 FROM pg_locks WHERE NOT granted").isEmpty()) {
                return;
            }
            Thread.sleep(50);
        }
        throw new IllegalStateException("open 이 게이트 잠금을 기다리지 않는다 — 잠금 순서가 통일되지 않았다");
    }

    // ── 같은 aggregate version 의 뒤늦은 opt-out ────────────────────────

    /**
     * 구 {@code UserService.updateNotificationSettings()} 는 유저 aggregate version 을 올리지 않는다.
     * 그래서 백필 뒤 구 앱에서 알림을 끄면 최종 export 는 «값만 다르고 version 은 같은» 설정으로 온다.
     * 이것이 적재되지 않으면 필드 불일치가 영영 풀리지 않아 게이트를 열 수 없다.
     */
    @Test
    void aLateOptOutThatDidNotBumpTheAggregateVersionIsStillImported() throws Exception {
        load("i1", records(true, 5));
        assertThat(store.one("SELECT notification_enabled,imported_by FROM settings WHERE user_id=?", USER))
                .containsEntry("notification_enabled", true).containsEntry("imported_by", "m1");
        // 최종 export — 같은 version(5), 값만 false 다.
        List<Map<String, Object>> last = records(false, 5);
        assertThat(body(load("i2", last)).get("outcome")).isEqualTo(Map.of("IMPORTED", 1, "SKIPPED", 2));
        assertThat(store.one("SELECT notification_enabled,version FROM settings WHERE user_id=?", USER))
                .containsEntry("notification_enabled", false).containsEntry("version", 5L);
        assertThat(body(verify(last, 1, 0))).containsEntry("verified", true);
    }

    /** 더 높은 라이브 version 은 그대로다 — 뒤늦은 재적재가 라이브 설정을 되돌리지 못한다. */
    @Test
    void aHigherLiveSettingsVersionSurvivesTheFinalSnapshot() throws Exception {
        load("i1", records(true, 5));
        Map<String, Object> live = NotificationStoreTest.preferences(false);
        live.put("soundEnabled", false);
        settings.applyLocked(USER, live, 9);
        assertThat(body(load("i2", records(true, 6))).get("outcome"))
                .isEqualTo(Map.of("SUPERSEDED", 1, "SKIPPED", 2));
        assertThat(store.one("SELECT notification_enabled,version,imported_by FROM settings WHERE user_id=?", USER))
                .containsEntry("notification_enabled", false).containsEntry("version", 9L)
                .containsEntry("imported_by", null);
        // 라이브가 더 최신이므로 검증은 통과한다 — 되돌리라고 요구하지 않는다.
        assertThat(body(verify(records(true, 6), 1, 0))).containsEntry("verified", true);
    }

    /**
     * 같은 version 이라도 «라이브가 쓴» 행은 이관이 덮지 않는다. 재동기화 창은 이관이 만든 행에만 열린다.
     * 덮지 않은 어긋남은 조용히 통과시키지 않고 그대로 검증 실패로 닫는다.
     */
    @Test
    void liveOwnedSettingsAtTheSameVersionAreNeverOverwrittenByAnImport() throws Exception {
        settings.applyLocked(USER, Map.of("notificationEnabled", true, "soundEnabled", true,
                "nightModeEnabled", true, "nightStartTime", "23:00", "nightEndTime", "07:00"), 5);
        assertThat(body(load("i1", List.of(settingsRecord(false, 5)))).get("outcome"))
                .isEqualTo(Map.of("SUPERSEDED", 1));
        assertThat(store.one("SELECT notification_enabled,imported_by FROM settings WHERE user_id=?", USER))
                .containsEntry("notification_enabled", true).containsEntry("imported_by", null);
        assertThat(reasons(body(verify(List.of(settingsRecord(false, 5)), 1, 0)))).contains("FIELD_MISMATCH");
    }

    // ── 최종 스냅샷 구성원 ──────────────────────────────────────────────

    /**
     * 초기 적재와 최종 재동기화 사이에 회차가 정산되고 기기 토큰이 지워지면, 그 키는 최종 export 에서
     * 빠진다. 원장은 추가·갱신만 하므로 전부 세면 건수·체크섬이 영영 어긋난다.
     * 지목한 스냅샷의 구성원만 세고, 빠진 이관 행은 개방 직전에 접는다.
     */
    @Test
    void keysDroppedFromTheFinalSnapshotStopCountingAndTheirImportedRowsAreRetired() throws Exception {
        List<Map<String, Object>> first = new ArrayList<>(records(true, 5));
        first.add(deviceRecord("tok-2", 3L, true));
        first.add(userRecord("두부", 5));
        first.add(participationRecord(SESSION, 5));
        first.add(participationRecord(UUID.randomUUID(), 5));
        load("i1", "snap-1", first);
        // 최종 export — tok-2 는 토큰이 지워졌고 OTHER_SESSION 은 정산됐다.
        List<Map<String, Object>> last = new ArrayList<>(records(true, 5));
        last.add(userRecord("두부", 5));
        last.add(participationRecord(SESSION, 5));
        load("i2", "snap-2", last);
        assertThat(body(verify("snap-2", last))).containsEntry("verified", true);
        // 지목 없이 검증하면 두 세대가 섞이므로 어느 쪽이 정본인지 말하게 한다.
        assertThat(reasons(body(verify(last, 1, 0)))).contains("SNAPSHOT_REQUIRED");
        assertThat(body(verify("snap-2", last))).containsEntry("verified", true);
        Map<String, Object> opened = body(open("o1", "snap-2", last));
        assertThat(Json.map(opened.get("retired")))
                .isEqualTo(Map.of("device", 1, "participation", 1));
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='tok-2'"))
                .containsEntry("active", false);
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='tok-1'"))
                .containsEntry("active", true);
        assertThat(store.rows("SELECT subject_id FROM projections WHERE projection_type=?",
                MigrationRecords.PARTICIPATION_PROJECTION))
                .extracting(row -> row.get("subject_id")).containsExactly(SESSION.toString());
        // 원장은 지우지 않는다 — 빠진 키의 이력은 옛 세대 태그를 단 채 남는다.
        assertThat(store.rows("SELECT record_key FROM imports WHERE snapshot_id='snap-1'")).hasSize(2);
    }

    /**
     * sid 도 bootstrap 도 없는 구 앱의 «최초» 등록이 만든 행은 이관이 만든 행과 컬럼 모양이 같다.
     * 모양만 보고 접으면 방금 등록한 살아 있는 기기를 끈다.
     */
    @Test
    void aLiveLegacyRegistrationWithTheSameShapeSurvivesSnapshotRemoval() throws Exception {
        load("i1", "snap-1", records(true, 5));
        // 구 앱 최초 등록 — bootstrap·세션·legacy 전부 없고 ownership_version 은 1 이다.
        devices.register(USER, Map.of("deviceToken", "tok-live", "authGeneration", 3), "d1");
        // 같은 토큰을 초기 export도 봤다. 원장에는 남지만 실제 행은 라이브 소유로 보존해야 한다.
        assertThat(body(load("i1-live", "snap-1", List.of(deviceRecord("tok-live", 3L, true))))
                .get("outcome")).isEqualTo(Map.of("SUPERSEDED", 1));
        assertThat(store.one("SELECT ownership_version,bootstrap_hash,session_epoch,legacy_session_id,imported_by"
                + " FROM device_tokens WHERE device_token='tok-live'"))
                .containsEntry("ownership_version", 1L).containsEntry("bootstrap_hash", null)
                .containsEntry("session_epoch", null).containsEntry("legacy_session_id", null)
                .containsEntry("imported_by", null);
        load("i2", "snap-2", records(true, 5));
        assertThat(body(verify("snap-2", records(true, 5)))).containsEntry("verified", true);
        assertThat(Json.map(body(open("o1", "snap-2", records(true, 5))).get("retired"))).isEmpty();
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='tok-live'"))
                .containsEntry("active", true);
    }

    /** 최종 스냅샷을 일부만 올린 뒤 검증하면 건수로 막힌다 — 부분 적재가 조용히 지우지 못한다. */
    @Test
    void aPartiallyLoadedFinalSnapshotCannotVerify() throws Exception {
        List<Map<String, Object>> all = new ArrayList<>(records(true, 5));
        all.add(userRecord("두부", 5));
        load("i1", "snap-1", all);
        // 최종 스냅샷의 첫 청크만 도착했다.
        load("i2", "snap-2", List.of(settingsRecord(true, 5)));
        assertThat(reasons(body(verify("snap-2", all)))).contains("COUNT_MISMATCH");
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='tok-1'"))
                .containsEntry("active", true);
    }

    /**
     * <b>전량 제거를 뜻하는 빈 스냅샷은 {@code imports} 에 행이 하나도 없다.</b> 세대를 거기서만 세면
     * 그 세대가 통째로 보이지 않아, 스냅샷을 빠뜨린 매니페스트가 「세대는 하나뿐」으로 통과한다.
     *
     * <p>그러면 옛 {@code snap-1} 의 건수·체크섬과 맞는 매니페스트로 검증·개방이 끝나고,
     * {@code retire} 도 지목이 없어 아무 행도 정리하지 않는다 — 최종 스냅샷에서 제거된 기기로 계속
     * 발송된다. 등재된 공집합도 한 세대로 세야 한다.
     */
    @Test
    void aRegisteredEmptySnapshotStillCountsAsAGenerationSoAnUnnamedManifestIsRejected() throws Exception {
        List<Map<String, Object>> first = new ArrayList<>(records(true, 5));
        load("i1", "snap-1", first);
        // 전량 제거 — 등재는 하되 레코드는 0건이다. imports 에는 snap-2 행이 생기지 않는다.
        load("i2", "snap-2", List.of());
        assertThat(store.one("SELECT snapshot_id FROM migration_snapshots WHERE migration_id=? AND snapshot_id=?",
                "m1", "snap-2"))
                .as("등재부에는 남아야 한다 — 「선언된 공집합」과 「모르는 스냅샷」을 가르는 근거다")
                .isNotNull();
        assertThat(store.rows("SELECT record_key FROM imports WHERE migration_id=? AND snapshot_id=?",
                "m1", "snap-2"))
                .as("빈 스냅샷은 imports 에 행이 없다 — 그래서 거기서만 세면 안 보인다")
                .isEmpty();

        // 지목 없이 옛 세대의 건수·체크섬으로 검증하면 거절돼야 한다.
        assertThat(reasons(body(verify(first, 1, 0)))).contains("SNAPSHOT_REQUIRED");
    }

    /** 태그를 빠뜨린 적재는 「전량 제거」처럼 보인다. 등재된 적 없는 스냅샷 지목은 실패다. */
    @Test
    void aManifestNamingAnUnregisteredSnapshotIsRejected() throws Exception {
        load("i1", "snap-1", records(true, 5));
        assertThat(reasons(body(verify("snap-2", List.of())))).contains("SNAPSHOT_EMPTY");
    }

    /**
     * 반대로 «선언된» 공집합은 정당하다 — 마지막 회차가 전부 정산되고 대상이 사라진 최종 export 다.
     * {@code records:[]} 로 세대를 등재할 수 있어야 하고, 그 세대의 구성원 0 은 실패가 아니다.
     */
    @Test
    void anExplicitlyDeclaredEmptyFinalSnapshotVerifiesAndRetiresEverythingItDropped() throws Exception {
        List<Map<String, Object>> first = new ArrayList<>(records(true, 5));
        first.add(userRecord("두부", 5));
        first.add(participationRecord(SESSION, 5));
        load("i1", "snap-1", first);
        assertThat(load("i2", "snap-2", List.of()).getResponse().getStatus()).isEqualTo(200);
        assertThat(body(verify("snap-2", List.of()))).containsEntry("verified", true);
        assertThat(Json.map(body(open("o1", "snap-2", List.of())).get("retired"))).isEqualTo(
                Map.of("delivery", 1, "device", 1, "participation", 1, "settings", 1, "user", 1));
        assertThat(store.rows("SELECT user_id FROM settings")).isEmpty();
        assertThat(store.rows("SELECT projection_type FROM projections")).isEmpty();
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='tok-1'"))
                .containsEntry("active", false);
        // 발송 이력의 참조가 남아 있으므로 삭제가 아니라 종결이다.
        assertThat(store.one("SELECT status FROM deliveries WHERE event_id='ev-1'"))
                .containsEntry("status", "SUPPRESSED");
    }

    @Test
    void firstOpenRetirementWaitsBeforeLockingRealRowsDuringWithdrawal() throws Exception {
        load("initial", "snap-1", records(true, 5));
        load("empty-final", "snap-2", List.of());
        assertThat(body(verify("snap-2", List.of()))).containsEntry("verified", true);
        var held = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<?> withdrawal = executor.submit(() -> new TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        store.lock("device-ownership");
                        held.countDown();
                        awaitRelease(release);
                        inbound.accept(Map.of("eventId", "withdraw-retire-race", "schemaVersion", 1,
                                "type", "user.withdrawn", "userId", USER.toString(), "version", 8,
                                "occurredAt", DAY.toString(), "params", Map.of("authGeneration", 4)));
                    }));
            assertThat(held.await(5, TimeUnit.SECONDS)).isTrue();
            Future<MvcResult> opened = executor.submit(() -> open("open-race", "snap-2", List.of()));
            long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            boolean waiting = false;
            while (!waiting && System.nanoTime() < until) {
                waiting = store.one("SELECT pid FROM pg_stat_activity WHERE datname=current_database()"
                        + " AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%' LIMIT 1") != null;
                if (!waiting) {
                    Thread.sleep(10);
                }
            }
            assertThat(waiting).isTrue();
            // retire의 정렬상 delivery가 device보다 먼저다. 공통 잠금 대기 중 어느 실제 행도 잡지 않아야 한다.
            try (Connection probe = dataSource.getConnection(); Statement sql = probe.createStatement()) {
                probe.setAutoCommit(false);
                sql.execute("SELECT user_id FROM settings WHERE user_id='" + USER + "' FOR UPDATE NOWAIT");
                sql.execute("SELECT id FROM deliveries WHERE event_id='ev-1' FOR UPDATE NOWAIT");
                sql.execute("SELECT device_token FROM device_tokens WHERE device_token='tok-1' FOR UPDATE NOWAIT");
                probe.rollback();
            }
            release.countDown();
            withdrawal.get(10, TimeUnit.SECONDS);
            assertThat(opened.get(10, TimeUnit.SECONDS).getResponse().getStatus()).isEqualTo(200);
            assertThat(store.one("SELECT enabled,ever_opened FROM dispatch_control WHERE id=1"))
                    .containsEntry("enabled", true).containsEntry("ever_opened", true);
            assertThat(store.rows("SELECT * FROM settings")).isEmpty();
            assertThat(store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", USER))
                    .containsEntry("withdrawn", true);
            assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='tok-1'"))
                    .containsEntry("active", false);
            assertThat(store.one("SELECT status FROM deliveries WHERE event_id='ev-1'"))
                    .containsEntry("status", "SUPPRESSED");
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }

    /** 세대를 선언하지 않은 빈 적재는 아무 뜻도 없다 — 전량 제거 선언으로 받아 주지 않는다. */
    @Test
    void anEmptyImportWithoutASnapshotIsStillRejected() throws Exception {
        assertThat(code(load("i1", List.of()))).isEqualTo("INVALID_records");
    }

    // ── 레코드·매니페스트 ──────────────────────────────────────────────

    private static Map<String, Object> window(int hours) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("from", DAY.minusSeconds(hours * 3600L).toEpochMilli());
        body.put("to", DAY.toEpochMilli());
        return body;
    }

    private static List<Map<String, Object>> records(boolean enabled, long version) {
        return List.of(settingsRecord(enabled, version), deviceRecord(3L, true), deliveryRecord("PENDING", 0));
    }

    private static Map<String, Object> settingsRecord(boolean enabled, long version) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("userId", USER.toString());
        data.put("version", version);
        data.put("notificationEnabled", enabled);
        data.put("soundEnabled", true);
        data.put("nightModeEnabled", true);
        data.put("nightStartTime", "23:00:00");
        data.put("nightEndTime", "07:00:00");
        return record("settings", data);
    }

    private static Map<String, Object> deviceRecord(long generation, boolean active) {
        return deviceRecord("tok-1", generation, active);
    }

    private static Map<String, Object> deviceRecord(String token, long generation, boolean active) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("deviceToken", token);
        data.put("userId", USER.toString());
        data.put("authGeneration", generation);
        data.put("active", active);
        return record("device", data);
    }

    private static Map<String, Object> deliveryRecord(String status, long attempts) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("eventId", "ev-1");
        data.put("userId", USER.toString());
        data.put("kind", "BET_RESULT");
        data.put("subjectId", null);
        data.put("groupId", null);
        data.put("slotAt", null);
        data.put("locale", "ko");
        data.put("status", status);
        data.put("attempts", attempts);
        data.put("nextAttemptAt", DAY.toEpochMilli());
        data.put("sentAt", null);
        data.put("params", Map.of("count", 1));
        return record("delivery", data);
    }

    private static Map<String, Object> userRecord(String displayName, long version) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("userId", USER.toString());
        data.put("version", version);
        data.put("displayName", displayName);
        data.put("locale", "ko");
        data.put("settingsPresent", true);
        data.put("notificationEnabled", true);
        data.put("soundEnabled", false);
        data.put("nightModeEnabled", true);
        data.put("nightStartTime", "23:00:00");
        data.put("nightEndTime", "07:00:00");
        return record("user", data);
    }

    private static Map<String, Object> participationRecord(UUID session, long version) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("userId", USER.toString());
        data.put("sessionId", session.toString());
        data.put("version", version);
        data.put("challengeId", CHALLENGE.toString());
        data.put("groupId", GROUP.toString());
        data.put("sessionStatus", "OPEN");
        data.put("stake", 30);
        data.put("joinClosesAt", DAY.toEpochMilli());
        // 정산 전에는 판정이 «없다» — false 로 접으면 상태가 하나 사라진다.
        data.put("achieved", null);
        return record("participation", data);
    }

    private static Map<String, Object> record(String resource, Map<String, Object> data) {
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("resource", resource);
        record.put("data", data);
        return record;
    }

    /**
     * N2 가 계산해야 할 매니페스트를 «테스트가 직접» 접어서 만든다 — 서버 값을 되받아 쓰지 않는다.
     * Data 의 내보내기와 같은 모양으로 다섯 자원을 «언제나» 싣는다: 0건 자원도 count=0 · SHA256("") 다
     * (NotificationMigrationManifest.ResourceDigest). 빠뜨린 것과 비어 있는 것을 구분하기 위해서다.
     */
    private static Map<String, Object> manifest(List<Map<String, Object>> records, long version, long queueDepth) {
        return manifest(null, records, version, queueDepth);
    }

    private static Map<String, Object> manifest(String snapshot, List<Map<String, Object>> records, long version,
            long queueDepth) {
        Map<String, List<String>> lines = new TreeMap<>();
        MigrationRecords.RESOURCES.forEach(resource -> lines.put(resource, new ArrayList<>()));
        for (Map<String, Object> entry : records) {
            String resource = entry.get("resource").toString();
            Map<String, Object> canonical = MigrationRecords.canonical(resource, Json.map(entry.get("data")));
            lines.computeIfAbsent(resource, ignored -> new ArrayList<>())
                    .add(resource + ":" + MigrationRecords.recordKey(resource, canonical)
                            + "=" + MigrationRecords.checksum(canonical));
        }
        Map<String, Object> resources = new LinkedHashMap<>();
        lines.forEach((resource, folded) -> {
            List<String> sorted = new ArrayList<>(folded);
            java.util.Collections.sort(sorted);
            StringBuilder fold = new StringBuilder();
            sorted.forEach(line -> fold.append(line).append('\n'));
            resources.put(resource, Map.of("count", sorted.size(), "checksum", Json.digest(fold.toString())));
        });
        Map<String, Object> stopWindow = new LinkedHashMap<>();
        stopWindow.put("closedAt", CLOSED_AT);
        stopWindow.put("cursor", "outbox-4821");
        stopWindow.put("queueDepth", queueDepth);
        stopWindow.put("source", "data-api");
        Map<String, Object> manifest = new LinkedHashMap<>();
        manifest.put("version", version);
        if (snapshot != null) {
            manifest.put("snapshot", snapshot);
        }
        manifest.put("resources", resources);
        manifest.put("stopWindow", stopWindow);
        return manifest;
    }

    // ── HTTP 도구 ──────────────────────────────────────────────────────

    private MvcResult load(String key, List<Map<String, Object>> records) throws Exception {
        return post("/internal/admin/migration/m1/import", key, Map.of("records", records));
    }

    /** 스냅샷 세대를 실어 올리는 적재. 운영 CLI 는 한 export 의 모든 청크에 같은 값을 반복한다. */
    private MvcResult load(String key, String snapshot, List<Map<String, Object>> records) throws Exception {
        return post("/internal/admin/migration/m1/import", key,
                Map.of("snapshot", snapshot, "records", records));
    }

    private MvcResult verify(List<Map<String, Object>> records, long version, long queueDepth) throws Exception {
        return post("/internal/admin/migration/m1/verify", null,
                Map.of("manifest", manifest(null, records, version, queueDepth)));
    }

    private MvcResult verify(String snapshot, List<Map<String, Object>> records) throws Exception {
        return post("/internal/admin/migration/m1/verify", null,
                Map.of("manifest", manifest(snapshot, records, 1, 0)));
    }

    private MvcResult open(String key, List<Map<String, Object>> records, long version) throws Exception {
        return post("/internal/admin/migration/m1/dispatch/open", key,
                Map.of("manifest", manifest(null, records, version, 0)));
    }

    private MvcResult open(String key, String snapshot, List<Map<String, Object>> records) throws Exception {
        return post("/internal/admin/migration/m1/dispatch/open", key,
                Map.of("manifest", manifest(snapshot, records, 1, 0)));
    }

    private MvcResult post(String path, String key, Map<String, Object> body) throws Exception {
        MockHttpServletRequestBuilder builder = MockMvcRequestBuilders.post(path)
                .header("Authorization", "Bearer test-console-2").header("X-Console-Actor", "member-2")
                .contentType(MediaType.APPLICATION_JSON).content(Json.write(body));
        return mvc.perform(key == null ? builder : builder.header("Idempotency-Key", key)).andReturn();
    }

    private static List<String> reasons(Map<String, Object> report) {
        return ((List<?>) report.get("failures")).stream()
                .map(failure -> Json.map(failure).get("reason").toString()).toList();
    }

    private static Map<String, Object> body(MvcResult result) throws Exception {
        return Json.map(result.getResponse().getContentAsString());
    }

    private static String code(MvcResult result) throws Exception {
        return String.valueOf(body(result).get("code"));
    }
}
