package com.oneorthree.phone.common.support;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
public abstract class RepositoryTestBase {

    // 컨테이너 비용은 공유하고 create-drop의 생성·종료는 컨텍스트별 스키마에 가둔다.
    @DynamicPropertySource
    static void overrideProperties(DynamicPropertyRegistry registry) {
        TestPostgres.applyContextWiring(registry);
    }
}
