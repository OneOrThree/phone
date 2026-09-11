package com.oneorthree.phone.common.support;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.UUID;

/**
 * JVM당 PostgreSQL 컨테이너 하나를 공유하되 create-drop 스키마는 Spring 컨텍스트마다 격리한다.
 *
 * <p>컨텍스트 캐시는 DynamicPropertySource 메서드와 설정 형상으로 나뉜다. 같은 DB URL을 주입해도
 * 하나가 되지 않으며, 공유 스키마에서는 한 컨텍스트의 종료가 다른 컨텍스트의 테이블을 지운다.
 * 각 컨텍스트가 자신의 스키마만 생성·삭제하게 하여 LRU 퇴출과 재부팅 모두 안전하게 만든다.
 *
 * <p>컨텍스트 캐시 적중 시에는 기존 스키마를 그대로 쓴다. 남은 빈 스키마와 컨테이너는
 * JVM 종료 시 Testcontainers의 Ryuk이 정리한다.
 */
public final class TestPostgres {

    public static final PostgreSQLContainer<?> INSTANCE;

    static {
        INSTANCE = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("test_db")
                .withUsername("test")
                .withPassword("test");
        INSTANCE.start();
    }

    private TestPostgres() {
    }

    /** 컨텍스트 부팅당 한 번 호출한다. 프로퍼티 supplier 재평가로 스키마를 바꾸지 않는다. */
    public static void registerIsolatedSchema(DynamicPropertyRegistry registry) {
        // 외부 입력 없이 소문자 hex만 사용하므로 SQL 식별자와 JDBC 파라미터 모두 안전하다.
        String schema = "test_" + UUID.randomUUID().toString().replace("-", "");
        String baseUrl = INSTANCE.getJdbcUrl();
        try (var connection = DriverManager.getConnection(
                baseUrl, INSTANCE.getUsername(), INSTANCE.getPassword());
                var statement = connection.createStatement()) {
            statement.execute("CREATE SCHEMA " + schema);
        } catch (SQLException e) {
            throw new IllegalStateException("테스트 컨텍스트 전용 스키마 생성 실패", e);
        }
        String jdbcUrl = baseUrl + (baseUrl.contains("?") ? "&" : "?") + "currentSchema=" + schema;
        registry.add("spring.datasource.url", () -> jdbcUrl);
        registry.add("spring.datasource.username", INSTANCE::getUsername);
        registry.add("spring.datasource.password", INSTANCE::getPassword);
        registry.add("spring.jpa.properties.hibernate.default_schema", () -> schema);
    }
}
