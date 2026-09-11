package com.oneorthree.phone.outbox.support;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.containers.PostgreSQLContainer;

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
 */
public final class OutboxTestPostgres {

    /** 클래스 하나가 아니라 JVM 하나당 컨테이너 하나 — 서로 다른 테스트 컨텍스트도 DB를 공유한다. */
    public static final PostgreSQLContainer<?> INSTANCE;

    static {
        INSTANCE = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("outbox_db")
                .withUsername("outbox")
                .withPassword("outbox");
        INSTANCE.start();
    }

    private OutboxTestPostgres() {
    }

    /**
     * 운영 마이그레이션 배선을 테스트 컨텍스트에 건다.
     *
     * @param registry 스프링 테스트 프로퍼티 레지스트리
     */
    public static void applyProductionMigrationWiring(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", INSTANCE::getJdbcUrl);
        registry.add("spring.datasource.username", INSTANCE::getUsername);
        registry.add("spring.datasource.password", INSTANCE::getPassword);
        // 컨텍스트 캐시마다 기본 idle 10개를 채우면 공유 PG의 max_connections를 소진한다.
        // 동시 쓰기 두 개와 잠금 관측용 연결은 허용하되 유휴 컨텍스트는 연결을 붙잡지 않는다.
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> 6);
        registry.add("spring.datasource.hikari.minimum-idle", () -> 0);
        registry.add("spring.datasource.hikari.idle-timeout", () -> 10000);
        registry.add("spring.flyway.enabled", () -> true);
        registry.add("spring.flyway.locations", () -> "classpath:db/migration");
        // 빈 DB 에서 V1 부터 전부 실행한다 — 「이미 있는 스키마를 baseline 으로 넘긴다」가 아니다.
        registry.add("spring.flyway.baseline-on-migrate", () -> false);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
    }
}
