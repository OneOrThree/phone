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
    @Autowired JobRegistry jobs;
    @MockitoBean PushTransport transport;
    @MockitoBean DataClient data;
    @MockitoBean Clock clock;

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE delivery_devices,deliveries,inbound_events,commands,device_tokens,"
                + "session_fences,legacy_session_fences,"
                + "user_fences,settings,projections,templates,deeplinks,kinds CASCADE");
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true");
        store.update("UPDATE jobs SET enabled=false");
        store.update("DELETE FROM job_runs");
        store.update("INSERT INTO kinds(id,quiet_policy) VALUES('FRIEND_ACCEPTED','BYPASS')");
        store.update("INSERT INTO templates(id,kind,locale,title,body)"
                + " VALUES('FRIEND_ACCEPTED.ko','FRIEND_ACCEPTED','ko','내기','결과가 나왔어요')");
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
     * 다른 FCM 프로젝트에서 발급된 토큰({@code 403 SENDER_ID_MISMATCH}, GROMO-2521)은 {@code UNREGISTERED} 와 같은
     * 길을 탄다 — 응답을 실제 분류기({@code FcmTransport.classify})에 통과시킨 결과를 전송 결과로 돌린다.
     * 재시도로 남으면 그 토큰의 delivery 가 매분 영구 재시도되고, 소유권까지 폐기하면 올바른 새 토큰이 CAS 에 걸린다.
     */
    @Test
    void senderIdMismatchInvalidatesOnlyTheTransportAndIsNotRetriedForever() {
        register("fcm-mismatch", "bootstrap", 1, "register");
        PushTransport.Result mismatch = FcmTransport.classify(403,
                RenderPolicyTest.fcmError(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH"));
        when(transport.send(eq("fcm-mismatch"), any(), anyBoolean(), anyString())).thenReturn(mismatch);
        UUID id = enqueue("mismatch");
        dispatch.dispatch(id);

        assertThat(store.one("SELECT active,transport_invalid FROM device_tokens WHERE device_token='fcm-mismatch'"))
                .containsEntry("active", true).containsEntry("transport_invalid", true);

        // 재시도 간격이 지나도 같은 토큰으로 다시 보내지 않는다.
        when(clock.instant()).thenReturn(DAY.plusSeconds(120));
        dispatch.dispatch(id);
        verify(transport, times(1)).send(eq("fcm-mismatch"), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status,last_error FROM deliveries WHERE id=?", id))
                .containsEntry("status", "PENDING").containsEntry("last_error", "NO_ACTIVE_DEVICE");
    }

    /**
     * 같은 403 이라도 {@code THIRD_PARTY_AUTH_ERROR}(APNs 키·인증서 — 서버 설정 문제)는 토큰 탓이 아니다.
     * 토큰을 죽이지 않고 재시도로 남겨, 설정이 고쳐지면 같은 토큰으로 이어서 보낸다.
     */
    @Test
    void thirdPartyAuthErrorStaysRetryableAndLeavesTheTokenUsable() {
        register("fcm-apns", "bootstrap", 1, "register");
        PushTransport.Result authError = FcmTransport.classify(403,
                RenderPolicyTest.fcmError(403, "PERMISSION_DENIED", "THIRD_PARTY_AUTH_ERROR"));
        when(transport.send(eq("fcm-apns"), any(), anyBoolean(), anyString())).thenReturn(authError);
        UUID id = enqueue("apns-auth");
        dispatch.dispatch(id);

        assertThat(store.one("SELECT active,transport_invalid FROM device_tokens WHERE device_token='fcm-apns'"))
                .containsEntry("active", true).containsEntry("transport_invalid", false);
        assertThat(store.one("SELECT status,last_error FROM deliveries WHERE id=?", id))
                .containsEntry("status", "PENDING").containsEntry("last_error", "FCM_RETRY");

        // 설정이 고쳐지면 같은 토큰으로 이어서 보낸다.
        when(transport.send(eq("fcm-apns"), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
        when(clock.instant()).thenReturn(DAY.plusSeconds(120));
        dispatch.dispatch(id);
        verify(transport, times(2)).send(eq("fcm-apns"), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", id)).containsEntry("status", "SENT");
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
        assertThatThrownBy(() -> dispatch.dispatch(id))
                .isInstanceOf(DispatchService.LeasedFailure.class)
                .hasCauseInstanceOf(IllegalStateException.class);

        assertThat(store.rows("SELECT device_key FROM delivery_devices WHERE delivery_id=?", id))
                .singleElement()
                .satisfies(row -> assertThat(row).containsEntry("device_key", deviceKey("fcm-first")));
        // 예외가 난 실행의 임대는 풀고 60초 뒤로 미룬다. 그 전에는 다시 후보로 서지 않는다.
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
     * 실패 기록의 UPDATE 까지 실패하면 원래 전송 예외가 보존돼야 한다. attempts 정수 오버플로로
     * 기록 쿼리만 결정적으로 실패시키므로 DB 락이나 실행 시각에 기대지 않는다.
     */
    @Test
    void 실패기록도실패하면원래전송예외에기록오류를첨부한다() {
        register("fcm-broken", "boot-broken", 1, "reg-broken");
        UUID id = enqueue("record-failure");
        store.update("UPDATE deliveries SET attempts=? WHERE id=?", Integer.MAX_VALUE, id);
        IllegalStateException sendFailure = new IllegalStateException("FCM 전송 실패");
        when(transport.send(eq("fcm-broken"), any(), anyBoolean(), anyString())).thenThrow(sendFailure);

        assertThatThrownBy(() -> dispatch.dispatch(id)).isSameAs(sendFailure).satisfies(failure -> {
            assertThat(failure.getSuppressed()).hasSize(1);
            assertThat(failure.getSuppressed()[0]).isInstanceOf(org.springframework.dao.DataAccessException.class);
        });
        assertThat(store.one("SELECT status,attempts,last_error FROM deliveries WHERE id=?", id))
                .containsEntry("status", "PENDING").containsEntry("attempts", Integer.MAX_VALUE)
                .containsEntry("last_error", null);
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

    @Test
    void manySlowDevicesKeepTheirLeaseUntilTheLastSend() {
        for (int i = 0; i < 25; i++) {
            register("slow-" + i, "boot-slow-" + i, 1, "reg-slow-" + i);
        }
        UUID id = enqueue("slow-fanout");
        java.util.concurrent.atomic.AtomicInteger sent = new java.util.concurrent.atomic.AtomicInteger();
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenAnswer(call -> {
            Instant now = DAY.plusSeconds(sent.incrementAndGet() * 6L);
            when(clock.instant()).thenReturn(now);
            assertThat(dispatch.candidates()).doesNotContain(id);
            assertThat(((java.sql.Timestamp) store.one(
                    "SELECT lease_expires_at FROM deliveries WHERE id=?", id).get("lease_expires_at"))
                    .toInstant()).isAfter(now);
            return PushTransport.Result.SENT;
        });
        dispatch.dispatch(id);
        assertThat(sent.get()).isEqualTo(25);
        assertThat(store.one("SELECT status,lease_token FROM deliveries WHERE id=?", id))
                .containsEntry("status", "SENT").containsEntry("lease_token", null);
    }

    @Test
    void anOldWorkerCannotRecordOrReleaseANewerLease() {
        register("stale-a", "stale-boot-a", 1, "stale-reg-a");
        register("stale-b", "stale-boot-b", 1, "stale-reg-b");
        UUID id = enqueue("stale-worker");
        UUID newerLease = UUID.randomUUID();
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenAnswer(call -> {
            store.update("UPDATE deliveries SET lease_token=?,lease_expires_at=?,next_attempt_at=? WHERE id=?",
                    newerLease, java.sql.Timestamp.from(DAY.plusSeconds(600)),
                    java.sql.Timestamp.from(DAY.plusSeconds(600)), id);
            return PushTransport.Result.SENT;
        });
        dispatch.dispatch(id);
        verify(transport, times(1)).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(store.rows("SELECT * FROM delivery_devices WHERE delivery_id=?", id)).isEmpty();
        assertThat(store.one("SELECT status,lease_token FROM deliveries WHERE id=?", id))
                .containsEntry("status", "PENDING").containsEntry("lease_token", newerLease);
    }

    @Test
    void theSameTokenCanBeReregisteredWithUppercaseOwnership() {
        String owner = register("same-token", "same-boot", 1, "same-initial");
        UUID identity = deviceKey("same-token");
        devices.register(USER, body("same-token", null, 1L, 0L,
                owner.toUpperCase(java.util.Locale.ROOT)), "same-reregister");
        assertThat(deviceKey("same-token")).isEqualTo(identity);
    }

    @Test
    void aTokenRotatedBeforeItsTurnStillReceivesThePendingPush() {
        register("rotate-a", "rotate-boot-a", 1, "rotate-reg-a");
        String ownerB = register("rotate-b", "rotate-boot-b", 1, "rotate-reg-b");
        UUID id = enqueue("rotate-before-send");
        when(transport.send(eq("rotate-a"), any(), anyBoolean(), anyString())).thenAnswer(call -> {
            devices.register(USER, body("rotate-b2", null, 1L, 0L, ownerB), "rotate-b-now");
            return PushTransport.Result.SENT;
        });
        dispatch.dispatch(id);
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", id)).containsEntry("status", "PENDING");
        when(clock.instant()).thenReturn(DAY.plusSeconds(61));
        dispatch.dispatch(id);
        verify(transport, times(1)).send(eq("rotate-a"), any(), anyBoolean(), anyString());
        verify(transport, never()).send(eq("rotate-b"), any(), anyBoolean(), anyString());
        verify(transport, times(1)).send(eq("rotate-b2"), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", id)).containsEntry("status", "SENT");
    }

    /**
     * 수신 확인 태그는 «그 기기 등록»의 값이다(GROMO-2520). 같은 사용자의 두 기기는 각자 자기 등록 응답의 태그를
     * 받는다 — 섞이면 앱이 자기 기기로 온 정상 푸시를 버린다. 태그 없는 행(V13 전 등록)으로 가는 푸시에는 키가
     * 없다 — 앱에 준 적 없는 값을 지어 싣지 않는다.
     */
    @Test
    void eachDeviceGetsItsOwnDeliveryTagAndAnUntaggedRowGetsNoKey() {
        String tagA = (String) devices.register(USER, body("fcm-a", "boot-a", 1L, 0L, null), "reg-a")
                .get("deliveryTag");
        String tagB = (String) devices.register(USER, body("fcm-b", "boot-b", 1L, 0L, null), "reg-b")
                .get("deliveryTag");
        register("fcm-untagged", "boot-untagged", 1, "reg-untagged");
        // V13 전에 등록돼 앱에 태그를 준 적이 없는 행.
        store.update("UPDATE device_tokens SET delivery_tag=NULL WHERE device_token='fcm-untagged'");
        Map<String, Map<String, String>> sent = new LinkedHashMap<>();
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenAnswer(call -> {
            sent.put(call.getArgument(0), call.<RenderedPush>getArgument(1).data());
            return PushTransport.Result.SENT;
        });

        dispatch.dispatch(enqueue("tagged"));

        assertThat(tagA).isNotNull().isNotEqualTo(tagB);
        assertThat(sent).containsOnlyKeys("fcm-a", "fcm-b", "fcm-untagged");
        assertThat(sent.get("fcm-a")).containsEntry("deliveryTag", tagA);
        assertThat(sent.get("fcm-b")).containsEntry("deliveryTag", tagB);
        assertThat(sent.get("fcm-untagged")).doesNotContainKey("deliveryTag");
    }

    /**
     * 태그 때문에 한도를 넘는 기기 «하나»가 받을 수 있는 기기의 발송까지 막아서는 안 된다(GROMO-2520). 수신 확인 태그는 기기
     * 행마다 있을 수도 없을 수도 있어(V13 전 등록은 NULL) 같은 문구도 봉투 크기가 기기마다 다르다 — 태그 없는 행에는 들어맞는
     * 문구가 태그 있는 행에서만 넘는다. 넘는 기기는 호출 없이 건너뛰고, 받을 수 있는 기기에는 그대로 보내 발송으로 맺는다.
     * 태그 있는 기기가 토큰 순으로 앞이라, 건너뛴 뒤에도 루프가 뒤의 기기로 이어지는지까지 본다.
     */
    @Test
    void aDevicePushedOverTheLimitByItsTagIsSkippedWhileTheOtherDeviceStillReceivesThePush() {
        String tag = (String) devices.register(USER, body("fcm-tagged", "boot-tagged", 1L, 0L, null), "reg-tagged")
                .get("deliveryTag");
        register("fcm-untagged", "boot-untagged", 1, "reg-untagged");
        // V13 전에 등록돼 앱에 태그를 준 적이 없는 행.
        store.update("UPDATE device_tokens SET delivery_tag=NULL WHERE device_token='fcm-untagged'");
        sizeTheBodyToTheTagBoundary("over-by-tag", tag);

        UUID id = enqueue("over-by-tag");
        dispatch.dispatch(id);

        verify(transport, never()).send(eq("fcm-tagged"), any(), anyBoolean(), anyString());
        verify(transport, times(1)).send(eq("fcm-untagged"), any(), anyBoolean(), anyString());
        assertThat(store.rows("SELECT device_key FROM delivery_devices WHERE delivery_id=?", id))
                .singleElement()
                .satisfies(row -> assertThat(row).containsEntry("device_key", deviceKey("fcm-untagged")));
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", id)).containsEntry("status", "SENT");
    }

    /**
     * 시도할 기기가 하나도 없으면 — 태그 있는 기기뿐인데 그 봉투가 한도를 넘으면 — 전과 같이 호출 없이, 재시도 없는
     * FAILED 로 끝난다. 영구 문구 오류라 기기의 소유권·전송 자격은 건드리지 않는다.
     */
    @Test
    void whenNoDeviceCanTakeThePushTheDeliveryStillFailsWithoutAnyCall() {
        String tag = (String) devices.register(USER, body("fcm-tagged", "boot-tagged", 1L, 0L, null), "reg-tagged")
                .get("deliveryTag");
        sizeTheBodyToTheTagBoundary("over-for-all", tag);

        UUID id = enqueue("over-for-all");
        dispatch.dispatch(id);

        verify(transport, never()).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status,last_error FROM deliveries WHERE id=?", id))
                .containsEntry("status", "FAILED").containsEntry("last_error", "FCM_PAYLOAD_TOO_LARGE");
        assertThat(store.one("SELECT active,transport_invalid FROM device_tokens WHERE device_token='fcm-tagged'"))
                .containsEntry("active", true).containsEntry("transport_invalid", false);
    }

    /**
     * 이미 받은 기기가 있는 배송은 남은 기기가 한도를 넘어도 FAILED 가 아니다(GROMO-2520). V13 전에 A 는 받고 B 는 일시 실패로
     * 재시도 중인데 B 가 재등록해 태그를 얻으면, 같은 문구가 B 에게만 한도를 넘는다. 시도할 기기는 없지만 알림은 A 에 갔으므로
     * 호출 없이 발송으로 맺는다 — 받은 기기가 하나도 없을 때만 FAILED 다(바로 위 테스트).
     */
    @Test
    void aDeliveryThatADeviceAlreadyReceivedEndsSentWhenTheRetryingDeviceIsLaterPushedOverTheLimit() {
        register("fcm-a", "boot-a", 1, "reg-a");
        Map<String, Object> registeredB = devices.register(USER, body("fcm-b", "boot-b", 1L, 0L, null), "reg-b");
        // V13 전에 등록돼 앱에 태그를 준 적이 없는 두 행 — 이 모양으로 앞 라운드가 돈다.
        store.update("UPDATE device_tokens SET delivery_tag=NULL WHERE device_token IN ('fcm-a','fcm-b')");
        sizeTheBodyToTheTagBoundary("late-tag", (String) registeredB.get("deliveryTag"));
        when(transport.send(eq("fcm-b"), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.RETRY);

        UUID id = enqueue("late-tag");
        dispatch.dispatch(id);

        // 앞 라운드: A 는 받았고 B 는 재시도 중이다.
        assertThat(store.one("SELECT status,last_error FROM deliveries WHERE id=?", id))
                .containsEntry("status", "PENDING").containsEntry("last_error", "FCM_RETRY");
        assertThat(store.rows("SELECT device_key FROM delivery_devices WHERE delivery_id=?", id))
                .singleElement()
                .satisfies(row -> assertThat(row).containsEntry("device_key", deviceKey("fcm-a")));

        // B 가 재등록해 태그를 얻는다 — 같은 문구가 이제 B 에게만 한도를 넘는다.
        devices.register(USER, body("fcm-b", null, 1L, 0L, registeredB.get("ownershipToken").toString()), "re-reg-b");
        assertThat(store.one("SELECT delivery_tag FROM device_tokens WHERE device_token='fcm-b'").get("delivery_tag"))
                .isNotNull();
        when(clock.instant()).thenReturn(DAY.plusSeconds(120));
        dispatch.dispatch(id);

        // 뒤 라운드: 호출은 앞 라운드의 A·B 한 번씩뿐이고, 배송은 FAILED 가 아니라 SENT 다.
        verify(transport, times(1)).send(eq("fcm-a"), any(), anyBoolean(), anyString());
        verify(transport, times(1)).send(eq("fcm-b"), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status,last_error FROM deliveries WHERE id=?", id))
                .containsEntry("status", "SENT").containsEntry("last_error", null);
    }

    @Test
    void 건너뛴기기와무효토큰만남으면다음틱에실패한다() {
        String tag = (String) devices.register(USER, body("fcm-tagged", "boot-tagged", 1L, 0L, null),
                "reg-tagged").get("deliveryTag");
        register("fcm-untagged", "boot-untagged", 1, "reg-untagged");
        store.update("UPDATE device_tokens SET delivery_tag=NULL WHERE device_token='fcm-untagged'");
        sizeTheBodyToTheTagBoundary("mixed-too-large", tag);
        when(transport.send(eq("fcm-untagged"), any(), anyBoolean(), anyString()))
                .thenReturn(PushTransport.Result.UNREGISTERED);

        UUID id = enqueue("mixed-too-large");
        dispatch.dispatch(id);
        assertThat(store.one("SELECT status,last_error FROM deliveries WHERE id=?", id))
                .containsEntry("status", "PENDING").containsEntry("last_error", "NO_ACTIVE_DEVICE");
        assertThat(store.one("SELECT transport_invalid FROM device_tokens WHERE device_token='fcm-untagged'"))
                .containsEntry("transport_invalid", true);

        when(clock.instant()).thenReturn(DAY.plusSeconds(60));
        dispatch.dispatch(id);
        verify(transport, times(1)).send(eq("fcm-untagged"), any(), anyBoolean(), anyString());
        verify(transport, never()).send(eq("fcm-tagged"), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status,last_error FROM deliveries WHERE id=?", id))
                .containsEntry("status", "FAILED").containsEntry("last_error", "FCM_PAYLOAD_TOO_LARGE");
    }

    @Test
    void 같은토큰재등록은낡은태그의발송을막는다() {
        register("fcm-a", "boot-a", 1, "reg-a");
        Map<String, Object> before = devices.register(USER, body("fcm-b", "boot-b", 1L, 0L, null), "reg-b");
        UUID id = enqueue("same-token-tag-fence");
        when(transport.send(eq("fcm-a"), any(), anyBoolean(), anyString())).thenAnswer(call -> {
            devices.register(USER, body("fcm-b", null, 1L, 0L, before.get("ownershipToken").toString()),
                    "reg-b-again");
            return PushTransport.Result.SENT;
        });

        dispatch.dispatch(id);
        verify(transport, never()).send(eq("fcm-b"), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status,last_error FROM deliveries WHERE id=?", id))
                .containsEntry("status", "PENDING").containsEntry("last_error", "OWNERSHIP_CHANGED");
        String currentTag = (String) store.one("SELECT delivery_tag FROM device_tokens WHERE device_token='fcm-b'")
                .get("delivery_tag");
        assertThat(currentTag).isNotEqualTo(before.get("deliveryTag"));

        when(transport.send(eq("fcm-b"), any(), anyBoolean(), anyString())).thenAnswer(call -> {
            assertThat(call.<RenderedPush>getArgument(1).data()).containsEntry("deliveryTag", currentTag);
            return PushTransport.Result.SENT;
        });
        when(clock.instant()).thenReturn(DAY.plusSeconds(60));
        dispatch.dispatch(id);
        verify(transport, times(1)).send(eq("fcm-b"), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status FROM deliveries WHERE id=?", id)).containsEntry("status", "SENT");
    }

    @Test
    void 예순번째기기없는실패는종결하고임대를해제한다() {
        UUID id = enqueue("retry-cap-empty");
        store.update("UPDATE deliveries SET attempts=58 WHERE id=?", id);
        dispatch.dispatch(id);
        assertThat(store.one("SELECT status,attempts,last_error FROM deliveries WHERE id=?", id))
                .containsEntry("status", "PENDING").containsEntry("attempts", 59)
                .containsEntry("last_error", "NO_ACTIVE_DEVICE");
        when(clock.instant()).thenReturn(DAY.plusSeconds(60));
        dispatch.dispatch(id);
        assertThat(store.one("SELECT status,attempts,last_error,lease_token FROM deliveries WHERE id=?", id))
                .containsEntry("status", "FAILED").containsEntry("attempts", 60)
                .containsEntry("last_error", "NO_ACTIVE_DEVICE").containsEntry("lease_token", null);
    }

    @Test
    void 백오프도예순번째실패에서종결한다() {
        UUID id = enqueue("retry-cap-backoff");
        store.update("UPDATE deliveries SET attempts=58 WHERE id=?", id);
        dispatch.backOff(id, "RENDER_FAILED");
        assertThat(store.one("SELECT status,attempts FROM deliveries WHERE id=?", id))
                .containsEntry("status", "PENDING").containsEntry("attempts", 59);
        when(clock.instant()).thenReturn(DAY.plusSeconds(60));
        dispatch.backOff(id, "RENDER_FAILED");
        assertThat(store.one("SELECT status,attempts,last_error,lease_token FROM deliveries WHERE id=?", id))
                .containsEntry("status", "FAILED").containsEntry("attempts", 60)
                .containsEntry("last_error", "RENDER_FAILED").containsEntry("lease_token", null);
    }

    @Test
    void 잡에서발송예외가반복되면예순번째에종결한다() {
        register("fcm-broken", "boot-broken", 1, "reg-broken");
        when(transport.send(eq("fcm-broken"), any(), anyBoolean(), anyString()))
                .thenThrow(new IllegalStateException("FCM 응답이 끝내 오지 않았다"));
        UUID id = enqueue("leased-failure-cap");
        store.update("UPDATE deliveries SET attempts=58 WHERE id=?", id);
        store.update("UPDATE jobs SET enabled=true WHERE id='delivery-dispatch'");
        store.update("INSERT INTO job_runs(job_id,scheduled_at) VALUES('delivery-dispatch',?)",
                java.sql.Timestamp.from(DAY.minusSeconds(1)));

        jobs.tick();
        assertThat(store.one("SELECT status,attempts,last_error,lease_token,lease_expires_at FROM deliveries"
                + " WHERE id=?", id))
                .containsEntry("status", "PENDING").containsEntry("attempts", 59)
                .containsEntry("last_error", "IllegalStateException")
                .containsEntry("lease_token", null).containsEntry("lease_expires_at", null);
        jobs.tick();
        verify(transport, times(1)).send(eq("fcm-broken"), any(), anyBoolean(), anyString());

        when(clock.instant()).thenReturn(DAY.plusSeconds(60));
        store.update("INSERT INTO job_runs(job_id,scheduled_at) VALUES('delivery-dispatch',?)",
                java.sql.Timestamp.from(DAY.plusSeconds(60)));
        jobs.tick();
        assertThat(store.one("SELECT status,attempts,last_error,lease_token FROM deliveries WHERE id=?", id))
                .containsEntry("status", "FAILED").containsEntry("attempts", 60)
                .containsEntry("last_error", "IllegalStateException").containsEntry("lease_token", null);
        verify(transport, times(2)).send(eq("fcm-broken"), any(), anyBoolean(), anyString());
    }

    @Test
    void 낡은발송실패가새임대를덮어쓰지않는다() {
        register("fcm-stale", "boot-stale", 1, "reg-stale");
        UUID id = enqueue("stale-failure-lease");
        UUID newerLease = UUID.randomUUID();
        when(transport.send(eq("fcm-stale"), any(), anyBoolean(), anyString())).thenAnswer(call -> {
            store.update("UPDATE deliveries SET lease_token=?,lease_expires_at=?,next_attempt_at=? WHERE id=?",
                    newerLease, java.sql.Timestamp.from(DAY.plusSeconds(600)),
                    java.sql.Timestamp.from(DAY.plusSeconds(600)), id);
            throw new IllegalStateException("낡은 실행이 실패했다");
        });
        store.update("UPDATE jobs SET enabled=true WHERE id='delivery-dispatch'");
        store.update("INSERT INTO job_runs(job_id,scheduled_at) VALUES('delivery-dispatch',?)",
                java.sql.Timestamp.from(DAY.minusSeconds(1)));

        jobs.tick();
        assertThat(store.one("SELECT status,attempts,lease_token FROM deliveries WHERE id=?", id))
                .containsEntry("status", "PENDING").containsEntry("attempts", 0)
                .containsEntry("lease_token", newerLease);
    }

    /**
     * 관리자 {@code dataTemplate} 이 예약 키 {@code deliveryTag} 를 넣어 둬도 그 값은 어느 기기에도 태그로 나가지 않는다
     * (GROMO-2520). 2527 이후 저장 API 는 예약 키를 막지만, 이전에 저장된 행은 남아 있을 수 있다. 태그 있는 기기에는 그 기기 등록의 값이, 태그 없는 행(V13 전 등록)에는
     * 키가 아예 없어야 한다. 앱에 준 적 없는 값이 태그로 가면 앱이 정상 푸시를 버리거나 낡은 푸시를 받아들인다.
     */
    @Test
    void aDeliveryTagKeyInTheDeeplinkTemplateNeverReachesADeviceAsAnythingButItsOwnTag() {
        String tag = (String) devices.register(USER, body("fcm-tagged", "boot-tagged", 1L, 0L, null), "reg-tagged")
                .get("deliveryTag");
        register("fcm-untagged", "boot-untagged", 1, "reg-untagged");
        // V13 전에 등록돼 앱에 태그를 준 적이 없는 행.
        store.update("UPDATE device_tokens SET delivery_tag=NULL WHERE device_token='fcm-untagged'");
        store.update("INSERT INTO deeplinks(id,url_template,data_template)"
                + " VALUES('FRIEND_ACCEPTED',NULL,'{\"deliveryTag\":\"from-admin\"}'::jsonb)");
        Map<String, Map<String, String>> sent = new LinkedHashMap<>();
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenAnswer(call -> {
            sent.put(call.getArgument(0), call.<RenderedPush>getArgument(1).data());
            return PushTransport.Result.SENT;
        });

        dispatch.dispatch(enqueue("reserved-key"));

        assertThat(sent).containsOnlyKeys("fcm-tagged", "fcm-untagged");
        assertThat(sent.get("fcm-tagged")).containsEntry("deliveryTag", tag);
        assertThat(sent.get("fcm-untagged")).doesNotContainKey("deliveryTag");
    }

    /**
     * 템플릿 본문을 «태그 없이는 한도에 들어가고 태그를 더하면 넘는» 길이로 맞춘다. 숫자를 박지 않고
     * {@link FcmPayload#requireFits} 가 실제로 세는 값으로 경계를 찾는다 — 한도나 봉투가 바뀌어도 같은 경계를 겨눈다.
     * 소리 켜짐은 설정 행이 없을 때의 기본값이라 실제 발송과 같고, 본문은 ASCII 라 한 글자가 정확히 1바이트다.
     */
    private void sizeTheBodyToTheTagBoundary(String eventId, String tag) {
        RenderedPush rendered = new Renderer(store).render("FRIEND_ACCEPTED", "ko", Map.of("kind", "FRIEND_ACCEPTED"));
        int length = 0;
        while (fits(rendered, "a".repeat(length), tag, eventId)) {
            length++;
        }
        String filler = "a".repeat(length);
        assertThat(fits(rendered, filler, null, eventId)).as("태그가 없으면 들어가야 한다").isTrue();
        store.update("UPDATE templates SET body=? WHERE kind='FRIEND_ACCEPTED'", filler);
    }

    /** 이 본문의 푸시가 한도에 들어가는가 — {@code tag} 가 null 이면 태그 없는 행의 봉투다. */
    private static boolean fits(RenderedPush rendered, String body, String tag, String eventId) {
        RenderedPush push = new RenderedPush(rendered.title(), body, rendered.data(), rendered.silent());
        try {
            FcmPayload.requireFits(tag == null ? push : push.withDeliveryTag(tag), true, eventId);
            return true;
        } catch (NotificationFailure tooLarge) {
            return false;
        }
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
        event.put("params", Map.of("kind", "FRIEND_ACCEPTED"));
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
