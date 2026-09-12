package com.oneorthree.phone.focus.scheduler;

import com.oneorthree.phone.common.port.FocusPresencePort;
import com.oneorthree.phone.common.port.NoOpFocusPresence;
import com.oneorthree.phone.common.port.RedisFocusPresence;
import com.oneorthree.phone.common.support.TestPostgres;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * <b>플래그를 켠 형상이 실제로 부팅되는가</b>.
 *
 * <p>프레즌스는 통째로 {@code focus.presence.enabled} 뒤에 있고, 기본값이 꺼짐이라 <b>다른 어떤 테스트도
 * 이 형상을 띄우지 않는다</b>. 그래서 배선이 깨져 있어도 스위트는 전부 초록이고, 깨짐은 «플래그를 켜는
 * 그 배포»에서 처음 드러난다 — 롤아웃을 되돌려야 하는 자리다.
 *
 * <p>구체적으로 이 컨텍스트에는 {@code AsyncTaskExecutor} 후보가 셋 이상 있다(Boot 공용 실행기 +
 * {@code SchedulingConfig} 의 스케줄러 둘 — {@code ThreadPoolTaskScheduler} 도 이 타입이다).
 * {@code FocusPresenceReconciler} 가 자격자 없이 타입으로만 받으면 여기서 기동이 깨진다.
 *
 * <p>컨텍스트를 하나 더 띄우는 값은 치른다. 켜진 형상을 부팅하지 않고서는 확인할 방법이 없다.
 *
 * <h2>⚠️ 이 컨텍스트에는 «진짜 Redis 가 없다»</h2>
 * CI({@code .github/workflows/be-gradle.yml})는 Postgres 만 띄우고 Redis 서비스를 두지 않는다.
 * 그래도 초록인 이유는 <b>DB 가 비어 있어서</b>다 — 재구축이 진행 중 세션을 하나도 못 찾아 Redis
 * 명령을 <b>한 번도 내지 않고</b>, {@code LettuceConnectionFactory} 는 지연 연결이라 빈 생성만으로는
 * 아무 데도 붙지 않는다. 즉 여기서 확인되는 것은 <b>배선</b>이지 동작이 아니다.
 *
 * <p><b>그러니 이 클래스에 「세션을 미리 심고 리스를 확인하는」 테스트를 추가하지 말 것.</b> 로컬
 * (Redis 가 떠 있는 개발 머신)에서는 통과하고 CI 에서는 실제 명령이 나가 타임아웃·간헐 실패가 된다.
 * 리스의 «동작»은 Testcontainers 로 진짜 Redis 를 띄우는 {@code RedisFocusPresenceTest} 가 본다.
 */
@SpringBootTest(properties = "focus.presence.enabled=true")
class FocusPresenceWiringIntegrationTest {

    @DynamicPropertySource
    static void overrideProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", TestPostgres.INSTANCE::getJdbcUrl);
        registry.add("spring.datasource.username", TestPostgres.INSTANCE::getUsername);
        registry.add("spring.datasource.password", TestPostgres.INSTANCE::getPassword);
    }

    @Autowired
    private ApplicationContext context;

    @Autowired
    private FocusPresencePort focusPresencePort;

    @Test
    @DisplayName("플래그를 켜면 재구축기가 배선된다 — 실행기 후보가 여럿인데도 모호하지 않다")
    void reconcilerWiresWhenPresenceIsEnabled() {
        assertThat(context.getBeansOfType(FocusPresenceReconciler.class)).hasSize(1);
    }

    @Test
    @DisplayName("재구축 조회에는 «시간 상한»이 걸려 있다 — 아무도 안 기다리는 스레드라 바깥 경계가 없다")
    void theReconcileReadIsBounded() {
        FocusPresenceReconciler reconciler = context.getBean(FocusPresenceReconciler.class);

        Object operations = ReflectionTestUtils.getField(reconciler, "transactionOperations");

        // 공용 TransactionTemplate 빈을 그냥 주입받게 되돌리면 이 단언이 깨진다 — 상한이 조용히 사라진다.
        assertThat(operations).isInstanceOf(TransactionTemplate.class);
        TransactionTemplate template = (TransactionTemplate) operations;
        assertThat(template.getTimeout()).isEqualTo(10);
        assertThat(template.isReadOnly()).isTrue();
    }

    @Test
    @DisplayName("플래그를 켜면 리스를 «진짜로 쓰는» 구현이 선택된다 — no-op 이 남아 있으면 규칙이 통째로 무효다")
    void redisImplementationIsSelectedWhenEnabled() {
        assertThat(focusPresencePort).isInstanceOf(RedisFocusPresence.class);
        assertThat(context.getBeansOfType(NoOpFocusPresence.class)).isEmpty();
    }
}
