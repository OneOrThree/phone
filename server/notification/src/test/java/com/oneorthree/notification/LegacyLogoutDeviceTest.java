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

/** RT-only 구 로그아웃은 아직 세션에 연결되지 않은 이관 기기만 지운다. */
@SpringBootTest
@ActiveProfiles("ci")
@Testcontainers
class LegacyLogoutDeviceTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");
    static final UUID USER = UUID.fromString("88888888-8888-4888-8888-888888888888");
    static final UUID OTHER = UUID.fromString("99999999-9999-4999-8999-999999999999");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
    }

    @Autowired Store store;
    @Autowired DeviceService devices;
    @Autowired InboundService inbound;
    @MockitoBean DataClient data;
    @MockitoBean PushTransport transport;

    @BeforeEach
    void resetState() {
        store.update("TRUNCATE delivery_devices,deliveries,inbound_events,commands,device_tokens,"
                + "session_fences,legacy_session_fences,user_fences,settings,projections CASCADE");
    }

    @Test
    void theExactImportedDeviceIsDeletedOnceAndOtherDevicesSurvive() {
        imported("legacy-device", USER);
        imported("other-device", USER);
        Map<String, Object> event = deletion("legacy-device");
        inbound.accept(event);
        long version = ((Number) row("legacy-device").get("ownership_version")).longValue();
        inbound.accept(event);
        assertThat(row("legacy-device")).containsEntry("active", false)
                .containsEntry("ownership_version", version);
        assertThat(row("other-device")).containsEntry("active", true);
    }

    @Test
    void delayedLegacyDeletionCannotDisableTheSameTokenAfterBootstrapRegistration() {
        imported("legacy-device", USER);
        devices.register(USER, Map.of("deviceToken", "legacy-device", "deviceBootstrap", "new-bootstrap",
                "sessionEpoch", 4L, "authGeneration", 0L), "register");
        inbound.accept(deletion("legacy-device"));
        assertThat(row("legacy-device")).containsEntry("active", true);
    }

    @Test
    void delayedLegacyDeletionCannotDisableTheSameTokenAfterSidRegistration() {
        imported("legacy-device", USER);
        devices.register(USER, Map.of("deviceToken", "legacy-device", "legacySessionId", UUID.randomUUID().toString(),
                "sessionEpoch", 4L, "authGeneration", 0L), "register");
        inbound.accept(deletion("legacy-device"));
        assertThat(row("legacy-device")).containsEntry("active", true);
    }

    @Test
    void deletionCannotTouchAnotherAccountAndNewCredentialsCanRegisterAfterIt() {
        imported("moved-device", OTHER);
        inbound.accept(deletion("moved-device"));
        assertThat(row("moved-device")).containsEntry("active", true).containsEntry("user_id", OTHER);
        inbound.accept(deletion("not-yet-imported"));
        assertThat(row("not-yet-imported")).containsEntry("active", false);
        devices.register(USER, Map.of("deviceToken", "not-yet-imported", "deviceBootstrap", "fresh-bootstrap",
                "sessionEpoch", 5L, "authGeneration", 0L), "register-after-delete");
        assertThat(row("not-yet-imported")).containsEntry("active", true);
    }

    private void imported(String token, UUID user) {
        store.update("INSERT INTO device_tokens(device_token,user_id,ownership_token,auth_generation,active)"
                + " VALUES(?,?,?,0,true)", token, user, UUID.randomUUID());
    }

    private Map<String, Object> row(String token) {
        return store.one("SELECT * FROM device_tokens WHERE device_token=?", token);
    }

    private Map<String, Object> deletion(String token) {
        return NotificationStoreTest.event("legacy-delete-" + token, "notification.legacyDeviceToken.deleted",
                USER, 1, null, Map.of("deviceToken", token));
    }
}
