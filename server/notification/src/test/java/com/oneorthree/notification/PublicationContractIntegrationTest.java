package com.oneorthree.notification;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.Base64;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** 실제 Flyway·인증·DB 표식·HTTP 계약을 함께 검증한다. */
@SpringBootTest(properties = {
        "fcm.project-id=contract-prod", "spring.kafka.bootstrap-servers=localhost:9092",
        "notification.tokens.business=test-business", "notification.tokens.data=test-data",
        "notification.tokens.console=member-1:test-console,member-2:test-console-2",
        "notification.data-url=http://localhost:18080", "notification.data-token=test-noti-to-data"
})
@AutoConfigureMockMvc
@ActiveProfiles("prod")
@Testcontainers
class PublicationContractIntegrationTest {
    @Container
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", PG::getJdbcUrl);
        registry.add("spring.datasource.username", PG::getUsername);
        registry.add("spring.datasource.password", PG::getPassword);
        // 실제 FcmTransport 구성만 생성한다. 환경 불일치 검사는 외부 HTTP 전에 중단된다.
        registry.add("fcm.service-account-json", () -> Base64.getEncoder().encodeToString(
                Json.write(Map.of("type", "authorized_user", "client_id", "local-test",
                        "client_secret", "local-test", "refresh_token", "local-test"))
                        .getBytes(StandardCharsets.UTF_8)));
    }

    @Autowired MockMvc mvc;
    @Autowired Store store;
    @Autowired FcmTransport transport;

    @BeforeEach
    void markDatabase() {
        // 컴포넌트와 데이터소스는 실제 prod 구성을 사용하고 DB 정체성만 로컬 테스트에 설정한다.
        store.update("ALTER DATABASE test SET gromo.environment='prod'");
        store.update("ALTER DATABASE test SET gromo.fcm_project_id='contract-prod'");
    }

    @Test
    void migratedLegacyDatabaseExposesContractAndKeepsLegacyObjects() throws Exception {
        var response = mvc.perform(get("/internal/admin/publications/environment")
                .header("Authorization", "Bearer test-console")).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(Json.map(response.getContentAsString())).containsEntry("environment", "prod")
                .containsEntry("fcmProjectId", "contract-prod").containsEntry("contractVersion", "1")
                .containsEntry("capabilities", List.of("notification.publication.v1", "notification.history.v1",
                        "notification.templates.v1"));
        assertThat(store.one("SELECT to_regclass('result_ack')::text AS name")).containsEntry("name", "result_ack");
        assertThat(store.one("SELECT enabled FROM kinds WHERE id='BET_RESULT'")).containsEntry("enabled", true);
        assertThat(store.one("SELECT id FROM jobs WHERE id='bundle-flush'")).isNotNull();
        assertThat(store.one("SELECT version FROM flyway_schema_history WHERE version='9.1' AND success"))
                .containsEntry("version", "9.1");
    }

    @Test
    void authenticatedPublicationAndHistoryUseRealEnvironmentAndActor() throws Exception {
        UUID publication = UUID.randomUUID();
        var payload = Map.of("kind", "ADMIN_ANNOUNCEMENT", "locale", "ko", "title", "공지",
                "body", "검토한 본문", "data", Map.of(), "silent", false,
                "params", Map.of(), "userIds", List.of(UUID.randomUUID().toString()));
        var request = post("/internal/admin/publications/" + publication)
                .header("Authorization", "Bearer test-console-2").header("Idempotency-Key", publication.toString())
                .header("X-Backoffice-Environment", "prod").header("X-Backoffice-Fcm-Project", "contract-prod")
                .contentType("application/json").content(Json.write(payload));
        assertThat(mvc.perform(request).andReturn().getResponse().getStatus()).isEqualTo(200);
        var response = mvc.perform(get("/internal/admin/publications/history")
                .header("Authorization", "Bearer test-console-2")
                .header("X-Backoffice-Environment", "prod").header("X-Backoffice-Fcm-Project", "contract-prod"))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsString()).contains("member-2", publication.toString());
        assertThat(store.one("SELECT admin_actor FROM deliveries WHERE subject_id=?", publication.toString()))
                .containsEntry("admin_actor", "member-2");
    }

    @Test
    void foreignCallerCannotReadContract() throws Exception {
        assertThat(mvc.perform(get("/internal/admin/publications/environment")
                .header("Authorization", "Bearer test-data")).andReturn().getResponse().getStatus()).isEqualTo(403);
    }
    @Test
    void actualProductionTransportRejectsMismatchedDatabaseBeforeAnyExternalSend() {
        store.update("ALTER DATABASE test SET gromo.environment='dev'");
        assertThatThrownBy(() -> transport.send("unused", new RenderedPush("공지", "본문", Map.of(), false),
                false, "unused"))
                .isInstanceOf(NotificationEnvironmentGuard.EnvironmentMismatch.class);
    }
}
