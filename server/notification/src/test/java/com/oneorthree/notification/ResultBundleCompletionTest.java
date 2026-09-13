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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 슬롯 마감보다 늦은 relay/DLT 전달도 완료 봉투와 실제 사건 집합을 모두 기다린다. */
@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class ResultBundleCompletionTest {

    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final UUID USER = UUID.randomUUID();
    private static final UUID GROUP = UUID.randomUUID();
    private static final Instant SLOT = Instant.parse("2026-09-11T03:00:00Z");
    private static final Instant NOW = SLOT.plusSeconds(3600);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }

    @Autowired Store store;
    @Autowired InboundService inbound;
    @Autowired DeviceService devices;
    @Autowired DispatchService dispatch;
    @MockitoBean PushTransport transport;
    @MockitoBean DataClient data;
    @MockitoBean Clock clock;

    @BeforeEach
    void setup() {
        store.update("TRUNCATE result_bundle_manifests,delivery_devices,deliveries,inbound_events,commands,"
                + "device_tokens,session_fences,user_fences,settings,result_ack CASCADE");
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=true");
        reset(clock, data, transport);
        when(clock.instant()).thenReturn(NOW);
        when(data.eligible(any(), anyString(), any(), any())).thenReturn(true);
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
        devices.register(USER, Map.of("deviceToken", "device", "deviceBootstrap", "bootstrap",
                "sessionEpoch", 1, "authGeneration", 0), "register");
    }

    @Test
    void firstLateEventWaitsForSealAndMissingRefundEvenAfterTheSlotClosed() {
        requested("result", "BET_RESULT");
        dispatch.dispatch(delivery("result"));
        verifyNoInteractions(transport);
        inbound.accept(seal("seal", List.of("refund", "result")));
        when(clock.instant()).thenReturn(NOW.plusSeconds(31));
        dispatch.dispatch(delivery("result"));
        verifyNoInteractions(transport);
        requested("refund", "BET_VOID_REFUND");
        dispatch.dispatch(delivery("refund"));
        verify(transport, times(1)).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(store.rows("SELECT status FROM deliveries"))
                .allSatisfy(row -> assertThat(row).containsEntry("status", "SENT"));
        inbound.accept(seal("seal", List.of("refund", "result")));
        dispatch.dispatch(delivery("result"));
        verify(transport, times(1)).send(anyString(), any(), anyBoolean(), anyString());
    }

    @Test
    void sealCanArriveFirstAndSuppressedMembersStillCountAsReceived() {
        inbound.accept(seal("seal-first", List.of("refund", "result")));
        requested("refund", "BET_VOID_REFUND");
        dispatch.dispatch(delivery("refund"));
        verifyNoInteractions(transport);
        requested("result", "BET_RESULT");
        store.update("UPDATE deliveries SET status='SUPPRESSED' WHERE event_id='result'");
        when(clock.instant()).thenReturn(NOW.plusSeconds(31));
        dispatch.dispatch(delivery("refund"));
        verify(transport).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status FROM deliveries WHERE event_id='result'"))
                .containsEntry("status", "SUPPRESSED");
    }

    @Test
    void aConflictingSealCannotReplaceTheDeclaredSet() {
        inbound.accept(seal("first", List.of("result", "refund")));
        assertThatThrownBy(() -> inbound.accept(seal("different", List.of("result"))))
                .hasMessage("RESULT_BUNDLE_MANIFEST_CONFLICT");
        assertThat(store.one("SELECT 1 FROM inbound_events WHERE event_id='different'")).isNull();
    }

    @Test
    void anUndeclaredLateEventCannotEscapeAsAnotherPush() {
        requested("result", "BET_RESULT");
        inbound.accept(seal("seal", List.of("result")));
        dispatch.dispatch(delivery("result"));
        requested("refund", "BET_VOID_REFUND");
        dispatch.dispatch(delivery("refund"));
        verify(transport, times(1)).send(anyString(), any(), anyBoolean(), anyString());
        assertThat(store.one("SELECT status FROM deliveries WHERE event_id='refund'"))
                .containsEntry("status", "PENDING");
    }

    private void requested(String id, String kind) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("kind", kind);
        params.put("groupId", GROUP.toString());
        params.put("slotAt", SLOT.toString());
        params.put("challengeId", UUID.randomUUID().toString());
        params.put("betStatus", "SETTLED");
        params.put("achieved", true);
        params.put("stake", 100);
        params.put("payout", 200);
        params.put("voidReason", "CHALLENGE_DELETED");
        inbound.accept(event(id, "notification.requested", UUID.randomUUID().toString(), params));
    }

    private Map<String, Object> seal(String id, List<String> members) {
        return event(id, "notification.resultBundle.closed", GROUP.toString(),
                Map.of("groupId", GROUP.toString(), "slotAt", SLOT.toString(), "eventIds", members));
    }

    private Map<String, Object> event(String id, String type, String subject, Map<String, Object> params) {
        return Map.of("eventId", id, "schemaVersion", 1, "type", type, "userId", USER.toString(),
                "version", 1, "subjectId", subject, "locale", "ko", "occurredAt", NOW.toString(),
                "scheduledAt", NOW.toString(), "params", params);
    }

    private UUID delivery(String event) {
        return (UUID) store.one("SELECT id FROM deliveries WHERE event_id=?", event).get("id");
    }
}
