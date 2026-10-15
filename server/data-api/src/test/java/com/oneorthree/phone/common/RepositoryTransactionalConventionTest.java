package com.oneorthree.phone.common;

import com.oneorthree.phone.group.repository.GroupChallengeBetSessionRepository;
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

/**
 * 리포지토리 트랜잭션 규약의 정적 가드 (GROMO-1655, 규약 §4·§5).
 *
 * <p><b>규칙</b>: {@code @Modifying} 벌크 쿼리는 트랜잭션을 열지 않는다 — 호출부(반드시
 * {@code @Transactional} service)의 경계에 편승한다. 리포지토리에 {@code @Transactional} 을 붙이면
 * 기본 전파가 {@code REQUIRED} 라 그 트랜잭션에 합류할 뿐이고, 리포지토리가 경계를 소유하는 것처럼
 * 읽히는 장식만 남는다.
 *
 * <p><b>유일한 예외</b>는 {@link GroupChallengeBetSessionRepository#recordFailure} 다. 호출부
 * {@code GroupBetScheduler.retryDueSessions} 가 건별 격리를 위해 <b>의도적으로 무트랜잭션</b>인
 * {@code @Scheduled} 진입점이라, 리포지토리가 자기 트랜잭션을 열지 않으면 정산 실패를 기록할 때마다
 * {@code InvalidDataAccessApiUsageException} 이 난다.
 *
 * <p><b>왜 이 테스트가 필요한가.</b> 그 예외의 회귀 안전망은 원래
 * {@code GroupBetSettleTriggerIntegrationTest} 가 무트랜잭션 베이스({@code IntegrationTestBase})를
 * 상속한다는 <b>실행 조건</b>에만 의존했다. 그 테스트가 {@code RepositoryTestBase}(클래스 레벨
 * {@code @Transactional})로 옮겨지거나 호출이 트랜잭션으로 감싸이면, 애노테이션을 떼도 스위트가
 * 초록으로 남는 조용한 회귀가 생긴다. 여기서는 실행이 아니라 <b>선언</b>을 단언하므로 그 조건에
 * 기대지 않는다.
 *
 * <p>양방향으로 잠근다 — 예외가 <b>사라지는</b> 것과, 예외가 다른 리포지토리로 <b>퍼지는</b> 것
 * 둘 다 실패로 잡는다.
 */
class RepositoryTransactionalConventionTest {

    private static final String BASE = "com/oneorthree/phone";

    /** 트랜잭션을 스스로 여는 것이 허용된 유일한 메서드. 늘리려면 규약 §5 에 근거를 먼저 적을 것. */
    private static final String ALLOWED = "GroupChallengeBetSessionRepository#recordFailure";

    @Test
    @DisplayName("@Modifying 메서드 중 @Transactional 을 가진 것은 recordFailure 하나뿐이다")
    void onlyOneModifyingMethodOwnsATransaction() throws Exception {
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
                .containsExactly(ALLOWED);
    }

    /**
     * 위 테스트는 목록이 비어도 통과할 수 있는 형태가 아니지만(정확히 1건을 요구한다), 그 1건이
     * <b>어느 메서드인지</b>를 이름 문자열이 아니라 실제 시그니처로 한 번 더 못박는다 — 메서드가
     * 개명되면 위 단언은 문자열 불일치로 실패하지만 여기서는 컴파일이 깨져 즉시 드러난다.
     */
    @Test
    @DisplayName("recordFailure 의 @Transactional 은 무트랜잭션 스케줄러가 부르므로 떼면 안 된다")
    void recordFailureKeepsItsTransaction() throws Exception {
        Method recordFailure = GroupChallengeBetSessionRepository.class
                .getMethod("recordFailure", java.util.UUID.class, java.time.Instant.class, java.time.Instant.class);

        assertThat(recordFailure.isAnnotationPresent(Transactional.class))
                .as("GroupBetScheduler.retryDueSessions 가 무트랜잭션 @Scheduled 라 이걸 떼면 "
                        + "정산 실패 기록마다 InvalidDataAccessApiUsageException 이 난다 (규약 §5)")
                .isTrue();
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
