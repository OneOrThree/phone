package com.oneorthree.phone.common.support;

import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.annotation.DirtiesContext.HierarchyMode;
import org.springframework.test.context.TestContext;
import org.springframework.test.context.TestContextManager;

import static org.assertj.core.api.Assertions.assertThat;

class TestPostgresContextLifecycleTest {

    @Test
    void closingOneCachedContextDoesNotDropAnotherContextsTables() {
        TestContext first = new TestContextManager(FirstContext.class).getTestContext();
        TestContext second = new TestContextManager(SecondContext.class).getTestContext();
        try {
            first.getApplicationContext();
            ApplicationContext survivingContext = second.getApplicationContext();
            GroupRepository groups = survivingContext.getBean(GroupRepository.class);
            Group saved = groups.save(Group.builder().name("컨텍스트 종료 회귀").build());

            // LRU 퇴거와 동일하게 캐시에서 제거하면서 JPA create-drop 종료 훅까지 실행한다.
            first.markApplicationContextDirty(HierarchyMode.EXHAUSTIVE);

            assertThat(groups.findById(saved.getId())).isPresent();
            assertThat(groups.save(Group.builder().name("종료 뒤 저장").build()).getId()).isNotNull();
        } finally {
            first.markApplicationContextDirty(HierarchyMode.EXHAUSTIVE);
            second.markApplicationContextDirty(HierarchyMode.EXHAUSTIVE);
        }
    }

    @SpringBootTest(properties = "test.context-lifecycle=first")
    static class FirstContext extends IntegrationTestBase {
    }

    @SpringBootTest(properties = "test.context-lifecycle=second")
    static class SecondContext extends RepositoryTestBase {
    }
}
