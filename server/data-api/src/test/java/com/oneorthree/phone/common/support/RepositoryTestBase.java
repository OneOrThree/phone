package com.oneorthree.phone.common.support;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
public abstract class RepositoryTestBase {

    // 컨테이너만 공유하고 컨텍스트별 create-drop 스키마 수명은 격리한다.
    // 테스트 트랜잭션의 롤백 동작은 그대로 유지한다.
    @DynamicPropertySource
    static void overrideProperties(DynamicPropertyRegistry registry) {
        TestPostgres.registerIsolatedSchema(registry);
    }
}
