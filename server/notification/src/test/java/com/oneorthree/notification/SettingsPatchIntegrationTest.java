package com.oneorthree.notification;

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
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 Flyway/PostgreSQL과 생산 서비스로 부분 명령·legacy·탈퇴·이관 경계를 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("ci")
@Testcontainers
class SettingsPatchIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("11111111-1111-4111-8111-111111111111");
    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }

    @Autowired SettingsService settings;
    @Autowired InboundService inbound;
    @Autowired Store store;
    @Autowired MockMvc mvc;
    @Autowired PlatformTransactionManager transactions;
    @MockitoBean PushTransport transport;
    @MockitoBean DataClient data;

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE settings,user_fences,commands,inbound_events,projections,deliveries,"
                + "device_tokens,session_fences,legacy_session_fences CASCADE");
        store.update("UPDATE dispatch_control SET enabled=false,ever_opened=false,active_migration_id=NULL");
    }

    @Test
    void firstPartialUsesVerifiedBaselineAndRelayCanInitializeWithoutBusiness() {
        open();
        Map<String, Object> body = partial("notificationEnabled", false, 0);
        Map<String, Object> baseline = Json.map(body.get("baseline"));
        baseline.put("soundEnabled", false);
        body.put("baseline", baseline);
        inbound.accept(event("first", "notification.settings.changed", 42, body));
        assertThat(settings.read(USER)).containsEntry("notificationEnabled", false).containsEntry("soundEnabled", false);
        assertThat(store.one("SELECT notification_enabled_version,sound_enabled_version FROM settings WHERE user_id=?", USER))
                .containsEntry("notification_enabled_version", 42L).containsEntry("sound_enabled_version", 42L);
    }

    @Test
    void differentFieldsArrivingInReverseOrderSurviveAndSameFieldCannotRegress() {
        settings.apply(USER, full(true), 40, "initial");
        open();
        settings.patch(USER, partial("notificationEnabled", false, 0), 42, "new-off");
        settings.patch(USER, partial("soundEnabled", false, 0), 41, "old-sound");
        settings.patch(USER, partial("notificationEnabled", true, 0), 41, "old-on");
        assertThat(settings.read(USER)).containsEntry("notificationEnabled", false).containsEntry("soundEnabled", false)
                .containsEntry("nightModeEnabled", true).containsEntry("nightStartTime", "23:05");
        assertThat(store.one("SELECT version,sound_enabled_version FROM settings WHERE user_id=?", USER))
                .containsEntry("version", 42L).containsEntry("sound_enabled_version", 41L);
    }

    @Test
    void legacyFullAndPartialShareTheSameFieldVersions() {
        settings.apply(USER, full(true), 40, "initial");
        open();
        settings.patch(USER, partial("notificationEnabled", false, 0), 42, "partial");
        Map<String, Object> older = full(true);
        older.put("soundEnabled", false);
        settings.apply(USER, older, 41, "legacy-old");
        assertThat(settings.read(USER)).containsEntry("notificationEnabled", false).containsEntry("soundEnabled", false);
        settings.apply(USER, full(true), 43, "legacy-new");
        settings.patch(USER, partial("soundEnabled", false, 0), 42, "late-partial");
        assertThat(settings.read(USER)).containsEntry("notificationEnabled", true).containsEntry("soundEnabled", true);
    }

    @Test
    void quietTimeNullClearsOnlyTheSelectedField() {
        settings.apply(USER, full(true), 1, "initial");
        open();
        settings.patch(USER, partial("nightStartTime", null, 0), 2, "clear");
        assertThat(settings.read(USER)).containsEntry("nightStartTime", null).containsEntry("nightEndTime", "07:09");
    }

    @Test
    void replayPreservesOriginalSuccessWithoutApplyingOldValuesAndDifferentBodyConflicts() {
        open();
        settings.patch(USER, partial("notificationEnabled", false, 0), 1, "same");
        settings.patch(USER, partial("notificationEnabled", true, 0), 2, "new");
        assertThat(settings.patch(USER, partial("notificationEnabled", false, 0), 1, "same"))
                .containsEntry("applied", true);
        assertThat(settings.read(USER)).containsEntry("notificationEnabled", true);
        assertThatThrownBy(() -> settings.patch(USER, partial("notificationEnabled", true, 0), 1, "same"))
                .hasMessage("IDEMPOTENCY_KEY_CONFLICT");
    }

    @Test
    void migrationGateBlocksPartialAndInitializationButClosingDispatchDoesNot() {
        assertThatThrownBy(() -> settings.patch(USER, partial("notificationEnabled", false, 0), 1, "blocked"))
                .hasMessage("MIGRATION_NOT_READY");
        assertThatThrownBy(() -> settings.initialize(USER, baseline(0, 0, full(false))))
                .hasMessage("MIGRATION_NOT_READY");
        assertThat(store.rows("SELECT * FROM settings")).isEmpty();
        assertThat(store.rows("SELECT * FROM commands")).isEmpty();
        open();
        settings.patch(USER, partial("notificationEnabled", false, 0), 1, "blocked");
        assertThat(settings.read(USER)).containsEntry("notificationEnabled", false);
    }

    @Test
    void initializeReadsCurrentStateWithoutCachingOrOverwritingBaselineAndKeepsLegacyDefaults() {
        assertThat(settings.read(USER)).containsEntry("notificationEnabled", true);
        open();
        assertThat(settings.initialize(USER, baseline(0, 0, full(false))))
                .containsEntry("notificationEnabled", false);
        settings.patch(USER, partial("notificationEnabled", true, 0), 1, "on");
        assertThat(settings.initialize(USER, baseline(0, 0, full(false))))
                .containsEntry("notificationEnabled", true);
        assertThat(store.rows("SELECT * FROM commands")).hasSize(1);
    }

    @Test
    void preOpenImportScalarRemainsTheBaselineForAllFieldsOnFirstPostOpenWrite() {
        store.update("INSERT INTO settings(user_id,version,notification_enabled,imported_by) VALUES(?,40,true,'m')", USER);
        // 기존 import가 같은/더 높은 scalar와 값을 갱신하는 동안 필드 version은 아직 비어 있어야 한다.
        store.update("UPDATE settings SET version=45,sound_enabled=false WHERE user_id=?", USER);
        open();
        settings.patch(USER, partial("notificationEnabled", false, 0), 46, "new");
        settings.patch(USER, partial("soundEnabled", true, 0), 44, "late");
        assertThat(settings.read(USER)).containsEntry("soundEnabled", false);
        assertThat(store.one("SELECT sound_enabled_version,imported_by FROM settings WHERE user_id=?", USER))
                .containsEntry("sound_enabled_version", 45L).containsEntry("imported_by", null);
    }

    @Test
    void withdrawalDeletesSettingsAndRejectsLateDirectInitializationAndReplayWhileRelayIsNoOp() {
        open();
        Map<String, Object> body = partial("notificationEnabled", false, 0);
        settings.patch(USER, body, 1, "first");
        inbound.accept(event("withdraw", "user.withdrawn", 2, Map.of("authGeneration", 1)));
        assertThatThrownBy(() -> settings.patch(USER, body, 1, "first")).hasMessage("STALE_AUTH_GENERATION");
        assertThatThrownBy(() -> settings.apply(USER, full(true), 3, "legacy")).hasMessage("STALE_AUTH_GENERATION");
        assertThatThrownBy(() -> settings.initialize(USER, baseline(3, 1, full(true))))
                .hasMessage("STALE_AUTH_GENERATION");
        inbound.accept(event("late", "notification.settings.changed", 3, body));
        assertThat(store.rows("SELECT * FROM settings")).isEmpty();
        assertThat(store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", USER)).containsEntry("withdrawn", true);
        assertThat(store.rows("SELECT * FROM inbound_events WHERE event_id='late'")).hasSize(1);
    }

    @Test
    void staleGenerationCannotWriteButRelayDoesNotBlockFollowingEvents() {
        open();
        inbound.accept(event("generation", "auth.generation.bumped", 4, Map.of("authGeneration", 3)));
        assertThatThrownBy(() -> settings.patch(USER, partial("notificationEnabled", true, 2), 5, "stale"))
                .hasMessage("STALE_AUTH_GENERATION");
        inbound.accept(event("stale-relay", "notification.settings.changed", 5, partial("notificationEnabled", true, 2)));
        settings.patch(USER, partial("notificationEnabled", false, 3), 6, "current");
        assertThat(settings.read(USER)).containsEntry("notificationEnabled", false);
    }

    @Test
    void legacyFiveFieldPutStillWorksAfterGenerationBumpWhileNewPatchRequiresCurrentGeneration() {
        open();
        inbound.accept(event("generation", "auth.generation.bumped", 4, Map.of("authGeneration", 3)));
        settings.apply(USER, full(false), 5, "legacy-after-login");
        assertThat(settings.read(USER)).containsEntry("notificationEnabled", false);
        assertThatThrownBy(() -> settings.patch(USER, partial("notificationEnabled", true, 2), 6, "stale"))
                .hasMessage("STALE_AUTH_GENERATION");
        inbound.accept(event("withdraw", "user.withdrawn", 7, Map.of("authGeneration", 4)));
        assertThatThrownBy(() -> settings.apply(USER, full(true), 8, "late-legacy"))
                .hasMessage("STALE_AUTH_GENERATION");
        assertThat(store.rows("SELECT * FROM settings")).isEmpty();
    }

    @Test
    void actualHttpRequiresBusinessDelegationAndValidatesPatchWithoutCallingExternalServices() throws Exception {
        open();
        String url = "/internal/users/" + USER + "/notification-settings";
        String body = Json.write(partial("notificationEnabled", false, 0));
        mvc.perform(MockMvcRequestBuilders.patch(url).queryParam("version", "1")
                .header("Authorization", "Bearer test-data").contentType("application/json").content(body))
                .andExpect(status().isForbidden());
        mvc.perform(MockMvcRequestBuilders.patch(url).queryParam("version", "1")
                .header("Authorization", "Bearer test-business").header("X-User-Id", UUID.randomUUID())
                .header("Idempotency-Key", "key").contentType("application/json").content(body))
                .andExpect(status().isForbidden());
        mvc.perform(MockMvcRequestBuilders.patch(url).queryParam("version", "1")
                .header("Authorization", "Bearer test-business").header("X-User-Id", USER)
                .header("Idempotency-Key", "key").contentType("application/json").content(body))
                .andExpect(status().isOk());
        mvc.perform(MockMvcRequestBuilders.post(url + "/initialized")
                .header("Authorization", "Bearer test-business").header("X-User-Id", USER)
                .contentType("application/json").content(Json.write(baseline(0, 0, full(true)))))
                .andExpect(status().isOk());
        Map<String, Object> bad = partial("notificationEnabled", false, 0);
        bad.put("mask", List.of("notificationEnabled", "notificationEnabled"));
        assertThatThrownBy(() -> settings.patch(USER, bad, 2, "bad")).hasMessage("INVALID_SETTINGS_PATCH");
        bad.put("mask", List.of("notificationEnabled"));
        bad.put("authGeneration", 1.5);
        assertThatThrownBy(() -> settings.patch(USER, bad, 2, "bad")).hasMessage("INVALID_AUTH_GENERATION");
    }

    @Test
    void actualGateLockMakesPartialWaitUntilOpeningTransactionCommits() throws Exception {
        var executor = Executors.newFixedThreadPool(2);
        var held = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try {
            var opener = executor.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(status -> {
                store.one("SELECT id FROM dispatch_control WHERE id=1 FOR UPDATE");
                held.countDown();
                await(release);
                open();
            }));
            assertThat(held.await(5, TimeUnit.SECONDS)).isTrue();
            var writer = executor.submit(() -> settings.patch(USER, partial("notificationEnabled", false, 0), 1, "race"));
            // 확인 가능한 DB 대기를 기준으로 잠금 경합을 증명한다. 단순 sleep 성공 판정이 아니다.
            long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            boolean blocked = false;
            while (!blocked && System.nanoTime() < until) {
                blocked = store.one("SELECT pid FROM pg_stat_activity WHERE datname=current_database()"
                        + " AND wait_event_type='Lock' AND query LIKE '%ever_opened%FOR SHARE%' LIMIT 1") != null;
                if (!blocked) {
                    Thread.sleep(10);
                }
            }
            assertThat(blocked).isTrue();
            release.countDown();
            opener.get(5, TimeUnit.SECONDS);
            assertThat(writer.get(5, TimeUnit.SECONDS)).containsEntry("applied", true);
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void withdrawalAndWriteUseTheSameDatabaseLockInBothCommitOrders() throws Exception {
        open();
        runWithdrawalRace(true);
        store.update("TRUNCATE settings,user_fences,commands,inbound_events CASCADE");
        runWithdrawalRace(false);
    }

    private void runWithdrawalRace(boolean withdrawalFirst) throws Exception {
        var executor = Executors.newFixedThreadPool(2);
        var held = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try {
            var first = executor.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(status -> {
                if (withdrawalFirst) {
                    inbound.accept(event("withdraw-first", "user.withdrawn", 3, Map.of("authGeneration", 1)));
                } else {
                    settings.patch(USER, partial("notificationEnabled", false, 0), 1, "write-first");
                }
                held.countDown();
                await(release);
            }));
            assertThat(held.await(5, TimeUnit.SECONDS)).isTrue();
            var second = executor.submit(() -> {
                if (withdrawalFirst) {
                    assertThatThrownBy(() -> settings.patch(USER, partial("notificationEnabled", true, 0), 2, "late"))
                            .hasMessage("STALE_AUTH_GENERATION");
                } else {
                    inbound.accept(event("withdraw-last", "user.withdrawn", 3, Map.of("authGeneration", 1)));
                }
            });
            long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            boolean blocked = false;
            while (!blocked && System.nanoTime() < until) {
                blocked = store.one("SELECT pid FROM pg_stat_activity WHERE datname=current_database()"
                        + " AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%' LIMIT 1") != null;
                if (!blocked) {
                    Thread.sleep(10);
                }
            }
            assertThat(blocked).isTrue();
            release.countDown();
            first.get(5, TimeUnit.SECONDS);
            second.get(5, TimeUnit.SECONDS);
            assertThat(store.rows("SELECT * FROM settings")).isEmpty();
            assertThat(store.one("SELECT withdrawn FROM user_fences WHERE user_id=?", USER))
                    .containsEntry("withdrawn", true);
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }

    private void open() {
        store.update("UPDATE dispatch_control SET ever_opened=true,enabled=false");
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new AssertionError("테스트 잠금 해제 시간 초과");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new AssertionError(interrupted);
        }
    }

    private static Map<String, Object> full(boolean enabled) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("notificationEnabled", enabled);
        result.put("soundEnabled", true);
        result.put("nightModeEnabled", true);
        result.put("nightStartTime", "23:05");
        result.put("nightEndTime", "07:09");
        return result;
    }

    private static Map<String, Object> partial(String field, Object value, long generation) {
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put(field, value);
        Map<String, Object> baseline = full(true);
        baseline.put(field, value);
        return new LinkedHashMap<>(Map.of("mask", List.of(field), "patch", patch,
                "authGeneration", generation, "baseline", baseline));
    }

    private static Map<String, Object> baseline(long version, long generation, Map<String, Object> settings) {
        return Map.of("version", version, "authGeneration", generation, "settings", settings);
    }

    private static Map<String, Object> event(String id, String type, long version, Map<String, Object> params) {
        return Map.of("eventId", id, "schemaVersion", 1, "type", type, "userId", USER.toString(),
                "version", version, "occurredAt", Instant.parse("2026-09-12T00:00:00Z").toString(), "params", params);
    }
}
