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
    @DisplayName("플래그를 켜면 리스를 «진짜로 쓰는» 구현이 선택된다 — no-op 이 남아 있으면 규칙이 통째로 무효다")
    void redisImplementationIsSelectedWhenEnabled() {
        assertThat(focusPresencePort).isInstanceOf(RedisFocusPresence.class);
        assertThat(context.getBeansOfType(NoOpFocusPresence.class)).isEmpty();
    }
}
