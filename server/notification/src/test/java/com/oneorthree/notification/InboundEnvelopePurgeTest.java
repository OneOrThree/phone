package com.oneorthree.notification;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 탈퇴자의 수신 원문 파기와 늦은 이벤트의 개인정보 재저장 차단을 실제 PostgreSQL 로 검증한다(GROMO-2212). */
@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class InboundEnvelopePurgeTest {

    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("11111111-1111-4111-8111-111111111111");
    static final UUID OTHER = UUID.fromString("22222222-2222-4222-8222-222222222222");
    static final String KIND = "PURGE_TEST";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }

    @Autowired Store store;
    @Autowired InboundService inbound;
    @Autowired DeviceService devices;
    @Autowired SettingsService settings;
    @Autowired PlatformTransactionManager transactions;
    @MockitoBean PushTransport transport;
    @MockitoBean DataClient data;

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE delivery_devices,deliveries,inbound_events,commands,device_tokens,"
                + "session_fences,legacy_session_fences,user_fences,settings,projections CASCADE");
        store.update("UPDATE dispatch_control SET enabled=false,ever_opened=false");
        store.update("INSERT INTO kinds(id,quiet_policy) VALUES(?,'BYPASS') ON CONFLICT DO NOTHING", KIND);
    }

    @Test
    void lateEventsAfterWithdrawalKeepOnlyTheHashAndRecreateNoPersonalCopies() {
        inbound.accept(request("other", OTHER));
        inbound.accept(withdrawal("withdraw"));

        inbound.accept(request("late-request", USER));
        inbound.accept(NotificationStoreTest.event("late-settings", "notification.settings.changed", USER, 4, null,
                NotificationStoreTest.preferences(false)));
        // 소유권이 어느 행과도 맞지 않는 삭제 — 등록 전 도착 tombstone 을 만들던 자리다.
        inbound.accept(deletion("late-delete", UUID.randomUUID().toString()));
        // 형식이 깨진 소유권 — 아무 잠금 없이 조기 소비되어 accept 의 fence 읽기만이 원문 저장을 막는다.
        inbound.accept(deletion("late-broken", "broken"));

        assertThat(count("SELECT count(*) FROM inbound_events WHERE user_id=?", USER)).isEqualTo(5);
        assertThat(count("SELECT count(*) FROM inbound_events WHERE user_id=?"
                + " AND (envelope IS NOT NULL OR envelope_hash IS NULL)", USER)).isZero();
        assertThat(count("SELECT count(*) FROM deliveries WHERE user_id=?", USER)).isZero();
        assertThat(count("SELECT count(*) FROM device_tokens WHERE user_id=?", USER)).isZero();
        assertThat(count("SELECT count(*) FROM settings WHERE user_id=?", USER)).isZero();
        // 다른 활성 사용자의 무관한 기록은 그대로다.
        assertThat(count("SELECT count(*) FROM inbound_events WHERE event_id='other' AND envelope IS NOT NULL"))
                .isEqualTo(1);
        assertThat(count("SELECT count(*) FROM deliveries WHERE user_id=?", OTHER)).isEqualTo(1);
    }

    @Test
    void withdrawalAndInboundSerializeOnTheUserFenceInBothCommitOrders() throws Exception {
        race(true, deletion("race-broken", "broken"));
        race(false, deletion("race-broken", "broken"));
        race(false, request("race-request", USER));
    }

    @Test
    void purgedEventIdStillAcceptsTheSameEnvelopeAndRejectsADifferentOne() {
        Map<String, Object> original = request("request", USER);
        inbound.accept(original);
        inbound.accept(withdrawal("withdraw"));
        assertThat(count("SELECT count(*) FROM inbound_events WHERE event_id='request' AND envelope IS NULL"))
                .isEqualTo(1);
        // 재전달이 apply 를 다시 탔다면 지운 kind 때문에 UNKNOWN_NOTIFICATION_KIND 로 실패한다.
        store.update("DELETE FROM kinds WHERE id=?", KIND);

        List<String> keys = new ArrayList<>(original.keySet());
        Collections.reverse(keys);
        Map<String, Object> reordered = new LinkedHashMap<>();
        keys.forEach(key -> reordered.put(key, original.get(key)));
        assertThat(Json.write(reordered)).isNotEqualTo(Json.write(original));
        assertThat(inbound.accept(reordered)).containsEntry("accepted", true);

        Map<String, Object> changed = new LinkedHashMap<>(original);
        changed.put("params", Map.of("kind", "OTHER_KIND"));
        assertThatThrownBy(() -> inbound.accept(changed)).hasMessage("EVENT_ID_CONFLICT");
    }

    @Test
    void repeatedWithdrawalIsIdempotentAndForgetsOnlyTheWithdrawnUsersReceipts() {
        devices.register(USER, Map.of("deviceToken", "device", "deviceBootstrap", "bootstrap",
                "sessionEpoch", 1, "authGeneration", 0), "register");
        devices.register(OTHER, Map.of("deviceToken", "other-device", "deviceBootstrap", "other-bootstrap",
                "sessionEpoch", 1, "authGeneration", 0), "register");
        settings.apply(USER, NotificationStoreTest.preferences(true), 1, "settings");
        inbound.accept(request("request", USER));

        Map<String, Object> first = withdrawal("withdraw");
        inbound.accept(first);
        inbound.accept(first);
        inbound.accept(withdrawal("withdraw-reconcile"));

        assertThat(store.rows("SELECT scope FROM commands")).extracting(row -> row.get("scope"))
                .containsExactly("device-register:" + OTHER);
        assertThat(count("SELECT count(*) FROM inbound_events WHERE user_id=?", USER)).isEqualTo(3);
        assertThat(count("SELECT count(*) FROM inbound_events WHERE user_id=? AND envelope IS NOT NULL", USER))
                .isZero();
        assertThat(count("SELECT count(*) FROM deliveries WHERE user_id=?", USER)).isZero();
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='other-device'"))
                .containsEntry("active", true);
    }

    /** 먼저 연 TX 가 커밋을 미루는 동안 다른 쪽이 advisory 잠금에서 기다리고, 어느 순서든 원문이 남지 않는다. */
    private void race(boolean withdrawalFirst, Map<String, Object> late) throws Exception {
        resetState();
        Map<String, Object> withdrawal = withdrawal("race-withdraw");
        var executor = Executors.newFixedThreadPool(2);
        var held = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try {
            var first = executor.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(status -> {
                inbound.accept(withdrawalFirst ? withdrawal : late);
                held.countDown();
                await(release);
            }));
            assertThat(held.await(5, TimeUnit.SECONDS)).isTrue();
            var second = executor.submit(() -> inbound.accept(withdrawalFirst ? late : withdrawal));
            assertThat(waitsOnAdvisoryLock()).as("뒤 TX 가 같은 사용자 잠금에서 기다려야 한다").isTrue();
            release.countDown();
            first.get(5, TimeUnit.SECONDS);
            second.get(5, TimeUnit.SECONDS);
            assertThat(count("SELECT count(*) FROM inbound_events WHERE user_id=? AND envelope IS NULL"
                    + " AND envelope_hash IS NOT NULL", USER)).isEqualTo(2);
            assertThat(count("SELECT count(*) FROM deliveries WHERE user_id=?", USER)).isZero();
            assertThat(count("SELECT count(*) FROM device_tokens WHERE user_id=?", USER)).isZero();
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }

    private boolean waitsOnAdvisoryLock() throws InterruptedException {
        long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (System.nanoTime() < until) {
            if (store.one("SELECT pid FROM pg_stat_activity WHERE datname=current_database()"
                    + " AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%' LIMIT 1") != null) {
                return true;
            }
            Thread.sleep(10);
        }
        return false;
    }

    private long count(String sql, Object... args) {
        return ((Number) store.one(sql, args).get("count")).longValue();
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

    private static Map<String, Object> request(String id, UUID user) {
        return NotificationStoreTest.event(id, "notification.requested", user, 1, null, Map.of("kind", KIND));
    }

    private static Map<String, Object> withdrawal(String id) {
        return NotificationStoreTest.event(id, "user.withdrawn", USER, 9, null, Map.of("authGeneration", 1));
    }

    private static Map<String, Object> deletion(String id, String ownership) {
        return NotificationStoreTest.event(id, "notification.deviceToken.deleted", USER, 5, null,
                Map.of("deviceToken", "late-device", "ownershipToken", ownership));
    }
}
