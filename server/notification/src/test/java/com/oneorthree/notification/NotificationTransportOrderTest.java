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
    void newerWithdrawalTombstoneSuppressesDelayedKafkaAtReceipt() {
        inbound.accept(NotificationStoreTest.event("withdraw", "user.withdrawn", USER, 2, null,
                Map.of("authGeneration", 1)));
        receiveDelayedRequest();
        assertThat(status()).isEqualTo("SUPPRESSED");
        dispatch.dispatch((UUID) store.one("SELECT id FROM deliveries WHERE event_id='request'").get("id"));
        verifyNoInteractions(transport);
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

    private String status() {
        return store.one("SELECT status FROM deliveries WHERE event_id='request'").get("status").toString();
    }
}
