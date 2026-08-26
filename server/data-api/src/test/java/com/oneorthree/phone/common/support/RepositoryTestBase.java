package com.oneorthree.phone.common.support;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
public abstract class RepositoryTestBase {

    // 컨테이너는 TestPostgres 로 통합 — IntegrationTestBase 와 같은 JDBC URL 을 주입해야
    // Spring 테스트 컨텍스트 캐시가 재사용된다(사유는 TestPostgres 주석 참고).
    // @Transactional 은 테스트 레벨 애노테이션이라 컨텍스트 캐시 키에 영향을 주지 않는다
    // — 두 베이스가 컨텍스트를 공유해도 각자의 롤백 동작은 그대로다.
    @DynamicPropertySource
    static void overrideProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", TestPostgres.INSTANCE::getJdbcUrl);
        registry.add("spring.datasource.username", TestPostgres.INSTANCE::getUsername);
        registry.add("spring.datasource.password", TestPostgres.INSTANCE::getPassword);
    }
}
