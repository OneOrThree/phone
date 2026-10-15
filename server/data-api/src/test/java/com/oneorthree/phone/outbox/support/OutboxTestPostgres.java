package com.oneorthree.phone.outbox.support;

import org.flywaydb.core.Flyway;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

/**
 * outbox 통합 테스트 전용 PostgreSQL — <b>운영 마이그레이션 배선</b>으로 띄운다.
 *
 * <p>{@code common/support/TestPostgres} 와 나눈 이유: 그쪽 컨테이너는 CI 프로파일의
 * {@code create-drop} 으로 쓰이고 있어서, 같은 컨테이너에 Flyway 를 태우면 두 방식이 같은 스키마를
 * 두고 다툰다.
 *
 * <p><b>여기서는 {@code create-drop} 을 쓰지 않는다.</b> 엔티티에서 스키마를 만들면 검증되는 것이
 * 「엔티티끼리 일관된가」뿐이고, 정작 운영이 쓰는 {@code V51} 의 제약·부분 인덱스·CHECK 는 한 번도
 * 실행되지 않는다 — 그 드리프트는 dev 부팅에서만 터진다. 그래서 Flyway 를 켜고
 * {@code ddl-auto=validate} 로 <b>엔티티 ↔ 마이그레이션</b>을 맞댄다.
 *
 * <p><b>컨텍스트마다 database 가 따로다</b> (GROMO-1792). 예전에는 이 배선을 쓰는 컨텍스트 수십 개가
 * {@code outbox_db} 하나를 나눠 써서, 캐시에 살아 있는 다른 컨텍스트가 남긴 행이 「전역 count」 단정을
 * 흔들었다. 이제 JVM 시작 때 {@code outbox_db} 를 운영 마이그레이션으로 한 번 올려 <b>템플릿</b>으로만 두고,
 * 컨텍스트가 뜰 때마다 {@code CREATE DATABASE ... TEMPLATE outbox_db} 로 복사본을 받는다 — 파일 복사라
 * V1 부터 다시 도는 것보다 훨씬 싸다. 컨텍스트의 Flyway 는 그대로 켜 두어 이력·체크섬 검증은 매번 탄다.
 * 템플릿에는 아무도 접속하지 않는다 — 접속이 하나라도 있으면 PostgreSQL 이 복사를 거부한다.
 */
public final class OutboxTestPostgres {

    /** JVM 하나당 컨테이너 하나 — database 는 컨텍스트마다 다르다. */
    public static final PostgreSQLContainer<?> INSTANCE;

    private static final String TEMPLATE = "outbox_db";

    static {
        INSTANCE = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName(TEMPLATE)
                .withUsername("outbox")
                .withPassword("outbox");
        INSTANCE.start();
        Flyway.configure()
                .dataSource(INSTANCE.getJdbcUrl(), INSTANCE.getUsername(), INSTANCE.getPassword())
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }

    private OutboxTestPostgres() {
    }

    /**
     * 운영 마이그레이션을 마친 <b>이 컨텍스트 전용</b> database 를 만들어 배선한다.
     *
     * @param registry 스프링 테스트 프로퍼티 레지스트리
     */
    public static void applyProductionMigrationWiring(DynamicPropertyRegistry registry) {
        String database = "ctx_" + UUID.randomUUID().toString().replace("-", "");
        try (Connection connection = DriverManager.getConnection(jdbcUrl("postgres"),
                INSTANCE.getUsername(), INSTANCE.getPassword());
                Statement statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE " + database + " TEMPLATE " + TEMPLATE);
        } catch (SQLException exception) {
            throw new IllegalStateException("컨텍스트 전용 테스트 DB 를 만들 수 없다", exception);
        }
        wire(registry, jdbcUrl(database), INSTANCE.getUsername(), INSTANCE.getPassword());
    }

    /**
     * 한 테스트 클래스만 쓰는 PostgreSQL 을 띄운다.
     *
     * <p>전역 순위처럼 «DB 의 사용자 전부»를 훑는 배치는 공유 컨테이너에서 앞선 모든 테스트가 남긴 사용자까지 판정·기록해
     * CI 에서 분 단위로 느려진다(250명을 심어도 948명을 처리했다). 그런 클래스는 자기 사용자만 있는 DB 를 쓴다.
     *
     * @param databaseName DB 이름
     * @return 시작된 컨테이너 — 사용자·비밀번호는 공유 컨테이너와 같다
     */
    public static PostgreSQLContainer<?> startDedicated(String databaseName) {
        PostgreSQLContainer<?> container = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName(databaseName)
                .withUsername("outbox")
                .withPassword("outbox");
        container.start();
        return container;
    }

    /**
     * 운영 마이그레이션 배선을 주어진 컨테이너로 건다.
     *
     * @param registry 스프링 테스트 프로퍼티 레지스트리
     * @param database 붙을 PostgreSQL
     */
    public static void applyProductionMigrationWiring(DynamicPropertyRegistry registry,
                                                      PostgreSQLContainer<?> database) {
        wire(registry, database.getJdbcUrl(), database.getUsername(), database.getPassword());
    }

    static String jdbcUrl(String database) {
        return "jdbc:postgresql://" + INSTANCE.getHost() + ":"
                + INSTANCE.getMappedPort(PostgreSQLContainer.POSTGRESQL_PORT) + "/" + database;
    }

    private static void wire(DynamicPropertyRegistry registry, String url, String username, String password) {
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", () -> username);
        registry.add("spring.datasource.password", () -> password);
        // 컨텍스트 캐시마다 기본 idle 10개를 채우면 공유 PG의 max_connections를 소진한다.
        // 동시 쓰기 두 개와 잠금 관측용 연결은 허용하되 유휴 컨텍스트는 연결을 붙잡지 않는다.
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> 6);
        registry.add("spring.datasource.hikari.minimum-idle", () -> 0);
        registry.add("spring.datasource.hikari.idle-timeout", () -> 10000);
        registry.add("spring.flyway.enabled", () -> true);
        registry.add("spring.flyway.locations", () -> "classpath:db/migration");
        // 이력 없는 DB 는 V1 부터 전부 실행한다 — 「이미 있는 스키마를 baseline 으로 넘긴다」가 아니다.
        registry.add("spring.flyway.baseline-on-migrate", () -> false);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
    }
}
