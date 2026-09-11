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
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 기기 행의 <b>세 축</b>이 서로를 끌고 다니지 않는지 고정한다(GROMO-1659 R4).
 *
 * <ul>
 *   <li><b>전송 자격</b>({@code transport_invalid}) ≠ <b>소유권</b>({@code active}). FCM 이 토큰을
 *       {@code UNREGISTERED} 로 돌려줘도 그 세션의 소유권은 살아 있어야 한다 — 아니면 앱의
 *       {@code onTokenRefresh} 가 가져온 새 토큰이 자기 소유권의 CAS 에 걸려(활성 행만 본다), 1회용
 *       자격도 이미 소비되어 재로그인 전까지 푸시가 복구되지 않는다.</li>
 *   <li><b>기기 신원</b>({@code device_key}) ≠ <b>소유권</b>. 소유권은 등록마다 회전해야 낡은 CAS 를
 *       걸러 내지만(A22 ㊚), 전송 이력을 그 회전하는 값으로 적으면 부분 실패의 재시도 사이에 앱을
 *       재시작한 기기가 «미전송»으로 되돌아가 같은 알림을 두 번 받는다.</li>
 * </ul>
 *
 * <p>그리고 느슨해지지 않았음을 같이 못 박는다: 로그아웃 · 삭제 · 세션 폐기 · 소비된 자격은 여전히
 * 같은 토큰 교체를 거절한다.
 */
@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class DeviceTransportContinuityTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("44444444-4444-4444-8444-444444444444");
    static final Instant DAY = Instant.parse("2026-09-12T03:00:00Z");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }

    @Autowired Store store;
    @Autowired DeviceService devices;
    @Autowired InboundService inbound;
    @Autowired DispatchService dispatch;
    @MockitoBean PushTransport transport;
    @MockitoBean DataClient data;
    @MockitoBean Clock clock;

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE delivery_devices,deliveries,inbound_events,commands,device_tokens,"
                + "session_fences,legacy_session_fences,"
                + "user_fences,settings,projections,result_ack,templates,deeplinks,kinds CASCADE");
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true,active_migration_id=NULL");
        store.update("INSERT INTO kinds(id,quiet_policy) VALUES('BET_WON','BYPASS')");
        store.update("INSERT INTO templates(id,kind,locale,title,body)"
                + " VALUES('BET_WON.ko','BET_WON','ko','내기','결과가 나왔어요')");
        reset(transport, data, clock);
        when(clock.instant()).thenReturn(DAY);
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
        when(data.eligible(any(), anyString(), any(), any())).thenReturn(true);
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
    }

    /**
     * {@code UNREGISTERED} 는 «이 토큰으로는 더 못 보낸다»일 뿐이다. 소유권까지 폐기하면 정상 세션이
     * 새 토큰을 올릴 길이 없어진다 — CAS 는 활성 행만 보고, 1회용 자격은 첫 등록에서 이미 소비됐다.
     */
    @Test
    void unregisteredTokenKeepsOwnershipSoTheLiveSessionCanSwapInANewToken() {
        String owner = register("fcm-old", "bootstrap", 1, "register");
        when(transport.send(eq("fcm-old"), any(), anyBoolean(), anyString()))
                .thenReturn(PushTransport.Result.UNREGISTERED);
        UUID first = enqueue("one");
        dispatch.dispatch(first);

        // 끊긴 것은 전송 축뿐이다. 소유권은 그대로 살아 있고, 그 기기는 «받은 기기»로도 적히지 않는다.
        assertThat(store.one("SELECT active,transport_invalid FROM device_tokens WHERE device_token='fcm-old'"))
                .containsEntry("active", true).containsEntry("transport_invalid", true);
        assertThat(store.rows("SELECT device_key FROM delivery_devices WHERE delivery_id=?", first)).isEmpty();

        // 그래도 다음 발송의 대상에서는 빠진다 — 무효 토큰에 계속 때리지 않는다.
        UUID second = enqueue("two");
        dispatch.dispatch(second);
        assertThat(store.one("SELECT status,last_error FROM deliveries WHERE id=?", second))
                .containsEntry("status", "PENDING").containsEntry("last_error", "NO_ACTIVE_DEVICE");

        // onTokenRefresh. 앱은 저장해 둔 소유권으로 새 FCM 토큰을 올린다(자격은 이미 소비됐다).
        Map<String, Object> refreshed = devices.register(USER,
                body("fcm-new", "bootstrap", 1L, 0L, owner), "token-refresh");
        assertThat(refreshed).containsKey("ownershipToken");
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='fcm-old'"))
                .containsEntry("active", false);
        assertThat(store.one("SELECT active,transport_invalid FROM device_tokens WHERE device_token='fcm-new'"))
                .containsEntry("active", true).containsEntry("transport_invalid", false);

        // 같은 기기이므로 신원은 이어지고, 소유권은 A22 ㊚ 대로 회전한다.
        assertThat(deviceKey("fcm-new")).isEqualTo(deviceKey("fcm-old"));
        assertThat(refreshed.get("ownershipToken")).isNotEqualTo(owner);

        when(clock.instant()).thenReturn(DAY.plusSeconds(120));
        dispatch.dispatch(second);
        verify(transport).send(eq("fcm-new"), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", second))
                .containsEntry("status", "SENT");
    }

    /**
     * 전송 자격만 내리는 것이 <b>소유권 울타리를 열지 않는다</b>. 로그아웃 · 삭제 · 세션 폐기가 남긴
     * {@code active=false} 는 여전히 같은 소유권의 토큰 교체를 거절한다.
     */
    @Test
    void revokedOwnershipStillRefusesTheSameTokenSwapThatTransportInvalidityAllows() {
        String logout = register("fcm-logout", "boot-logout", 1, "reg-logout");
        Map<String, Object> revoked = new LinkedHashMap<>();
        revoked.put("bootstrapNonceHash", Json.digest("boot-logout"));
        revoked.put("sessionEpoch", 2L);
        revoked.put("sessionId", null);
        devices.revokeSession(USER, revoked);
        // 승계한 자격이 폐기된 세션이라 세션 축에서 먼저 걸린다 — 소유권까지 갈 것도 없다.
        assertThatThrownBy(() -> devices.register(USER, body("fcm-logout-2", null, 1L, 0L, logout), "after-logout"))
                .hasMessage("SESSION_REVOKED");

        String deleted = register("fcm-delete", "boot-delete", 1, "reg-delete");
        devices.delete(USER, "fcm-delete", deleted, 0L, "delete");
        assertThatThrownBy(() -> devices.register(USER, body("fcm-delete-2", null, 1L, 0L, deleted), "after-delete"))
                .hasMessage("DEVICE_OWNERSHIP_CONFLICT");

        // 소비된 자격 하나로 새 기기를 여는 길도 그대로 막혀 있다.
        assertThatThrownBy(() -> devices.register(USER, body("fcm-third", "boot-delete", 1L, 0L, null), "reuse"))
                .hasMessage("DEVICE_OWNERSHIP_CONFLICT");

        // 탈퇴는 전송 축과 무관하게 전부 접는다.
        devices.generation(USER, 1L, true);
        assertThat(store.rows("SELECT device_token FROM device_tokens WHERE active")).isEmpty();
    }

    /**
     * 기기 A 는 받고 B 는 실패해 재시도가 걸린 사이에 A 가 앱을 재시작한다. 재등록은 새 소유권을
     * 발급하므로, 전송 이력을 소유권으로 세면 A 가 «아직 못 받은 기기»로 되돌아가 같은 알림을 두 번
     * 받는다.
     */
    @Test
    void partialFailureRetryDoesNotResendToADeviceThatReregisteredInBetween() {
        String ownerA = register("fcm-a", "boot-a", 1, "reg-a");
        register("fcm-b", "boot-b", 1, "reg-b");
        when(transport.send(eq("fcm-b"), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.RETRY);
        UUID id = enqueue("partial");
        dispatch.dispatch(id);

        assertThat(store.one("SELECT status,last_error FROM deliveries WHERE id=?", id))
                .containsEntry("status", "PENDING").containsEntry("last_error", "FCM_RETRY");
        List<Map<String, Object>> reached = store.rows("SELECT device_key FROM delivery_devices"
                + " WHERE delivery_id=?", id);
        assertThat(reached).hasSize(1);
        assertThat(reached.get(0)).containsEntry("device_key", deviceKey("fcm-a"));

        // 앱 재시작 — PushGate 가 같은 토큰을 다시 등록한다. 소유권은 회전하고 신원은 남는다.
        UUID identity = deviceKey("fcm-a");
        Map<String, Object> restarted = devices.register(USER, body("fcm-a", null, 1L, 0L, ownerA), "restart-a");
        assertThat(restarted.get("ownershipToken")).isNotEqualTo(ownerA);
        assertThat(deviceKey("fcm-a")).isEqualTo(identity);

        when(transport.send(eq("fcm-b"), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
        when(clock.instant()).thenReturn(DAY.plusSeconds(120));
        dispatch.dispatch(id);

        verify(transport, times(1)).send(eq("fcm-a"), any(), anyBoolean(), anyString());
        verify(transport, times(2)).send(eq("fcm-b"), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", id)).containsEntry("status", "SENT");
        assertThat(store.rows("SELECT device_key FROM delivery_devices WHERE delivery_id=?", id)).hasSize(2);
    }

    /**
     * 같은 기기의 <b>FCM 토큰 회전</b>도 마찬가지다 — 소유권으로 승인된 교체이므로 전송 이력이
     * 따라와야 한다. 아니면 재시도가 「새 토큰 = 새 기기」로 보고 같은 알림을 다시 보낸다.
     */
    @Test
    void authorizedTokenRotationCarriesTheDeliveryHistoryOfTheSameDevice() {
        String ownerA = register("fcm-a", "boot-a", 1, "reg-a");
        register("fcm-b", "boot-b", 1, "reg-b");
        when(transport.send(eq("fcm-b"), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.RETRY);
        UUID id = enqueue("rotating");
        dispatch.dispatch(id);

        UUID identity = deviceKey("fcm-a");
        devices.register(USER, body("fcm-a2", null, 1L, 0L, ownerA), "rotate-a");
        assertThat(deviceKey("fcm-a2")).isEqualTo(identity);

        when(transport.send(eq("fcm-b"), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
        when(clock.instant()).thenReturn(DAY.plusSeconds(120));
        dispatch.dispatch(id);

        verify(transport, never()).send(eq("fcm-a2"), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", id)).containsEntry("status", "SENT");
    }

    /**
     * 구 앱에는 소유권이 없다 — 같은 일을 서명된 sid 가 한다. 그 세션의 토큰 회전도 같은 기기이므로
     * 이력이 이어지고, <b>다른 계정</b>이 같은 토큰을 가져갈 때는 이어지지 않는다(남의 이력을 물려받으면
     * 새 주인이 못 받은 알림이 받은 것이 된다).
     */
    @Test
    void legacySessionRotationKeepsIdentityButAccountTransferDoesNot() {
        UUID session = UUID.randomUUID();
        devices.register(USER, legacyBody("fcm-legacy", session, 1L), "legacy-new");
        UUID identity = deviceKey("fcm-legacy");
        devices.register(USER, legacyBody("fcm-legacy-2", session, 1L), "legacy-rotate");
        assertThat(deviceKey("fcm-legacy-2")).isEqualTo(identity);

        UUID other = UUID.fromString("55555555-5555-4555-8555-555555555555");
        devices.register(other, legacyBody("fcm-legacy-2", UUID.randomUUID(), 1L), "transfer");
        assertThat(deviceKey("fcm-legacy-2")).isNotEqualTo(identity);
    }

    private UUID deviceKey(String token) {
        return (UUID) store.one("SELECT device_key FROM device_tokens WHERE device_token=?", token).get("device_key");
    }

    private UUID enqueue(String eventId) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventId", eventId);
        event.put("schemaVersion", 1);
        event.put("type", "notification.requested");
        event.put("userId", USER.toString());
        event.put("version", 1);
        event.put("subjectId", UUID.randomUUID().toString());
        event.put("locale", "ko");
        event.put("occurredAt", DAY.toString());
        event.put("scheduledAt", DAY.toString());
        event.put("params", Map.of("kind", "BET_WON"));
        inbound.accept(event);
        return (UUID) store.one("SELECT id FROM deliveries WHERE event_id=?", eventId).get("id");
    }

    private String register(String token, String bootstrap, long epoch, String key) {
        return devices.register(USER, body(token, bootstrap, epoch, 0L, null), key)
                .get("ownershipToken").toString();
    }

    private Map<String, Object> body(String token, String bootstrap, long epoch, long generation, String ownership) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("deviceToken", token);
        body.put("deviceBootstrap", bootstrap);
        body.put("sessionEpoch", epoch);
        body.put("authGeneration", generation);
        body.put("ownershipToken", ownership);
        return body;
    }

    private Map<String, Object> legacyBody(String token, UUID session, long epoch) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("deviceToken", token);
        body.put("legacySessionId", session.toString());
        body.put("sessionEpoch", epoch);
        body.put("authGeneration", 0L);
        return body;
    }
}
