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

import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

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
    static final UUID OTHER = UUID.fromString("66666666-6666-4666-8666-666666666666");
    static final Instant DAY = Instant.parse("2026-09-12T03:00:00Z");

    /** {@code DispatchService} 의 발송 펜싱 길이 — 그보다 뒤로 시계를 옮겨야 같은 행이 다시 후보가 된다. */
    static final int LEASE_SECONDS = 120;

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
        assertThat(store.one("SELECT status,last_error FROM deliveries WHERE id=?", first))
                .containsEntry("status", "PENDING").containsEntry("last_error", "NO_ACTIVE_DEVICE");

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
        dispatch.dispatch(first);
        dispatch.dispatch(second);
        verify(transport, times(2)).send(eq("fcm-new"), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", first))
                .containsEntry("status", "SENT");
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", second))
                .containsEntry("status", "SENT");
    }

    @Test
    void successfulDeviceStillCompletesWhenAnotherTokenIsUnregistered() {
        register("fcm-valid", "boot-valid", 1, "reg-valid");
        register("fcm-invalid", "boot-invalid", 1, "reg-invalid");
        when(transport.send(eq("fcm-invalid"), any(), anyBoolean(), anyString()))
                .thenReturn(PushTransport.Result.UNREGISTERED);
        UUID id = enqueue("mixed");
        dispatch.dispatch(id);
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", id))
                .containsEntry("status", "SENT");
        assertThat(store.rows("SELECT device_key FROM delivery_devices WHERE delivery_id=?", id)).hasSize(1);
        dispatch.dispatch(id);
        verify(transport).send(eq("fcm-valid"), any(), anyBoolean(), anyString());
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

    /**
     * FCM 호출은 <b>트랜잭션 밖</b>에서 돌아야 한다.
     *
     * <p>토큰 하나에 최대 6초(연결 2 + 읽기 4)인 호출을 트랜잭션 안에서 기기 수만큼 순차로 돌면, 활성
     * 기기가 열 대만 돼도 트랜잭션 상한을 넘긴다. 그 순간 <b>외부 발송은 이미 나갔는데</b>
     * {@code delivery_devices} 와 {@code SENT} 만 되감겨 다음 틱이 같은 푸시를 다시 보낸다.
     */
    @Test
    void theExternalSendRunsWithNoTransactionOpen() {
        register("fcm-solo", "boot-solo", 1, "reg-solo");
        AtomicBoolean inTransaction = new AtomicBoolean(true);
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenAnswer(call -> {
            inTransaction.set(TransactionSynchronizationManager.isActualTransactionActive());
            return PushTransport.Result.SENT;
        });

        UUID id = enqueue("outside");
        dispatch.dispatch(id);

        assertThat(inTransaction).isFalse();
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", id)).containsEntry("status", "SENT");
    }

    /**
     * 발송이 도는 동안 전역 {@code device-ownership} 잠금을 쥐고 있으면 <b>다른 사용자의</b> 기기
     * 등록·삭제까지 그 시간만큼 멈춘다. 판정이 끝난 뒤에는 그 잠금을 놓아야 한다.
     */
    @Test
    void anotherUsersRegistrationDoesNotWaitForAPushInFlight() {
        register("fcm-busy", "boot-busy", 1, "reg-busy");
        AtomicBoolean blocked = new AtomicBoolean(true);
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenAnswer(call -> {
            Thread other = new Thread(() -> devices.register(OTHER,
                    body("fcm-other", "boot-other", 1L, 0L, null), "reg-other"));
            other.start();
            other.join(3000);
            blocked.set(other.isAlive());
            return PushTransport.Result.SENT;
        });

        dispatch.dispatch(enqueue("concurrent"));

        assertThat(blocked).isFalse();
        assertThat(store.one("SELECT user_id FROM device_tokens WHERE device_token='fcm-other'"))
                .containsEntry("user_id", OTHER);
    }

    /**
     * 기기 둘 중 앞의 하나가 이미 받은 뒤에 뒤의 하나가 터져도, <b>받은 기기는 받은 기기로 남아야</b> 한다.
     *
     * <p>묶음 전체를 한 트랜잭션으로 맺으면 뒤쪽의 실패가 앞쪽의 전송 이력까지 되감는다 — 외부 발송은
     * 이미 나갔으므로, 그 되감김이 곧 다음 틱의 <b>중복 푸시</b>다.
     */
    @Test
    void aLateFailureDoesNotUndoTheDeviceThatAlreadyReceivedThePush() {
        register("fcm-first", "boot-first", 1, "reg-first");
        register("fcm-second", "boot-second", 1, "reg-second");
        when(transport.send(eq("fcm-second"), any(), anyBoolean(), anyString()))
                .thenThrow(new IllegalStateException("FCM 응답이 끝내 오지 않았다"));

        UUID id = enqueue("half");
        assertThatThrownBy(() -> dispatch.dispatch(id)).isInstanceOf(IllegalStateException.class);

        assertThat(store.rows("SELECT device_key FROM delivery_devices WHERE delivery_id=?", id))
                .singleElement()
                .satisfies(row -> assertThat(row).containsEntry("device_key", deviceKey("fcm-first")));
        // 발송 중 펜싱 — 임대가 끝나기 전에는 같은 행이 다시 후보로 서지 않는다.
        assertThat(dispatch.candidates()).doesNotContain(id);

        when(transport.send(eq("fcm-second"), any(), anyBoolean(), anyString()))
                .thenReturn(PushTransport.Result.SENT);
        when(clock.instant()).thenReturn(DAY.plusSeconds(LEASE_SECONDS + 1));
        dispatch.dispatch(id);

        // 이미 받은 기기에는 다시 보내지 않는다.
        verify(transport, times(1)).send(eq("fcm-first"), any(), anyBoolean(), anyString());
        verify(transport, times(2)).send(eq("fcm-second"), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", id)).containsEntry("status", "SENT");
    }

    /**
     * 판정이 토큰을 캡처한 <b>뒤</b> 그 기기의 소유권이 넘어가면, 캡처한 발송을 실행해서는 안 된다.
     *
     * <p>B 가 같은 {@code device_token} 을 새 bootstrap 으로 가져가면(계정 이전) 그 토큰이 가리키는 기기는
     * 이제 B 의 것이다. 캡처한 대로 보내면 <b>새 주인에게 A 의 알림 본문이 전송되고</b>, 그 성공이 옛
     * {@code device_key} 의 이력으로 적혀 원래 수신자는 「이미 갔다」로 접힌다.
     */
    @Test
    void aDeviceWhoseOwnerChangedAfterTheDecisionIsNeverSentTo() {
        register("fcm-a", "boot-a", 1, "reg-a");
        register("fcm-b", "boot-b", 1, "reg-b");
        UUID keptIdentity = deviceKey("fcm-a");
        when(transport.send(eq("fcm-a"), any(), anyBoolean(), anyString())).thenAnswer(call -> {
            // 첫 기기로 보내는 동안 다른 사용자가 두 번째 토큰을 가져간다.
            devices.register(OTHER, body("fcm-b", "boot-other", 1L, 0L, null), "steal-b");
            return PushTransport.Result.SENT;
        });

        UUID id = enqueue("stolen");
        dispatch.dispatch(id);

        // 새 주인에게는 아무것도 가지 않는다.
        verify(transport, never()).send(eq("fcm-b"), any(), anyBoolean(), anyString());
        assertThat(store.rows("SELECT device_key FROM delivery_devices WHERE delivery_id=?", id))
                .singleElement()
                .satisfies(row -> assertThat(row).containsEntry("device_key", keptIdentity));
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", id)).containsEntry("status", "SENT");
    }

    /**
     * 외부 호출이 도는 «사이»에 소유권이 바뀌면 이미 나간 푸시는 되돌릴 수 없다. 그래도 그것을 그
     * 기기의 <b>성공 이력</b>으로 적어서는 안 된다 — 적으면 원래 수신자는 영영 못 받는다.
     */
    @Test
    void ownershipThatChangesDuringTheCallIsNotRecordedAsThatDevicesSuccess() {
        register("fcm-single", "boot-single", 1, "reg-single");
        when(transport.send(eq("fcm-single"), any(), anyBoolean(), anyString())).thenAnswer(call -> {
            devices.register(OTHER, body("fcm-single", "boot-other", 1L, 0L, null), "steal");
            return PushTransport.Result.SENT;
        });

        UUID id = enqueue("during");
        dispatch.dispatch(id);

        assertThat(store.rows("SELECT device_key FROM delivery_devices WHERE delivery_id=?", id)).isEmpty();
        assertThat(store.one("SELECT status,last_error FROM deliveries WHERE id=?", id))
                .as("창에 걸린 발송은 전송 실패와 «원인이 다르다» — 같은 FCM_RETRY 로 접으면"
                        + " 사고 조사에서 「남의 기기로 나간 발송이 있었는가」를 물을 수 없다")
                .containsEntry("status", "PENDING").containsEntry("last_error", "OWNERSHIP_CHANGED");
        // 남의 행이 된 토큰의 전송 자격도 건드리지 않는다.
        assertThat(store.one("SELECT user_id,transport_invalid FROM device_tokens WHERE device_token='fcm-single'"))
                .containsEntry("user_id", OTHER).containsEntry("transport_invalid", false);
    }

    /**
     * 앱이 소유권 UUID 를 <b>대문자로 정규화해</b> 보내도 같은 값으로 인정돼야 한다.
     *
     * <p>형식 검사는 {@code A-F} 를 허용하는데 PostgreSQL 의 {@code uuid::text} 는 소문자로 출력한다.
     * 문자열로 대조하면 <b>같은 UUID 인데</b> CAS 가 어긋나, 정상 재등록이
     * {@code DEVICE_OWNERSHIP_CONFLICT} 로 거절되고 삭제는 0행을 지운 채 «성공»을 돌려준다 —
     * 그 기기는 활성인 채로 계속 알림을 받는다.
     */
    @Test
    void anOwnershipTokenSentInUppercaseIsStillTheSameValue() {
        String owner = register("fcm-case", "boot-case", 1, "reg-case");
        String upper = owner.toUpperCase(java.util.Locale.ROOT);
        assertThat(upper).isNotEqualTo(owner);

        // 재등록(CAS) — 대문자 표기로도 같은 소유권이어야 한다.
        UUID identity = deviceKey("fcm-case");
        Map<String, Object> rotated = devices.register(USER, body("fcm-case-2", null, 1L, 0L, upper), "rotate-case");
        assertThat(rotated).containsKey("ownershipToken");
        assertThat(deviceKey("fcm-case-2")).isEqualTo(identity);

        // 삭제 — 대문자 표기로도 실제로 그 행을 끊어야 한다.
        String current = rotated.get("ownershipToken").toString();
        devices.delete(USER, "fcm-case-2", current.toUpperCase(java.util.Locale.ROOT), 0L, "delete-case");
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='fcm-case-2'"))
                .as("성공 응답만 주고 행이 활성으로 남으면 그 기기는 계속 알림을 받는다")
                .containsEntry("active", false);
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
