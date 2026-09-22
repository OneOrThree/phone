package com.oneorthree.phone.internal;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * PR896 cross-service harness bootstrap: 실제 Data HTTP 서버와 전용 PostgreSQL을 한 번 연결한다.
 *
 * <p>Business 기동·실제 relay 검증은 다음 단계의 관심사다. 이 테스트는 {@code bootRun} 프로세스를
 * 따로 소유하지 않고 SpringBootTest가 랜덤 포트 Tomcat을 수명 주기와 함께 정리하게 한다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class LoginAttemptLookupHttpHarnessTest {

    private static final String LOOKUP_PATH = "/internal/auth/login-attempts/lookup";
    private static final String BUSINESS_TOKEN = "test-business-to-data-lookup-harness";
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("lookup_harness")
            .withUsername("test")
            .withPassword("test");

    static {
        POSTGRES.start();
    }

    @LocalServerPort
    int port;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "create-drop");
        registry.add("spring.flyway.enabled", () -> false);
        registry.add("app.scheduling.enabled", () -> false);
        registry.add("management.health.redis.enabled", () -> false);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> BUSINESS_TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "POST " + LOOKUP_PATH);
    }

    @Test
    @DisplayName("랜덤 포트 Data HTTP 서버는 내부 login-attempt lookup 요청 한 번에 miss를 응답한다")
    void lookupOverOwnedHttpServer() throws Exception {
        String requestBody = """
                {"attemptId":"%s","digestKeyId":"harness-key","credentialDigest":"harness-digest"}
                """.formatted(UUID.randomUUID());
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + LOOKUP_PATH))
                .header("Authorization", "Bearer " + BUSINESS_TOKEN)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                .build();

        HttpResponse<String> response = HttpClient.newHttpClient()
                .send(request, HttpResponse.BodyHandlers.ofString());

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).isEqualTo("{\"replayable\":false,\"session\":null}");
    }

    @AfterAll
    static void stopOwnedPostgres() {
        POSTGRES.stop();
    }
}
