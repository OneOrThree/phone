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

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class NotificationTransportOrderTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("11111111-1111-4111-8111-111111111111");

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

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE delivery_devices,deliveries,inbound_events,commands,device_tokens,"
                + "session_fences,legacy_session_fences,user_fences,settings,projections CASCADE");
        store.update("UPDATE dispatch_control SET enabled=true,ever_opened=false,active_migration_id=NULL");
        store.update("INSERT INTO kinds(id,quiet_policy) VALUES('TRANSPORT_ORDER','BYPASS') ON CONFLICT DO NOTHING");
        store.update("INSERT INTO templates(id,kind,locale,title,body)"
                + " VALUES('TRANSPORT_ORDER.ko','TRANSPORT_ORDER','ko','알림','내용') ON CONFLICT DO NOTHING");
        devices.register(USER, Map.of("deviceToken", "device", "deviceBootstrap", "bootstrap",
                "sessionEpoch", 1, "authGeneration", 0), "register");
        reset(transport, data);
        // Data의 공통 활성 판정을 통과시켜 이 회귀가 로컬 세대·설정 장벽 자체를 검사하게 한다.
        when(data.eligible(any(), anyString(), any(), any())).thenReturn(true);
    }

    @Test
    void newerDisabledSettingsSuppressDelayedKafkaAndEnablingDoesNotResurrectIt() {
        inbound.accept(NotificationStoreTest.event("off", "notification.settings.changed", USER, 2, null,
                NotificationStoreTest.preferences(false)));
        receiveDelayedRequest();
        dispatch.dispatch((UUID) store.one("SELECT id FROM deliveries WHERE event_id='request'").get("id"));
        assertThat(status()).isEqualTo("SUPPRESSED");

        inbound.accept(NotificationStoreTest.event("on", "notification.settings.changed", USER, 3, null,
                NotificationStoreTest.preferences(true)));
        dispatch.dispatch((UUID) store.one("SELECT id FROM deliveries WHERE event_id='request'").get("id"));
        assertThat(status()).isEqualTo("SUPPRESSED");
        verifyNoInteractions(transport);
    }

    @Test
    void newerWithdrawalTombstoneDropsDelayedKafkaAtReceipt() {
        inbound.accept(NotificationStoreTest.event("withdraw", "user.withdrawn", USER, 2, null,
                Map.of("authGeneration", 1)));
        receiveDelayedRequest();
        // 탈퇴자의 발송 로그는 억제 행으로도 새로 남기지 않는다(GROMO-1943).
        assertThat(sendLogRows()).isZero();
        verifyNoInteractions(transport);
    }

    @Test
    void withdrawalErasesSendLogsAndRedeliveryKeepsThemAtZero() {
        when(transport.send(anyString(), any(), anyBoolean(), anyString())).thenReturn(PushTransport.Result.SENT);
        receiveDelayedRequest();
        dispatch.dispatch((UUID) store.one("SELECT id FROM deliveries WHERE event_id='request'").get("id"));
        assertThat(status()).isEqualTo("SENT");
        inbound.accept(NotificationStoreTest.event("pending", "notification.requested", USER, 2, null,
                Map.of("kind", "TRANSPORT_ORDER")));
        assertThat(sendLogRows()).isEqualTo(3); // SENT 1 + 그 기기 기록 1 + PENDING 1

        Map<String, Object> withdrawn = NotificationStoreTest.event("withdraw", "user.withdrawn", USER, 3, null,
                Map.of("authGeneration", 1));
        inbound.accept(withdrawn);
        assertThat(sendLogRows()).isZero();

        // 같은 사건의 재전달(같은 eventId)과 리컨실의 재적용(새 eventId) 모두 결과가 같다.
        inbound.accept(withdrawn);
        inbound.accept(NotificationStoreTest.event("withdraw-reconcile", "user.withdrawn", USER, 4, null,
                Map.of("authGeneration", 1)));
        assertThat(sendLogRows()).isZero();
    }

    @Test
    void newerGenerationPreventsDelayedKafkaFromUsingAnOldDevice() {
        inbound.accept(NotificationStoreTest.event("generation", "auth.generation.bumped", USER, 2, null,
                Map.of("authGeneration", 1)));
        receiveDelayedRequest();
        dispatch.dispatch((UUID) store.one("SELECT id FROM deliveries WHERE event_id='request'").get("id"));
        assertThat(store.one("SELECT active FROM device_tokens WHERE device_token='device'"))
                .containsEntry("active", false);
        assertThat(status()).isEqualTo("PENDING");
        verifyNoInteractions(transport);
    }

    private void receiveDelayedRequest() {
        // Kafka 브로커 ACK 뒤 소비가 지연되어 더 높은 version의 HTTP 상태가 먼저 반영된 순서다.
        inbound.accept(NotificationStoreTest.event("request", "notification.requested", USER, 1, null,
                Map.of("kind", "TRANSPORT_ORDER")));
    }

    /** 탈퇴자 발송 로그 = deliveries + 기기별 발송 기록. 매 테스트가 두 표를 비우므로 전부 USER 것이다. */
    private long sendLogRows() {
        return ((Number) store.one("SELECT (SELECT count(*) FROM deliveries WHERE user_id=?)"
                + " + (SELECT count(*) FROM delivery_devices) AS n", USER).get("n")).longValue();
    }

    private String status() {
        return store.one("SELECT status FROM deliveries WHERE event_id='request'").get("status").toString();
    }
}
