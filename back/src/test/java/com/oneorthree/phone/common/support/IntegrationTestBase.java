package com.oneorthree.phone.common.support;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest
public abstract class IntegrationTestBase {

    // 컨테이너는 TestPostgres 로 통합 — RepositoryTestBase 와 같은 JDBC URL 을 주입해야
    // Spring 테스트 컨텍스트 캐시가 재사용된다(사유는 TestPostgres 주석 참고).
    @DynamicPropertySource
    static void overrideProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", TestPostgres.INSTANCE::getJdbcUrl);
        registry.add("spring.datasource.username", TestPostgres.INSTANCE::getUsername);
        registry.add("spring.datasource.password", TestPostgres.INSTANCE::getPassword);
    }
}
