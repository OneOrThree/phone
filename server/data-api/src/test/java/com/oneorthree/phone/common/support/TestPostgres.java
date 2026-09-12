package com.oneorthree.phone.common.support;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

/**
 * 테스트 JVM에서 PostgreSQL 컨테이너를 공유하되 스키마는 Spring 컨텍스트마다 격리한다.
 *
 * <p>서로 다른 설정·목·DynamicPropertySource 메서드는 별도 컨텍스트 캐시 항목을 만든다.
 * 같은 스키마에 create-drop 컨텍스트를 여러 개 띄우면 하나가 LRU 퇴거될 때 생존 컨텍스트의
 * 테이블까지 삭제된다. 새 컨텍스트의 create 역시 다른 컨텍스트 데이터를 지운다.
 *
 * <p>DynamicPropertySource 실행마다 스키마 하나를 만들고 고정 URL을 등록한다. 캐시된
 * 컨텍스트는 그 스키마를 계속 재사용하며, 종료 시 Hibernate는 자기 테이블만 제거한다.
 * 빈 스키마를 포함한 컨테이너의 최종 정리는 JVM 종료 시 Testcontainers Ryuk가 맡는다.
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

    public static void applyContextWiring(DynamicPropertyRegistry registry) {
        String schema = "context_" + UUID.randomUUID().toString().replace("-", "");
        try (Connection connection = DriverManager.getConnection(
                INSTANCE.getJdbcUrl(), INSTANCE.getUsername(), INSTANCE.getPassword());
                Statement statement = connection.createStatement()) {
            statement.execute("CREATE SCHEMA " + schema);
        } catch (SQLException exception) {
            throw new IllegalStateException("Cannot create isolated test schema", exception);
        }
        String baseUrl = INSTANCE.getJdbcUrl();
        String url = baseUrl + (baseUrl.contains("?") ? "&" : "?") + "currentSchema=" + schema;
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", INSTANCE::getUsername);
        registry.add("spring.datasource.password", INSTANCE::getPassword);
    }

    private TestPostgres() {
    }
}
