package com.oneorthree.phone.common.support;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest
public abstract class IntegrationTestBase {

    // 컨테이너만 공유하고 컨텍스트별 create-drop 스키마 수명은 격리한다.
    @DynamicPropertySource
    static void overrideProperties(DynamicPropertyRegistry registry) {
        TestPostgres.registerIsolatedSchema(registry);
    }
}
