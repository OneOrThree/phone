package com.oneorthree.phone.common.support;

import org.testcontainers.containers.PostgreSQLContainer;

/**
 * 테스트 전역에서 공유하는 PostgreSQL 컨테이너.
 *
 * <p>이전엔 IntegrationTestBase 와 RepositoryTestBase 가 각자 static 컨테이너를 띄웠다. 컨테이너가 2개인 것도
 * 비용이지만 진짜 문제는 그게 아니었다 — 두 베이스의 {@code @DynamicPropertySource} 가 주입하는
 * {@code spring.datasource.url} 이 서로 달라져 <b>Spring 테스트 컨텍스트 캐시 키가 갈라졌고</b>, 결과적으로
 * 애플리케이션 컨텍스트가 두 번 부팅됐다. 컨텍스트 부팅이 컨테이너 기동보다 훨씬 비싸다.
 *
 * <p>컨테이너를 여기 한 곳에 두면 두 베이스가 같은 JDBC URL 을 주입하므로 컨테이너를 쓰는 22 개 테스트
 * 클래스가 컨텍스트 하나를 공유한다.
 *
 * <p>JVM 종료 시 Testcontainers 의 Ryuk 사이드카가 컨테이너를 정리하므로 별도 stop 훅을 두지 않는다.
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
}
