package com.oneorthree.notification;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.times;

@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class NotificationStoreTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("11111111-1111-4111-8111-111111111111");
    static final Instant DAY = Instant.parse("2026-09-11T03:00:00Z");
    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }
    @Autowired Store store;
    @Autowired DeviceService devices;
    @Autowired InboundService inbound;
    @Autowired SettingsService settings;
    @Autowired AckService ack;
    @Autowired DispatchService dispatch;
    @Autowired JobRegistry jobs;
    @Autowired SnapshotReconciler snapshots;
    @MockitoBean PushTransport transport;
    @MockitoBean DataClient data;
    @MockitoBean Clock clock;

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE delivery_devices,deliveries,inbound_events,commands,device_tokens,session_fences,"
                + "user_fences,settings,projections,result_ack,templates,deeplinks,kinds CASCADE");
        store.update("UPDATE dispatch_control SET enabled=false,ever_opened=false,active_migration_id=NULL");
        store.update("DELETE FROM job_runs");
        store.update("UPDATE jobs SET enabled=false");
        store.update("INSERT INTO kinds(id,quiet_policy,eligibility_required) VALUES('BET_RESULT','DEFER',true)");
        store.update("INSERT INTO templates(id,kind,locale,title,body)"
                + " VALUES('BET_RESULT.ko','BET_RESULT','ko','결과','내기 {count}건')");
        reset(transport, data, clock);
        when(clock.instant()).thenReturn(DAY);
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        when(data.eligible(any(), anyString(), any(), any())).thenReturn(true);
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
    }

    @Test
    void legacySessionRevocationWithoutNonceIsAcceptedWithoutTouchingANewSession() {
        register(USER, "device", "new-bootstrap", "register");
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("bootstrapNonceHash", null);
        params.put("sessionEpoch", 1);
        inbound.accept(event("legacy-revoked", "auth.session.revoked", USER, 1, null, params));
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='device'"))
                .containsEntry("active", true);
        assertThat(store.one("SELECT event_id FROM inbound_events WHERE event_id='legacy-revoked'")).isNotNull();
    }

    @Test
    void registryDoesNotCompleteClosedGateReplayAndActuallyRunsAfterOpening() {
        register(USER, "device", "bootstrap", "register");
        inbound.accept(event("scheduled", "notification.requested", USER, 1, UUID.randomUUID().toString(),
                Map.of("kind", "BET_RESULT", "count", 1)));
        store.update("UPDATE jobs SET enabled=true WHERE id='bundle-flush'");
        store.update("INSERT INTO job_runs(job_id,scheduled_at) VALUES('bundle-flush',?)",
                java.sql.Timestamp.from(DAY.minusSeconds(60)));
        jobs.tick();
        assertThat(store.one("SELECT completed_at FROM job_runs WHERE job_id='bundle-flush'"))
                .containsEntry("completed_at", null);
        verifyNoInteractions(transport);
        store.update("UPDATE dispatch_control SET enabled=true");
        jobs.tick();
        assertThat(status(delivery("scheduled"))).isEqualTo("SENT");
        assertThat(store.one("SELECT completed_at FROM job_runs WHERE job_id='bundle-flush'").get("completed_at"))
                .isNotNull();
    }

    /**
     * 콘솔에서 한 kind 의 템플릿을 끄는 것은 정상 관리 동작이다. 그 kind 의 발송이 «후보 맨 앞»에
     * 놓였다고 해서 뒤의 다른 종류·다른 사용자의 정상 알림까지 멈춰서는 안 된다.
     * 실패한 한 건은 재시도 시각을 밀어 내구화하고 — 밀지 않으면 같은 정렬로 다음 tick 에도
     * 맨 앞에 다시 서서 큐가 «무기한» 막힌다 — 나머지 후보는 그 회차 안에서 계속 나간다.
     */
    @Test
    void oneUnrenderableCandidateIsBackedOffAndTheRestOfTheQueueStillGoesOut() {
        register(USER, "device", "bootstrap", "register");
        store.update("INSERT INTO kinds(id,quiet_policy) VALUES('CHALLENGE_CREATED','BYPASS')");
        store.update("INSERT INTO templates(id,kind,locale,title,body,enabled)"
                + " VALUES('CHALLENGE_CREATED.ko','CHALLENGE_CREATED','ko','모집','열렸습니다',false)");
        inbound.accept(event("blocked", "notification.requested", USER, 1, null,
                Map.of("kind", "CHALLENGE_CREATED")));
        inbound.accept(event("healthy", "notification.requested", USER, 2, UUID.randomUUID().toString(),
                Map.of("kind", "BET_RESULT", "count", 1)));
        // 막힌 건이 후보 정렬(next_attempt_at,id)의 맨 앞에 서게 만든다.
        store.update("UPDATE deliveries SET next_attempt_at=? WHERE event_id='blocked'",
                java.sql.Timestamp.from(DAY.minusSeconds(600)));
        assertThat(dispatch.candidates().get(0)).isEqualTo(delivery("blocked"));
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true");
        store.update("UPDATE jobs SET enabled=true WHERE id='bundle-flush'");
        store.update("INSERT INTO job_runs(job_id,scheduled_at) VALUES('bundle-flush',?)",
                java.sql.Timestamp.from(DAY.minusSeconds(60)));
        jobs.tick();
        // 뒤에 있던 정상 알림은 같은 회차에 나갔다.
        verify(transport, times(1)).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(status(delivery("healthy"))).isEqualTo("SENT");
        // 실패한 건은 사유·시도횟수·재시도 시각이 «커밋»돼 있다(dispatch 트랜잭션은 되감겼다).
        Map<String, Object> blocked = store.one("SELECT status,attempts,last_error,next_attempt_at"
                + " FROM deliveries WHERE event_id='blocked'");
        assertThat(blocked).containsEntry("status", "PENDING").containsEntry("attempts", 1)
                .containsEntry("last_error", "TEMPLATE_UNAVAILABLE");
        assertThat(((java.sql.Timestamp) blocked.get("next_attempt_at")).toInstant())
                .isEqualTo(DAY.plusSeconds(60));
        // 다음 후보 목록에서 빠진다 — 같은 행이 큐 맨 앞을 다시 점거하지 않는다.
        assertThat(dispatch.candidates()).doesNotContain(delivery("blocked"));
        // 회차는 완료되고 사유만 남는다. 잡 전체가 실패로 접히면 뒤의 회차도 계속 밀린다.
        Map<String, Object> run = store.one("SELECT completed_at,error FROM job_runs"
                + " WHERE job_id='bundle-flush' AND scheduled_at=?",
                java.sql.Timestamp.from(DAY.minusSeconds(60)));
        assertThat(run.get("completed_at")).isNotNull();
        assertThat(run).containsEntry("error", "TEMPLATE_UNAVAILABLE");
    }

    /**
     * 첫 prepare 뒤 Data ack 가 실패해 보류가 RELEASED 로 풀린 상태에서, 앱이 «같은
     * Idempotency-Key» 로 재시도한다. 과거 응답만 재생하면 실제 보류 없이 Data ack 가 커밋되고
     * 그 사이에 낀 flush 가 「이미 확인한 결과」를 푸시한다(A22 ⓓ).
     */
    @Test
    void aPrepareReplayAfterTheHoldWasReleasedHoldsAgainInsteadOfReplayingTheOldAnswer() {
        register(USER, "device", "bootstrap", "register");
        UUID session = UUID.randomUUID();
        assertThat(ack.command(USER, session, "prepare", "same-key")).containsEntry("state", "HELD");
        inbound.accept(event("held", "notification.requested", USER, 1, session.toString(),
                Map.of("kind", "BET_RESULT", "count", 1)));
        UUID id = delivery("held");
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true");
        // 30초 만료 → 리컨실이 Data 의 «미확인» 을 읽어 보류를 푼다.
        when(clock.instant()).thenReturn(DAY.plusSeconds(31));
        doReturn(false).when(data).acknowledged(USER, session);
        ack.reconcile();
        assertThat(ackState(session)).isEqualTo("RELEASED");
        assertThat(ack.command(USER, session, "prepare", "same-key")).containsEntry("state", "HELD");
        assertThat(ackState(session)).isEqualTo("HELD");
        assertThat(((java.sql.Timestamp) store.one("SELECT held_until FROM result_ack"
                + " WHERE user_id=? AND session_id=?", USER, session).get("held_until")).toInstant())
                .isEqualTo(DAY.plusSeconds(61));
        // 재확보한 보류가 실제로 발송을 막는다.
        dispatch.dispatch(id);
        verifyNoInteractions(transport);
        assertThat(status(id)).isEqualTo("PENDING");
    }

    @Test
    void reconcileKeepsSatellitePreferencesAndAppliesWithdrawalWithoutResurrection() {
        register(USER, "device", "bootstrap", "register");
        settings.apply(USER, preferences(false), 50, "disabled");
        Map<String, Object> source = new LinkedHashMap<>(preferences(true));
        source.put("userId", USER.toString());
        source.put("withdrawn", false);
        source.put("authGeneration", 0);
        source.put("version", 1);
        source.put("locale", "ja");
        Map<String, Object> page = new LinkedHashMap<>();
        page.put("items", java.util.List.of(source));
        page.put("nextCursor", null);
        when(data.snapshot(null, 500)).thenReturn(page);
        snapshots.reconcile();
        assertThat(settings.read(USER)).containsEntry("notificationEnabled", false);
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='device'"))
                .containsEntry("active", true);
        source.put("withdrawn", true);
        source.put("authGeneration", 1);
        source.put("version", 2);
        snapshots.reconcile();
        source.put("withdrawn", false);
        source.put("authGeneration", 0);
        source.put("version", 1);
        snapshots.reconcile();
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='device'"))
                .containsEntry("active", false);
        assertThat(store.rows("SELECT * FROM projections WHERE user_id=?", USER)).isEmpty();
    }

    @Test
    void closedGateBuffersAndOpenDispatchesOnce() {
        register(USER, "device", "bootstrap", "register");
        Map<String, Object> event = event("one", "notification.requested", USER, 1, UUID.randomUUID().toString(),
                Map.of("kind", "BET_RESULT", "count", 1));
        inbound.accept(event);
        inbound.accept(event);
        UUID id = delivery("one");
        dispatch.dispatch(id);
        verifyNoInteractions(transport);
        assertThat(status(id)).isEqualTo("PENDING");
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true");
        dispatch.dispatch(id);
        dispatch.dispatch(id);
        verify(transport, times(1)).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(status(id)).isEqualTo("SENT");
    }

    @Test
    void independentSubjectsIgnoreUnrelatedHighVersion() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        inbound.accept(event("new", "participation.updated", USER, 100, first.toString(), Map.of("active", true)));
        inbound.accept(event("old-other", "participation.updated", USER, 1, second.toString(), Map.of("active", true)));
        inbound.accept(event("old-same", "participation.updated", USER, 2, first.toString(), Map.of("active", false)));
        assertThat(store.rows("SELECT * FROM projections")).hasSize(2);
        assertThat(Json.map(store.one("SELECT payload::text FROM projections WHERE subject_id=?", first.toString())
                .get("payload"))).containsEntry("active", true);
    }

    @Test
    void sessionRevocationBeforeRegistrationCannotResurrectToken() {
        inbound.accept(event("revoke", "auth.session.revoked", USER, 1, null,
                Map.of("bootstrapNonceHash", Json.digest("bootstrap"), "sessionEpoch", 2)));
        assertThatThrownBy(() -> register(USER, "device", "bootstrap", "register"))
                .isInstanceOf(NotificationFailure.class).hasMessage("SESSION_REVOKED");
        assertThat(store.rows("SELECT * FROM device_tokens")).isEmpty();
    }

    @Test
    void ownershipTransferAndDelayedDeletePreserveNewOwner() {
        String ownerA = register(USER, "device", "session-A", "reg-A");
        UUID other = UUID.randomUUID();
        String ownerB = register(other, "device", "session-B", "reg-B");
        devices.delete(USER, "device", ownerA, 0L, "delete-A");
        assertThat(store.one("SELECT user_id,ownership_token,active FROM device_tokens WHERE device_token='device'"))
                .containsEntry("user_id", other).containsEntry("ownership_token", UUID.fromString(ownerB))
                .containsEntry("active", true);
        assertThatThrownBy(() -> devices.register(USER, Map.of("deviceToken", "device", "ownershipToken", ownerA,
                "authGeneration", 0), "old-CAS")).hasMessage("DEVICE_OWNERSHIP_CONFLICT");
    }

    @Test
    void responseLossReplaysSameOwnerButChangedRequestConflicts() {
        String first = register(USER, "device", "nonce", "same");
        assertThat(register(USER, "device", "nonce", "same")).isEqualTo(first);
        assertThatThrownBy(() -> register(USER, "other-device", "nonce", "same"))
                .hasMessage("IDEMPOTENCY_KEY_CONFLICT");
    }

    @Test
    void prepareBeforeDeliveryAndExpiredHoldStayClosedUntilCoreAckIsKnown() {
        register(USER, "device", "bootstrap", "register");
        UUID session = UUID.randomUUID();
        ack.command(USER, session, "prepare", "prepare");
        inbound.accept(event("held", "notification.requested", USER, 1, session.toString(),
                Map.of("kind", "BET_RESULT", "count", 1)));
        UUID id = delivery("held");
        store.update("UPDATE dispatch_control SET enabled=true");
        when(clock.instant()).thenReturn(DAY.plusSeconds(31));
        when(data.acknowledged(USER, session)).thenThrow(new IllegalStateException("Data unavailable"));
        assertThatThrownBy(ack::reconcile).isInstanceOf(IllegalStateException.class);
        dispatch.dispatch(id);
        verifyNoInteractions(transport);
        doReturn(true).when(data).acknowledged(USER, session);
        ack.reconcile();
        assertThat(status(id)).isEqualTo("SUPPRESSED");
        ack.command(USER, session, "abort", "late-abort");
        assertThat(store.one("SELECT state FROM result_ack WHERE user_id=? AND session_id=?", USER, session)
                .get("state")).isEqualTo("CONFIRMED");
    }

    @Test
    void outOfOrderSettingsKeepLatestIncludingNullQuietTimes() {
        Map<String, Object> latest = preferences(false);
        settings.apply(USER, latest, 2, "off");
        settings.apply(USER, preferences(true), 1, "old-on");
        assertThat(settings.read(USER)).containsEntry("notificationEnabled", false)
                .containsEntry("nightStartTime", null).containsEntry("nightEndTime", null);
    }

    @Test
    void unknownSchemaIsNotMarkedReceived() {
        Map<String, Object> event = event("future", "user.updated", USER, 1, null, Map.of());
        event.put("schemaVersion", 99);
        assertThatThrownBy(() -> inbound.accept(event)).hasMessage("UNSUPPORTED_SCHEMA_VERSION");
        assertThat(store.rows("SELECT * FROM inbound_events")).isEmpty();
    }

    @Test
    void mixedResultBundleSendsOnceAndPreservesEveryUnderlyingEvent() {
        register(USER, "device", "bootstrap", "register");
        store.update("INSERT INTO kinds(id,quiet_policy) VALUES('BET_VOID_REFUND','DEFER'),('BET_MIXED_BUNDLE','DEFER')");
        store.update("INSERT INTO templates(id,kind,locale,title,body)"
                + " VALUES('BET_MIXED_BUNDLE.ko','BET_MIXED_BUNDLE','ko','내기 소식',"
                + "'결과 {resultCount}건 · 환불 {refundCount}건')");
        UUID group = UUID.randomUUID();
        String slot = DAY.minusSeconds(900).toString();
        inbound.accept(event("result", "notification.requested", USER, 1, UUID.randomUUID().toString(),
                Map.of("kind", "BET_RESULT", "groupId", group.toString(), "slotAt", slot, "count", 1)));
        inbound.accept(event("refund", "notification.requested", USER, 2, UUID.randomUUID().toString(),
                Map.of("kind", "BET_VOID_REFUND", "groupId", group.toString(), "slotAt", slot)));
        store.update("UPDATE dispatch_control SET enabled=true");
        dispatch.dispatch(delivery("result"));
        dispatch.dispatch(delivery("refund"));
        var rendered = org.mockito.ArgumentCaptor.forClass(RenderedPush.class);
        verify(transport).send(anyString(), rendered.capture(), anyBoolean(), anyString());
        assertThat(rendered.getValue().body()).isEqualTo("결과 1건 · 환불 1건");
        assertThat(rendered.getValue().data()).doesNotContainKey("challengeId");
        assertThat(status(delivery("result"))).isEqualTo("SENT");
        assertThat(status(delivery("refund"))).isEqualTo("SENT");
        assertThat(store.rows("SELECT * FROM delivery_devices")).hasSize(2);
    }

    @Test
    void openResultSlotWaitsAndQuietDeferralKeepsOriginalSlot() {
        register(USER, "device", "bootstrap", "register");
        String slot = DAY.toString();
        inbound.accept(event("slot", "notification.requested", USER, 1, UUID.randomUUID().toString(),
                Map.of("kind", "BET_RESULT", "count", 1, "groupId", UUID.randomUUID().toString(), "slotAt", slot)));
        UUID id = delivery("slot");
        store.update("UPDATE dispatch_control SET enabled=true");
        dispatch.dispatch(id);
        verifyNoInteractions(transport);
        when(clock.instant()).thenReturn(Instant.parse("2026-09-11T15:00:00Z")); // 다음날 00:00 KST
        dispatch.dispatch(id);
        assertThat(status(id)).isEqualTo("DEFERRED");
        var row = store.one("SELECT slot_at,next_attempt_at FROM deliveries WHERE id=?", id);
        assertThat(((java.sql.Timestamp) row.get("slot_at")).toInstant()).isEqualTo(DAY);
        assertThat(((java.sql.Timestamp) row.get("next_attempt_at")).toInstant())
                .isEqualTo(Instant.parse("2026-09-11T22:00:00Z"));
        when(clock.instant()).thenReturn(Instant.parse("2026-09-11T22:00:00Z"));
        dispatch.dispatch(id);
        assertThat(status(id)).isEqualTo("SENT");
    }

    @Test
    void deleteBeforeFirstLegacyRegistrationLeavesTombstoneButFreshLoginCanTransfer() {
        devices.delete(USER, "device", null, 0L, "delete");
        assertThatThrownBy(() -> devices.register(USER, Map.of("deviceToken", "device"), "legacy-retry"))
                .hasMessage("DEVICE_OWNERSHIP_CONFLICT");
        register(USER, "device", "new-login", "fresh");
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='device'").get("active"))
                .isEqualTo(true);
    }

    @Test
    void casWithoutBootstrapPreservesBindingForLaterLogout() {
        String old = register(USER, "device", "bootstrap", "register");
        devices.register(USER, Map.of("deviceToken", "rotated", "ownershipToken", old, "authGeneration", 0), "rotate");
        inbound.accept(event("logout", "auth.session.revoked", USER, 2, null,
                Map.of("bootstrapNonceHash", Json.digest("bootstrap"), "sessionEpoch", 2)));
        assertThat(store.rows("SELECT * FROM device_tokens WHERE active")).isEmpty();
    }

    private String register(UUID user, String token, String bootstrap, String key) {
        return devices.register(user, Map.of("deviceToken", token, "deviceBootstrap", bootstrap,
                "sessionEpoch", 1, "authGeneration", 0), key).get("ownershipToken").toString();
    }
    private UUID delivery(String eventId) {
        return (UUID) store.one("SELECT id FROM deliveries WHERE event_id=?", eventId).get("id");
    }
    private String status(UUID id) {
        return store.one("SELECT status FROM deliveries WHERE id=?", id).get("status").toString();
    }
    private String ackState(UUID session) {
        return store.one("SELECT state FROM result_ack WHERE user_id=? AND session_id=?", USER, session)
                .get("state").toString();
    }
    static Map<String, Object> preferences(boolean enabled) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("notificationEnabled", enabled);
        values.put("soundEnabled", true);
        values.put("nightModeEnabled", false);
        values.put("nightStartTime", null);
        values.put("nightEndTime", null);
        return values;
    }
    static Map<String, Object> event(String id, String type, UUID user, long version, String subject,
            Map<String, Object> params) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("eventId", id);
        value.put("schemaVersion", 1);
        value.put("type", type);
        value.put("userId", user.toString());
        value.put("version", version);
        value.put("subjectId", subject);
        value.put("locale", "ko");
        value.put("occurredAt", DAY.toString());
        value.put("scheduledAt", DAY.toString());
        value.put("params", params);
        return value;
    }
}
