package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.dto.req.LogoutRequest;
import com.oneorthree.phone.auth.dto.res.GuestLoginResponse;
import com.oneorthree.phone.auth.exception.AuthErrorCode;
import com.oneorthree.phone.auth.exception.AuthException;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.internal.dto.NotificationSettingsCommandResponse;
import com.oneorthree.phone.internal.dto.NotificationSettingsPatchRequest;
import com.oneorthree.phone.internal.dto.NotificationSettingsSnapshotRequest;
import com.oneorthree.phone.internal.service.InternalNotificationSettingsService;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.repository.CommandIdempotencyRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.service.UserService;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 Flyway PostgreSQL·생산 서비스·등록된 필터로 설정 명령의 원자성/재생/세션 경합을 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
class NotificationSettingsCommandIntegrationTest {
    private static final String TOKEN = "test-settings-business-to-data";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]",
                () -> "PATCH /internal/users/*/notification-settings-commands");
        registry.add("internal.api.callers.business.allow[1]",
                () -> "POST /internal/users/*/notification-settings-snapshot");
    }

    @Autowired
    InternalNotificationSettingsService service;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    UserService legacy;
    @Autowired
    AccountWithdrawalService withdrawal;
    @Autowired
    EventOutboxRepository events;
    @Autowired
    CommandIdempotencyRepository receipts;
    @Autowired
    PlatformTransactionManager transactions;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;

    @Test
    @DisplayName("내부 PATCH는 저장한 mask·baseline·명령 버전과 공개 결과를 직접 반환한다")
    void actualInternalRouteReturnsDurableCommand() throws Exception {
        var actor = actor();
        mvc.perform(patch(path(actor) + "-commands").header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", actor.userId()).header("Idempotency-Key", UUID.randomUUID())
                        .contentType("application/json").content(body(actor, "false")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.commandId").isString())
                .andExpect(jsonPath("$.version").isNumber())
                .andExpect(jsonPath("$.mask[0]").value("notificationEnabled"))
                .andExpect(jsonPath("$.patch.notificationEnabled").value(false))
                .andExpect(jsonPath("$.baseline.notificationEnabled").value(false))
                .andExpect(jsonPath("$.result.notifications").value(false))
                .andExpect(jsonPath("$.data").doesNotExist());
        mvc.perform(post(path(actor) + "-snapshot").header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", actor.userId()).contentType("application/json")
                        .content("{\"sessionId\":\"" + actor.sessionId() + "\",\"authGeneration\":0}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.settings.notificationEnabled").value(false));
    }

    @Test
    @DisplayName("문자열 boolean·null·미지 필드·타 사용자 위임은 실제 내부 필터/역직렬화에서 차단한다")
    void strictInputAndDelegation() throws Exception {
        var actor = actor();
        for (String value : List.of("\"false\"", "null", "1")) {
            mvc.perform(patch(path(actor) + "-commands").header("Authorization", "Bearer " + TOKEN)
                            .header("X-User-Id", actor.userId()).header("Idempotency-Key", UUID.randomUUID())
                            .contentType("application/json").content(body(actor, value)))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(patch(path(actor) + "-commands").header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", actor.userId()).header("Idempotency-Key", UUID.randomUUID())
                        .contentType("application/json").content(body(actor, "false").replace("}", ",\"extra\":1}")))
                .andExpect(status().isBadRequest());
        mvc.perform(patch(path(actor) + "-commands").header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", UUID.randomUUID()).header("Idempotency-Key", UUID.randomUUID())
                        .contentType("application/json").content(body(actor, "false")))
                .andExpect(status().isForbidden());
        assertThat(settingsEvents(actor)).isEmpty();
    }

    @Test
    @DisplayName("현재 값이 바뀌어도 같은 키는 최초 결과/baseline/eventId를 재생하고 다른 본문은409다")
    void replaysOriginalPatchAndRejectsDifferentIntent() {
        var actor = actor();
        UUID key = UUID.randomUUID();
        var original = service.patch(actor.userId(), request(actor, false), key);
        var later = service.patch(actor.userId(), request(actor, true), UUID.randomUUID());
        assertThat(service.patch(actor.userId(), request(actor, false), key)).isEqualTo(original);
        assertThat(service.snapshot(actor.userId(), proof(actor)).settings().notificationEnabled()).isTrue();
        assertThat(later.version()).isGreaterThan(original.version());
        assertThatThrownBy(() -> service.patch(actor.userId(), request(actor, true), key))
                .isInstanceOf(OutboxException.class).extracting("errorCode")
                .isEqualTo(OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
        assertThat(settingsEvents(actor)).hasSize(2);
        var event = events.findByEventId(original.eventId()).orElseThrow();
        assertThat(event.getParams()).containsKeys("mask", "patch", "baseline", "authGeneration");
        assertThat(receiptCount(actor)).isEqualTo(2);
    }

    @Test
    @DisplayName("미러·버전·receipt·outbox는 바깥 트랜잭션 rollback 때 모두 함께 사라진다")
    void rollbackPreservesOriginalMirrorAndVersion() {
        var actor = actor();
        var original = service.snapshot(actor.userId(), proof(actor));
        UUID key = UUID.randomUUID();
        assertThatThrownBy(() -> tx().executeWithoutResult(status -> {
            service.patch(actor.userId(), request(actor, false), key);
            throw new IllegalStateException("강제 rollback");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(service.snapshot(actor.userId(), proof(actor))).isEqualTo(original);
        assertThat(settingsEvents(actor)).isEmpty();
        assertThat(receiptCount(actor)).isZero();
        assertThat(service.patch(actor.userId(), request(actor, false), key).result().notifications()).isFalse();
    }

    @Test
    @DisplayName("같은 키 동시 명령은 실제 PostgreSQL 잠금에서 기다리고 단일 receipt/outbox로 수렴한다")
    void concurrentSameKeyReturnsOneCommand() throws Exception {
        var actor = actor();
        UUID key = UUID.randomUUID();
        var executor = Executors.newSingleThreadExecutor();
        var followerPid = new AtomicInteger();
        var started = new CountDownLatch(1);
        var follower = new java.util.concurrent.atomic.AtomicReference<
                java.util.concurrent.Future<NotificationSettingsCommandResponse>>();
        try {
            var first = tx().execute(status -> {
                var result = service.patch(actor.userId(), request(actor, false), key);
                follower.set(executor.submit(() -> tx().execute(other -> {
                    followerPid.set(jdbc.queryForObject("select pg_backend_pid()", Integer.class));
                    started.countDown();
                    return service.patch(actor.userId(), request(actor, false), key);
                })));
                await(started);
                awaitDatabaseLock(followerPid.get());
                return result;
            });
            assertThat(follower.get().get(20, TimeUnit.SECONDS)).isEqualTo(first);
            assertThat(settingsEvents(actor)).hasSize(1);
            assertThat(receiptCount(actor)).isEqualTo(1);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    @DisplayName("로그아웃이 user 잠금을 먼저 잡으면 대기하던 설정은 폐기 세션으로 거부된다")
    void concurrentLogoutPreventsLatePatch() throws Exception {
        var actor = actor();
        var executor = Executors.newSingleThreadExecutor();
        var started = new CountDownLatch(1);
        var pid = new AtomicInteger();
        var follower = new java.util.concurrent.atomic.AtomicReference<java.util.concurrent.Future<?>>();
        try {
            tx().executeWithoutResult(status -> {
                auth.logout(new LogoutRequest(actor.login().refreshToken()));
                follower.set(executor.submit(() -> tx().executeWithoutResult(other -> {
                    pid.set(jdbc.queryForObject("select pg_backend_pid()", Integer.class));
                    started.countDown();
                    service.patch(actor.userId(), request(actor, false), UUID.randomUUID());
                })));
                await(started);
                awaitDatabaseLock(pid.get());
            });
            assertThatThrownBy(() -> follower.get().get(20, TimeUnit.SECONDS))
                    .hasCauseInstanceOf(AuthException.class);
            assertThat(settingsEvents(actor)).isEmpty();
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    @DisplayName("legacy 전체 교체도 outbox를 남기고 부분 변경은 소리/심야의 실제 값을 보존한다")
    void legacyFullAndPartialShareMirrorAndVersion() {
        var actor = actor();
        NotificationSettingsRequest full = fullSettings(false, false, true, "22:00", "07:00");
        legacy.updateNotificationSettings(actor.userId(), full);
        var fullSnapshot = service.snapshot(actor.userId(), proof(actor));
        var partial = service.patch(actor.userId(), request(actor, true), UUID.randomUUID());
        assertThat(partial.version()).isGreaterThan(fullSnapshot.version());
        assertThat(partial.baseline().soundEnabled()).isFalse();
        assertThat(partial.baseline().nightModeEnabled()).isTrue();
        assertThat(partial.baseline().nightStartTime()).isEqualTo("22:00");
        legacy.updateNotificationSettings(actor.userId(), fullSettings(false, true, false, null, null));
        var finalSnapshot = service.snapshot(actor.userId(), proof(actor));
        assertThat(finalSnapshot.version()).isGreaterThan(partial.version());
        assertThat(finalSnapshot.settings().notificationEnabled()).isFalse();
        assertThat(finalSnapshot.settings().nightStartTime()).isNull();
        assertThat(finalSnapshot.settings().nightEndTime()).isNull();
        assertThat(settingsEvents(actor)).hasSize(3);
        assertThat(settingsEvents(actor).get(0).getParams()).containsKey("authGeneration");
    }

    @Test
    @DisplayName("snapshot은 미커밋 writer를 기다린 뒤 새 값과 그 버전을 함께 읽는다")
    void snapshotWaitsForSettingsCommit() throws Exception {
        var actor = actor();
        var executor = Executors.newSingleThreadExecutor();
        var started = new CountDownLatch(1);
        var pid = new AtomicInteger();
        var reader = new java.util.concurrent.atomic.AtomicReference<java.util.concurrent.Future<
                com.oneorthree.phone.internal.dto.NotificationSettingsSnapshotResponse>>();
        try {
            var command = tx().execute(status -> {
                var result = service.patch(actor.userId(), request(actor, false), UUID.randomUUID());
                reader.set(executor.submit(() -> tx().execute(other -> {
                    pid.set(jdbc.queryForObject("select pg_backend_pid()", Integer.class));
                    started.countDown();
                    return service.snapshot(actor.userId(), proof(actor));
                })));
                await(started);
                awaitDatabaseLock(pid.get());
                return result;
            });
            var snapshot = reader.get().get(20, TimeUnit.SECONDS);
            assertThat(snapshot.version()).isEqualTo(command.version());
            assertThat(snapshot.settings()).isEqualTo(command.baseline());
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    @DisplayName("성공 receipt가 있어도 로그아웃 후 재생과 snapshot은 차단되고 타인 sid/gen도 통과 못한다")
    void currentSessionAndGenerationAreRecheckedBeforeReplay() {
        var actor = actor();
        var other = actor();
        UUID key = UUID.randomUUID();
        service.patch(actor.userId(), request(actor, false), key);
        for (var invalid : List.of(new NotificationSettingsPatchRequest(false, other.sessionId(), 0L),
                new NotificationSettingsPatchRequest(false, actor.sessionId(), 1L),
                new NotificationSettingsPatchRequest(false, null, 0L))) {
            assertThatThrownBy(() -> service.patch(actor.userId(), invalid, key))
                    .isInstanceOf(AuthException.class).extracting("errorCode")
                    .isEqualTo(AuthErrorCode.SESSION_NOT_ACTIVE);
        }
        auth.logout(new LogoutRequest(actor.login().refreshToken()));
        assertThatThrownBy(() -> service.patch(actor.userId(), request(actor, false), key))
                .isInstanceOf(AuthException.class);
        assertThatThrownBy(() -> service.snapshot(actor.userId(), proof(actor))).isInstanceOf(AuthException.class);
        assertThat(settingsEvents(actor)).hasSize(1);
    }

    @Test
    @DisplayName("실제 탈퇴 후 신규 snapshot/명령 재생과 legacy writer는 설정 행을 부활시키지 않는다")
    void withdrawalBlocksAllSettingsWritersAndReplay() {
        var actor = actor();
        UUID key = UUID.randomUUID();
        service.patch(actor.userId(), request(actor, false), key);
        withdrawal.withdraw(actor.userId());
        assertThatThrownBy(() -> service.patch(actor.userId(), request(actor, false), key))
                .isInstanceOf(UserException.class);
        assertThatThrownBy(() -> service.snapshot(actor.userId(), proof(actor))).isInstanceOf(UserException.class);
        assertThatThrownBy(() -> legacy.updateNotificationSettings(actor.userId(),
                fullSettings(true, true, false, null, null))).isInstanceOf(UserException.class);
        assertThat(jdbc.queryForObject("select count(*) from user_notification_settings where user_id=?",
                Long.class, actor.userId())).isZero();
    }

    private Actor actor() {
        var login = auth.guestLogin();
        return new Actor(jwt.extractUserId(login.accessToken()), login.sessionId(), login);
    }

    private static NotificationSettingsPatchRequest request(Actor actor, boolean enabled) {
        return new NotificationSettingsPatchRequest(enabled, actor.sessionId(), 0L);
    }

    private static NotificationSettingsSnapshotRequest proof(Actor actor) {
        return new NotificationSettingsSnapshotRequest(actor.sessionId(), 0L);
    }

    private static String path(Actor actor) {
        return "/internal/users/" + actor.userId() + "/notification-settings";
    }

    private static String body(Actor actor, String enabled) {
        return "{\"notifications\":" + enabled + ",\"sessionId\":\"" + actor.sessionId()
                + "\",\"authGeneration\":0}";
    }

    private List<EventOutbox> settingsEvents(Actor actor) {
        return events.findAll().stream().filter(row -> actor.userId().equals(row.getUserId()))
                .filter(row -> "notification.settings.changed".equals(row.getType())).toList();
    }

    private long receiptCount(Actor actor) {
        return receipts.findAll().stream().filter(row -> actor.userId().equals(row.getUserId())).count();
    }

    private static NotificationSettingsRequest fullSettings(boolean enabled, boolean sound, boolean night,
                                                            String start, String end) {
        var request = new NotificationSettingsRequest();
        ReflectionTestUtils.setField(request, "notificationEnabled", enabled);
        ReflectionTestUtils.setField(request, "soundEnabled", sound);
        ReflectionTestUtils.setField(request, "nightModeEnabled", night);
        ReflectionTestUtils.setField(request, "nightStartTime", start);
        ReflectionTestUtils.setField(request, "nightEndTime", end);
        return request;
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactions);
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(20, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError(e);
        }
    }

    /** Thread 시작 여부와 실제 DB 잠금 대기를 구분하여 잠금이 없는 코드가 우연히 통과하지 못하게 한다. */
    private void awaitDatabaseLock(int pid) {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            Boolean waiting = jdbc.queryForObject("select cardinality(pg_blocking_pids(?)) > 0", Boolean.class, pid);
            if (Boolean.TRUE.equals(waiting)) {
                return;
            }
            Thread.onSpinWait();
        }
        throw new AssertionError("실제 PostgreSQL 행 잠금 대기가 관측되지 않았습니다.");
    }

    private record Actor(UUID userId, UUID sessionId, GuestLoginResponse login) {
    }
}
