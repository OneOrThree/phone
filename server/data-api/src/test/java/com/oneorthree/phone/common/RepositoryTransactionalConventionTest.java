package com.oneorthree.phone.common;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 벌크 갱신의 트랜잭션 경계는 호출 서비스가 소유한다. */
class RepositoryTransactionalConventionTest {

    private static final String BASE = "com/oneorthree/phone";


    @Test
    @DisplayName("@Modifying 메서드는 자체 트랜잭션을 열지 않는다")
    void modifyingMethodsDoNotOwnTransactions() throws Exception {
        List<String> annotated = new ArrayList<>();
        for (Class<?> repository : repositoryInterfaces()) {
            for (Method method : repository.getDeclaredMethods()) {
                if (method.isAnnotationPresent(Modifying.class)
                        && method.isAnnotationPresent(Transactional.class)) {
                    annotated.add(repository.getSimpleName() + "#" + method.getName());
                }
            }
        }

        assertThat(annotated)
                .as("리포지토리는 트랜잭션 경계를 소유하지 않는다 — 예외를 늘리려면 규약 §5 에 근거를 적을 것")
                .isEmpty();
    }


    private List<Class<?>> repositoryInterfaces() throws IOException, ClassNotFoundException {
        List<Class<?>> found = new ArrayList<>();
        Resource[] resources = new PathMatchingResourcePatternResolver()
                .getResources("classpath*:" + BASE + "/**/repository/*Repository.class");
        for (Resource resource : resources) {
            String path = resource.getURL().getPath();
            int start = path.indexOf(BASE);
            String className = path.substring(start, path.length() - ".class".length()).replace('/', '.');
            found.add(Class.forName(className));
        }
        assertThat(found).as("리포지토리 스캔이 비면 이 테스트는 아무것도 지키지 못한다").isNotEmpty();
        return found;
    }
}
